import {
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { navSchema, pageSchema, safePath } from '../../../packages/core/src/contracts';
export const uuid = (value: string) => z.uuid().parse(value);
const publicRow = (r: Record<string, any>) => ({
  id: r.id,
  slug: r.slug,
  kind: r.kind,
  body: r.body,
  revision: r.revision,
  modifiedAt: r.updated_at,
});
@Controller('v1/public')
export class PublicContentController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('site') async site() {
    const rows = await this.db.query(
      "SELECT key,value FROM settings WHERE key IN('navigation','brand','form')",
    );
    return {
      mode: process.env.DEPLOYMENT_MODE,
      policyVersion: '2026-10-v1',
      settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
      indexing:
        process.env.PUBLIC_INDEXING_ENABLED === 'true' && process.env.SITE_APPROVED === 'true',
    };
  }
  @Get('pages') async pages(@Query('kind') kind?: string) {
    if (kind) z.enum(['page', 'post', 'case']).parse(kind);
    const rows = await this.db.query(
      "SELECT c.id,c.slug,c.kind,r.body,r.id AS revision,c.updated_at FROM content c JOIN revisions r ON r.id=c.published_revision JOIN tenants t ON t.id=c.tenant_id WHERE t.slug='default' AND c.deleted_at IS NULL AND ($1::text IS NULL OR c.kind=$1) ORDER BY c.slug LIMIT 200",
      [kind || null],
    );
    return rows.map(publicRow);
  }
  @Get('pages/by-path') async page(
    @Query('path') path: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    safePath.parse(path);
    const rows = await this.db.query(
      "SELECT c.id,c.slug,c.kind,r.body,r.id AS revision,c.updated_at FROM content c JOIN revisions r ON r.id=c.published_revision JOIN tenants t ON t.id=c.tenant_id WHERE t.slug='default' AND c.slug=$1 AND c.deleted_at IS NULL",
      [path],
    );
    if (!rows[0]) throw new NotFoundException('Page not found');
    res.setHeader('Cache-Control', 'no-store');
    return publicRow(rows[0]);
  }
}
@Controller('v1/admin/content')
@UseGuards(AuthGuard)
@Roles('owner', 'editor')
export class ContentController {
  constructor(@Inject(Db) private db: Db) {}
  private async requireLegacyWorkspace(req: AuthedRequest) {
    const workspace = await this.db.query(
      "SELECT id FROM tenants WHERE id=$1 AND slug='default' AND status<>'archived'",
      [req.actor.tenantId],
    );
    if (!workspace.length) {
      throw new ForbiddenException('Legacy site management is unavailable in this workspace');
    }
  }
  @Get() async list(@Req() req: AuthedRequest) {
    return this.db.query(
      "SELECT id,slug,kind,draft->>'title' AS title,state,version,deleted_at,published_revision,scheduled_at,updated_at FROM content WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 200",
      [req.actor.tenantId],
    );
  }
  @Get(':id') async detail(@Param('id') id: string, @Req() req: AuthedRequest) {
    const row = (
      await this.db.query('SELECT * FROM content WHERE id=$1 AND tenant_id=$2', [
        uuid(id),
        req.actor.tenantId,
      ])
    )[0];
    if (!row) throw new NotFoundException();
    const revisions = await this.db.query(
      'SELECT id,created_at,created_by,body FROM revisions WHERE content_id=$1 ORDER BY created_at DESC LIMIT 50',
      [id],
    );
    return { ...row, revisions };
  }
  @Post() async create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = z
      .object({ slug: safePath, kind: z.enum(['page', 'post', 'case']), body: pageSchema })
      .strict()
      .parse(body);
    if (
      /^\/(api|admin|media|blog|case-studies)(\/)?$/.test(v.slug) ||
      v.slug.startsWith('/admin/') ||
      v.slug.startsWith('/api/')
    )
      throw new ConflictException('Reserved route');
    return this.db.tx(async (c) => {
      const r = await c.query(
        'INSERT INTO content(slug,kind,draft,tenant_id) VALUES($1,$2,$3,$4) RETURNING *',
        [v.slug, v.kind, v.body, req.actor.tenantId],
      );
      await this.db.audit(c, req.actor.id, 'content.create', r.rows[0].id);
      return r.rows[0];
    });
  }
  @Patch(':id/draft') async save(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const v = z
      .object({ expectedVersion: z.number().int().positive(), body: pageSchema })
      .strict()
      .parse(body);
    return this.db.tx(async (c) => {
      const r = await c.query(
        "UPDATE content SET draft=$2,version=version+1,state='draft',approved_by=NULL,scheduled_at=NULL,updated_at=now() WHERE id=$1 AND version=$3 AND tenant_id=$4 AND deleted_at IS NULL RETURNING *",
        [uuid(id), v.body, v.expectedVersion, req.actor.tenantId],
      );
      if (!r.rowCount)
        throw new ConflictException(
          'A newer edit exists or this page is in trash. Reload before saving.',
        );
      await this.db.audit(c, req.actor.id, 'content.save', id, { version: r.rows[0].version });
      return r.rows[0];
    });
  }
  @Post(':id/action') async action(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const v = z
      .object({
        action: z.enum([
          'review',
          'approve',
          'publish',
          'schedule',
          'rollback',
          'unpublish',
          'trash',
          'restore',
        ]),
        expectedVersion: z.number().int().positive(),
        reason: z.string().min(3).max(200),
        revisionId: z.uuid().optional(),
        scheduledAt: z.iso.datetime().optional(),
      })
      .strict()
      .parse(body);
    return this.db.tx(async (c) => {
      const r = (
        await c.query('SELECT * FROM content WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
          uuid(id),
          req.actor.tenantId,
        ])
      ).rows[0];
      if (!r) throw new NotFoundException();
      if (r.version !== v.expectedVersion)
        throw new ConflictException('Version changed. Reload the editor.');
      if (r.deleted_at && v.action !== 'restore')
        throw new ConflictException('Restore this item first');
      if (
        ['approve', 'publish', 'schedule', 'rollback', 'unpublish', 'trash', 'restore'].includes(
          v.action,
        ) &&
        req.actor.role !== 'owner'
      )
        throw new ConflictException('Owner approval is required');
      if (v.action === 'review') {
        if (r.state !== 'draft') throw new ConflictException('Only drafts enter review');
        await c.query("UPDATE content SET state='in_review' WHERE id=$1", [id]);
      }
      if (v.action === 'approve') {
        if (r.state !== 'in_review') throw new ConflictException('Submit for review first');
        pageSchema.parse(r.draft);
        await c.query("UPDATE content SET state='approved',approved_by=$2 WHERE id=$1", [
          id,
          req.actor.id,
        ]);
      }
      if (v.action === 'schedule') {
        if (
          r.state !== 'approved' ||
          !v.scheduledAt ||
          new Date(v.scheduledAt).getTime() <= Date.now()
        )
          throw new ConflictException('Approve the draft and choose a future time');
        await c.query("UPDATE content SET state='scheduled',scheduled_at=$2 WHERE id=$1", [
          id,
          v.scheduledAt,
        ]);
      }
      if (v.action === 'publish' || v.action === 'rollback') {
        let published = r.draft;
        if (v.action === 'publish' && r.state !== 'approved')
          throw new ConflictException('Approve the draft before publishing');
        if (v.action === 'rollback') {
          const old = (
            await c.query('SELECT body FROM revisions WHERE id=$1 AND content_id=$2', [
              v.revisionId || null,
              id,
            ])
          ).rows[0];
          if (!old) throw new ConflictException('Choose a revision belonging to this page');
          published = old.body;
        }
        pageSchema.parse(published);
        const rev = (
          await c.query(
            'INSERT INTO revisions(content_id,body,created_by) VALUES($1,$2,$3) RETURNING id',
            [id, published, req.actor.id],
          )
        ).rows[0];
        await c.query(
          "UPDATE content SET draft=$2,published_revision=$3,state='published',scheduled_at=NULL WHERE id=$1",
          [id, published, rev.id],
        );
        await c.query(
          "INSERT INTO outbox(event_id,type,aggregate_id,payload) VALUES(gen_random_uuid(),'content.published',$1,$2)",
          [id, { revision: rev.id }],
        );
      }
      if (v.action === 'unpublish')
        await c.query(
          "UPDATE content SET published_revision=NULL,state='draft',scheduled_at=NULL WHERE id=$1",
          [id],
        );
      if (v.action === 'trash')
        await c.query(
          'UPDATE content SET deleted_at=now(),deleted_by=$2,deletion_reason=$3,scheduled_at=NULL WHERE id=$1',
          [id, req.actor.id, v.reason],
        );
      if (v.action === 'restore')
        await c.query(
          "UPDATE content SET deleted_at=NULL,deleted_by=NULL,deletion_reason=NULL,published_revision=NULL,state='draft',scheduled_at=NULL WHERE id=$1",
          [id],
        );
      await c.query('UPDATE content SET version=version+1,updated_at=now() WHERE id=$1', [id]);
      await this.db.audit(c, req.actor.id, 'content.' + v.action, id, {
        reason: v.reason,
        version: r.version + 1,
      });
      return (await c.query('SELECT * FROM content WHERE id=$1', [id])).rows[0];
    });
  }
}
@Controller('v1/admin/settings')
@UseGuards(AuthGuard)
@Roles('owner')
export class SettingsController {
  constructor(@Inject(Db) private db: Db) {}
  private async requireLegacyWorkspace(req: AuthedRequest) {
    const workspace = await this.db.query(
      "SELECT id FROM tenants WHERE id=$1 AND slug='default' AND status<>'archived'",
      [req.actor.tenantId],
    );
    if (!workspace.length) {
      throw new ForbiddenException('Legacy site management is unavailable in this workspace');
    }
  }
  @Get() async list(@Req() req: AuthedRequest) {
    await this.requireLegacyWorkspace(req);
    return this.db.query('SELECT key,value,version FROM settings');
  }
  @Patch(':key') async save(
    @Param('key') key: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    await this.requireLegacyWorkspace(req);
    const b = z
      .object({ expectedVersion: z.number().int(), value: z.unknown() })
      .strict()
      .parse(body);
    let value: unknown;
    if (key === 'navigation') value = navSchema.parse(b.value);
    else if (key === 'brand')
      value = z
        .object({
          name: z.string().min(2).max(40),
          primary: z.enum(['#2c67d3', '#2455a6', '#193b73']),
        })
        .strict()
        .parse(b.value);
    else if (key === 'form')
      value = z
        .object({
          revision: z.string().regex(/^demo-v[1-9][0-9]*$/),
          title: z.string().max(120),
          notice: z.string().min(20).max(600),
          success: z.string().min(10).max(250),
        })
        .strict()
        .parse(b.value);
    else throw new NotFoundException('Setting is not owner-editable');
    return this.db.tx(async (c) => {
      if (key === 'form') {
        value = {
          ...(value as Record<string, unknown>),
          revision: 'demo-v' + (b.expectedVersion + 1),
        };
        await c.query('INSERT INTO form_revisions(id,body,created_by) VALUES($1,$2,$3)', [
          (value as Record<string, unknown>).revision,
          value,
          req.actor.id,
        ]);
      }
      const r = await c.query(
        'UPDATE settings SET value=$2,version=version+1 WHERE key=$1 AND version=$3 RETURNING *',
        [key, JSON.stringify(value), b.expectedVersion],
      );
      if (!r.rowCount) throw new ConflictException('Settings changed; reload');
      await this.db.audit(c, req.actor.id, 'settings.update', key);
      return r.rows[0];
    });
  }
}
