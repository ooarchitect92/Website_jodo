import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { uuid } from './content';
import { decrypt, encrypt, keyed } from '../../../packages/core/src/security';
import { tenantQuestionListSchema } from './tenant-enquiries';

const definition = z
  .object({
    slug: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/),
    title: z.string().trim().min(3).max(100),
    fields: tenantQuestionListSchema.min(1),
  })
  .strict();
const change = z
  .object({
    title: z.string().trim().min(3).max(100),
    expectedVersion: z.number().int().positive(),
    fields: tenantQuestionListSchema.min(1),
  })
  .strict();
const entry = z
  .object({
    version: z.number().int().positive(),
    submissionKey: z.uuid(),
    values: z.record(z.string(), z.string().trim().max(1000)),
  })
  .strict();

type Question = z.infer<typeof tenantQuestionListSchema>[number];

function checkValues(fields: Question[], values: Record<string, string>) {
  const defined = new Map(fields.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(values)) {
    const field = defined.get(key);
    if (!field) throw new UnprocessableEntityException('Unknown collection field');
    if (field.kind === 'choice' && value && !field.options.includes(value))
      throw new UnprocessableEntityException('Unsupported field choice');
    if (value.length > (field.kind === 'long_text' ? 1000 : 160))
      throw new UnprocessableEntityException('Field value exceeds its length limit');
  }
  for (const field of fields) {
    if (field.required && !values[field.key]?.trim())
      throw new UnprocessableEntityException('Required collection field is missing');
  }
}

@Controller('v1/admin/tenant/collections')
@UseGuards(AuthGuard)
@Roles('owner', 'editor')
export class TenantCollectionsController {
  constructor(@Inject(Db) private db: Db) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    return this.db.query(
      `SELECT id,slug,title,version,fields,created_at,updated_at
       FROM tenant_collections WHERE tenant_id=$1
       ORDER BY created_at DESC,id DESC LIMIT 100`,
      [req.actor.tenantId],
    );
  }

  @Post()
  @Roles('owner')
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const data = definition.parse(body);
    return this.db.tx(async (c) => {
      const record = (
        await c.query(
          `INSERT INTO tenant_collections(tenant_id,slug,title,fields,created_by)
           VALUES($1,$2,$3,$4,$5)
           RETURNING id,slug,title,version,fields`,
          [req.actor.tenantId, data.slug, data.title, JSON.stringify(data.fields), req.actor.id],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO tenant_collection_versions(
          tenant_id,collection_id,version,title,fields,created_by
        ) VALUES($1,$2,1,$3,$4,$5)`,
        [req.actor.tenantId, record.id, data.title, JSON.stringify(data.fields), req.actor.id],
      );
      await this.db.audit(c, req.actor.id, 'tenant.collection.create', record.id, {
        tenantId: req.actor.tenantId,
        slug: data.slug,
      });
      return record;
    });
  }

  @Get(':id/versions')
  async versions(@Param('id') id: string, @Req() req: AuthedRequest) {
    const rows = await this.db.query(
      `SELECT v.version,v.title,v.fields,v.created_at
       FROM tenant_collection_versions v
       JOIN tenant_collections c
         ON c.id=v.collection_id AND c.tenant_id=v.tenant_id
       WHERE c.id=$1 AND c.tenant_id=$2
       ORDER BY v.version DESC LIMIT 100`,
      [uuid(id), req.actor.tenantId],
    );
    if (!rows.length) throw new NotFoundException('Collection not found');
    return rows;
  }

  @Post(':id/revisions')
  @Roles('owner')
  async revise(@Param('id') id: string, @Req() req: AuthedRequest, @Body() body: unknown) {
    const v = change.parse(body);
    return this.db.tx(async (c) => {
      const current = (
        await c.query(
          'SELECT id,version,fields FROM tenant_collections WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [uuid(id), req.actor.tenantId],
        )
      ).rows[0];
      if (!current) throw new NotFoundException('Collection not found');
      if (current.version !== v.expectedVersion)
        throw new ConflictException('Collection changed; reload before saving');
      const oldFields = tenantQuestionListSchema.parse(current.fields);
      // Only append new fields; never remove or redefine fields used by saved entries.
      if (
        v.fields.length < oldFields.length ||
        oldFields.some((field, index) => JSON.stringify(field) !== JSON.stringify(v.fields[index]))
      )
        throw new ConflictException('Published collection fields may only be extended');
      const nextVersion = current.version + 1;
      await c.query(
        `UPDATE tenant_collections
         SET title=$3,fields=$4,version=$5,updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [current.id, req.actor.tenantId, v.title, JSON.stringify(v.fields), nextVersion],
      );
      await c.query(
        `INSERT INTO tenant_collection_versions(
          tenant_id,collection_id,version,title,fields,created_by
        ) VALUES($1,$2,$3,$4,$5,$6)`,
        [req.actor.tenantId, current.id, nextVersion, v.title, JSON.stringify(v.fields), req.actor.id],
      );
      await this.db.audit(c, req.actor.id, 'tenant.collection.revise', current.id, {
        tenantId: req.actor.tenantId,
        version: nextVersion,
      });
      return { id: current.id, title: v.title, version: nextVersion, fields: v.fields };
    });
  }

  @Get(':id/entries')
  async entries(@Param('id') id: string, @Req() req: AuthedRequest) {
    const exists = await this.db.query(
      'SELECT id FROM tenant_collections WHERE id=$1 AND tenant_id=$2',
      [uuid(id), req.actor.tenantId],
    );
    if (!exists.length) throw new NotFoundException('Collection not found');
    const rows = await this.db.query(
      `SELECT id,schema_version,encrypted_data,created_at
       FROM tenant_collection_entries WHERE collection_id=$1 AND tenant_id=$2
       ORDER BY created_at DESC,id DESC LIMIT 100`,
      [uuid(id), req.actor.tenantId],
    );
    await this.db.tx((c) =>
      this.db.audit(c, req.actor.id, 'tenant.collection.entries.read', id, {
        tenantId: req.actor.tenantId,
        count: rows.length,
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      schemaVersion: r.schema_version,
      createdAt: r.created_at,
      values: decrypt<Record<string, string>>(r.encrypted_data),
    }));
  }

  @Post(':id/entries')
  async submit(@Param('id') id: string, @Req() req: AuthedRequest, @Body() body: unknown) {
    const input = entry.parse(body);
    const collectionId = uuid(id);
    const fingerprint = keyed(JSON.stringify({ version: input.version, values: input.values }));
    return this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'collection-entry:' + collectionId + ':' + input.submissionKey,
      ]);
      const current = (
        await c.query(
          'SELECT version,fields FROM tenant_collections WHERE id=$1 AND tenant_id=$2',
          [collectionId, req.actor.tenantId],
        )
      ).rows[0];
      if (!current) throw new NotFoundException('Collection not found');
      const old = (
        await c.query(
          `SELECT id,fingerprint FROM tenant_collection_entries
           WHERE collection_id=$1 AND tenant_id=$2 AND submission_key=$3`,
          [collectionId, req.actor.tenantId, input.submissionKey],
        )
      ).rows[0];
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new ConflictException('Submission key already used for different data');
        return { id: old.id, status: 'accepted', replayed: true };
      }
      if (current.version !== input.version)
        throw new ConflictException('Schema changed; reload before saving');
      checkValues(tenantQuestionListSchema.parse(current.fields), input.values);
      const saved = (
        await c.query(
          `INSERT INTO tenant_collection_entries(
             tenant_id,collection_id,schema_version,submission_key,fingerprint,
             encrypted_data,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            req.actor.tenantId,
            collectionId,
            input.version,
            input.submissionKey,
            fingerprint,
            encrypt(input.values),
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'tenant.collection.entry.accepted', saved.id, {
        tenantId: req.actor.tenantId,
        collectionId,
        schemaVersion: input.version,
      });
      return { id: saved.id, status: 'accepted', replayed: false };
    });
  }
}
