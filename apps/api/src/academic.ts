import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';

const studentSchema = z
  .object({
    studentReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._/-]{2,80}$/),
    fullName: z.string().trim().min(2).max(160),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    branchId: z.uuid().optional(),
    academicYearId: z.uuid().optional(),
  })
  .strict();

const guardianSchema = z
  .object({
    displayName: z.string().trim().min(2).max(160),
    email: z.email().max(200).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d ()-]{8,20}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.email && !value.phone)
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Provide an email or phone for guardian contact verification',
      });
  });

const guardianLinkSchema = z
  .object({
    guardianId: z.uuid(),
    relationship: z.enum(['mother', 'father', 'guardian', 'self', 'sponsor', 'other']),
    payerRole: z.enum(['primary', 'authorised', 'view_only', 'none']).default('authorised'),
    verified: z.boolean().default(false),
  })
  .strict();

const catalogueSchema = z
  .object({
    kind: z.enum(['course', 'grade', 'batch', 'transport', 'hostel']),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._/-]{2,60}$/),
    label: z.string().trim().min(2).max(160),
    parentId: z.uuid().optional(),
  })
  .strict();

const assignmentSchema = z
  .object({
    catalogueId: z.uuid(),
    effectiveOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

const importRowSchema = z
  .object({
    studentReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._/-]{2,80}$/),
    fullName: z.string().trim().min(2).max(160),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    branchId: z.uuid().optional(),
    academicYearId: z.uuid().optional(),
    externalId: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

const importPreviewSchema = z
  .object({
    sourceSystem: z.string().trim().min(2).max(80),
    rows: z.array(z.unknown()).min(1).max(500),
  })
  .strict();

const externalIdSchema = z
  .object({
    sourceSystem: z.string().trim().min(2).max(80),
    entityType: z.enum(['student', 'guardian', 'catalogue']),
    entityId: z.uuid(),
    externalId: z.string().trim().min(1).max(160),
    sourceVersion: z.string().trim().max(120).optional(),
  })
  .strict();

const conflictSchema = z
  .object({
    mappingId: z.uuid(),
    fieldKey: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_.-]{1,79}$/),
    localValue: z.unknown().optional(),
    remoteValue: z.unknown().optional(),
  })
  .strict();

const conflictResolutionSchema = z
  .object({
    resolution: z.enum(['resolved_local', 'resolved_remote', 'dismissed']),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

function uuid(value: string) {
  return z.uuid().parse(value);
}

@Controller('v1/admin/academic')
@UseGuards(AuthGuard)
@Roles('owner')
export class AcademicOperationsController {
  constructor(@Inject(Db) private db: Db) {}

  @Get('overview')
  async overview(@Req() req: AuthedRequest) {
    const tenantId = req.actor.tenantId;
    const [students, guardians, catalogue, imports, conflicts] = await Promise.all([
      this.db.query(
        `SELECT s.id,s.student_reference,s.full_name,s.date_of_birth,s.status,s.version,
                s.branch_id,b.code AS branch_code,b.name AS branch_name,
                s.academic_year_id,y.label AS academic_year,
                s.created_at,s.updated_at
         FROM academic_students s
         LEFT JOIN branches b ON b.id=s.branch_id
         LEFT JOIN academic_years y ON y.id=s.academic_year_id
         WHERE s.tenant_id=$1
         ORDER BY s.created_at DESC
         LIMIT 300`,
        [tenantId],
      ),
      this.db.query(
        `SELECT g.id,g.display_name,g.email,g.phone,g.verification_status,g.created_at,
                count(l.id) FILTER (WHERE l.visibility_status='active')::int AS active_links
         FROM academic_guardians g
         LEFT JOIN academic_guardian_links l
           ON l.guardian_id=g.id AND l.tenant_id=g.tenant_id
         WHERE g.tenant_id=$1
         GROUP BY g.id
         ORDER BY g.created_at DESC
         LIMIT 300`,
        [tenantId],
      ),
      this.db.query(
        `SELECT c.id,c.kind,c.code,c.label,c.parent_id,p.label AS parent_label,
                c.status,c.version,c.created_at,c.retired_at
         FROM academic_catalogue c
         LEFT JOIN academic_catalogue p ON p.id=c.parent_id
         WHERE c.tenant_id=$1
         ORDER BY c.kind,c.status,c.label`,
        [tenantId],
      ),
      this.db.query(
        `SELECT id,source_system,status,row_count,valid_count,error_count,committed_count,
                created_at,committed_at
         FROM academic_import_batches
         WHERE tenant_id=$1
         ORDER BY created_at DESC
         LIMIT 50`,
        [tenantId],
      ),
      this.db.query(
        `SELECT c.id,c.mapping_id,c.field_key,c.local_value,c.remote_value,c.status,
                c.resolution_note,c.created_at,c.resolved_at,
                m.source_system,m.entity_type,m.external_id,m.entity_id
         FROM erp_sync_conflicts c
         JOIN external_id_mappings m ON m.id=c.mapping_id
         WHERE c.tenant_id=$1
         ORDER BY c.created_at DESC
         LIMIT 100`,
        [tenantId],
      ),
    ]);
    return { students, guardians, catalogue, imports, conflicts };
  }

  @Get('students')
  students(@Req() req: AuthedRequest) {
    return this.db.query(
      `SELECT s.id,s.student_reference,s.full_name,s.date_of_birth,s.status,s.version,
              s.branch_id,b.code AS branch_code,b.name AS branch_name,
              s.academic_year_id,y.label AS academic_year,s.created_at,s.updated_at
       FROM academic_students s
       LEFT JOIN branches b ON b.id=s.branch_id
       LEFT JOIN academic_years y ON y.id=s.academic_year_id
       WHERE s.tenant_id=$1
       ORDER BY s.full_name,s.student_reference
       LIMIT 1000`,
      [req.actor.tenantId],
    );
  }

  @Post('students')
  async createStudent(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = studentSchema.parse(body);
    await this.validateStudentScope(req.actor.tenantId, input.branchId, input.academicYearId);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO academic_students(
             tenant_id,branch_id,academic_year_id,student_reference,full_name,date_of_birth,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.branchId || null,
            input.academicYearId || null,
            input.studentReference,
            input.fullName,
            input.dateOfBirth || null,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'academic.student.create', row.id, {
        tenantId: req.actor.tenantId,
        studentReference: input.studentReference,
      });
      return row;
    });
  }

  @Get('students/:id')
  async student(@Req() req: AuthedRequest, @Param('id') id: string) {
    const studentId = uuid(id);
    const student = (
      await this.db.query(
        `SELECT s.*,b.code AS branch_code,b.name AS branch_name,y.label AS academic_year
         FROM academic_students s
         LEFT JOIN branches b ON b.id=s.branch_id
         LEFT JOIN academic_years y ON y.id=s.academic_year_id
         WHERE s.id=$1 AND s.tenant_id=$2`,
        [studentId, req.actor.tenantId],
      )
    )[0];
    if (!student) throw new ConflictException('Student record does not exist in this workspace');

    const [relationships, assignments, mappings, feeSchedules] = await Promise.all([
      this.db.query(
        `SELECT l.id,l.relationship,l.payer_role,l.visibility_status,l.verified_at,l.revoked_at,
                g.id AS guardian_id,g.display_name,g.email,g.phone,g.verification_status
         FROM academic_guardian_links l
         JOIN academic_guardians g ON g.id=l.guardian_id
         WHERE l.student_id=$1 AND l.tenant_id=$2
         ORDER BY l.created_at`,
        [studentId, req.actor.tenantId],
      ),
      this.db.query(
        `SELECT a.id,a.effective_on,a.ended_on,c.id AS catalogue_id,c.kind,c.code,c.label,c.status
         FROM student_catalogue_assignments a
         JOIN academic_catalogue c ON c.id=a.catalogue_id
         WHERE a.student_id=$1 AND a.tenant_id=$2
         ORDER BY a.effective_on DESC,c.kind`,
        [studentId, req.actor.tenantId],
      ),
      this.db.query(
        `SELECT id,source_system,external_id,source_version,last_synced_at
         FROM external_id_mappings
         WHERE tenant_id=$1 AND entity_type='student' AND entity_id=$2
         ORDER BY source_system`,
        [req.actor.tenantId, studentId],
      ),
      this.db.query(
        `SELECT id,status,currency,total_amount_minor,scope_type,scope_reference,created_at
         FROM fee_schedules
         WHERE tenant_id=$1
           AND scope_type='student'
           AND scope_reference=$2
         ORDER BY created_at DESC`,
        [req.actor.tenantId, student.student_reference],
      ),
    ]);
    return { student, relationships, assignments, mappings, feeSchedules };
  }

  @Post('guardians')
  async createGuardian(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = guardianSchema.parse(body);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO academic_guardians(
             tenant_id,display_name,email,phone,verification_status,created_by
           ) VALUES($1,$2,$3,$4,'unverified',$5)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.displayName,
            input.email || null,
            input.phone || null,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'academic.guardian.create', row.id, {
        tenantId: req.actor.tenantId,
        contactPresent: Boolean(input.email || input.phone),
      });
      return row;
    });
  }

  @Post('students/:id/guardians')
  async linkGuardian(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const studentId = uuid(id);
    const input = guardianLinkSchema.parse(body);
    return this.db.tx(async (c) => {
      const [student, guardian] = await Promise.all([
        c.query('SELECT id FROM academic_students WHERE id=$1 AND tenant_id=$2', [
          studentId,
          req.actor.tenantId,
        ]),
        c.query('SELECT id FROM academic_guardians WHERE id=$1 AND tenant_id=$2', [
          input.guardianId,
          req.actor.tenantId,
        ]),
      ]);
      if (!student.rows[0] || !guardian.rows[0])
        throw new ConflictException('Student and guardian must belong to this workspace');

      const row = (
        await c.query(
          `INSERT INTO academic_guardian_links(
             tenant_id,student_id,guardian_id,relationship,payer_role,visibility_status,verified_at,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(tenant_id,student_id,guardian_id)
           DO UPDATE SET relationship=excluded.relationship,
                         payer_role=excluded.payer_role,
                         visibility_status=excluded.visibility_status,
                         verified_at=excluded.verified_at,
                         revoked_at=NULL
           RETURNING *`,
          [
            req.actor.tenantId,
            studentId,
            input.guardianId,
            input.relationship,
            input.payerRole,
            input.verified ? 'active' : 'pending',
            input.verified ? new Date().toISOString() : null,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'academic.relationship.upsert', row.id, {
        studentId,
        guardianId: input.guardianId,
        verified: input.verified,
        payerRole: input.payerRole,
      });
      return row;
    });
  }

  @Post('relationships/:id/revoke')
  async revokeRelationship(@Req() req: AuthedRequest, @Param('id') id: string) {
    const relationshipId = uuid(id);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `UPDATE academic_guardian_links
           SET visibility_status='revoked',revoked_at=now()
           WHERE id=$1 AND tenant_id=$2 AND visibility_status<>'revoked'
           RETURNING *`,
          [relationshipId, req.actor.tenantId],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Relationship is missing or already revoked');
      await this.db.audit(c, req.actor.id, 'academic.relationship.revoke', relationshipId, {
        studentId: row.student_id,
        guardianId: row.guardian_id,
      });
      return row;
    });
  }

  @Post('catalogue')
  async createCatalogue(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = catalogueSchema.parse(body);
    if (input.parentId) {
      const parent = (
        await this.db.query(
          'SELECT id FROM academic_catalogue WHERE id=$1 AND tenant_id=$2 AND status=$3',
          [input.parentId, req.actor.tenantId, 'active'],
        )
      )[0];
      if (!parent)
        throw new ConflictException('Catalogue parent is outside this workspace or retired');
    }
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO academic_catalogue(
             tenant_id,kind,code,label,parent_id,created_by
           ) VALUES($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.kind,
            input.code,
            input.label,
            input.parentId || null,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'academic.catalogue.create', row.id, {
        kind: input.kind,
        code: input.code,
      });
      return row;
    });
  }

  @Post('catalogue/:id/retire')
  async retireCatalogue(@Req() req: AuthedRequest, @Param('id') id: string) {
    const catalogueId = uuid(id);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `UPDATE academic_catalogue
           SET status='retired',retired_at=now(),version=version+1
           WHERE id=$1 AND tenant_id=$2 AND status='active'
           RETURNING *`,
          [catalogueId, req.actor.tenantId],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Catalogue item is missing or already retired');
      await this.db.audit(c, req.actor.id, 'academic.catalogue.retire', catalogueId);
      return row;
    });
  }

  @Post('students/:id/catalogue')
  async assignCatalogue(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const studentId = uuid(id);
    const input = assignmentSchema.parse(body);
    return this.db.tx(async (c) => {
      const [student, catalogue] = await Promise.all([
        c.query('SELECT id FROM academic_students WHERE id=$1 AND tenant_id=$2', [
          studentId,
          req.actor.tenantId,
        ]),
        c.query(
          "SELECT id FROM academic_catalogue WHERE id=$1 AND tenant_id=$2 AND status='active'",
          [input.catalogueId, req.actor.tenantId],
        ),
      ]);
      if (!student.rows[0] || !catalogue.rows[0])
        throw new ConflictException('Student and catalogue item must belong to this workspace');
      const row = (
        await c.query(
          `INSERT INTO student_catalogue_assignments(
             tenant_id,student_id,catalogue_id,effective_on,created_by
           ) VALUES($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            req.actor.tenantId,
            studentId,
            input.catalogueId,
            input.effectiveOn || new Date().toISOString().slice(0, 10),
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'academic.catalogue.assign', row.id, {
        studentId,
        catalogueId: input.catalogueId,
      });
      return row;
    });
  }

  @Post('imports/preview')
  async previewImport(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = importPreviewSchema.parse(body);
    const checksum = createHash('sha256')
      .update(JSON.stringify({ sourceSystem: input.sourceSystem, rows: input.rows }))
      .digest('hex');

    const existing = (
      await this.db.query(
        `SELECT id,source_system,status,row_count,valid_count,error_count,committed_count,created_at,committed_at
         FROM academic_import_batches
         WHERE tenant_id=$1 AND source_system=$2 AND checksum=$3`,
        [req.actor.tenantId, input.sourceSystem, checksum],
      )
    )[0];
    if (existing) {
      const rows = await this.db.query(
        `SELECT row_number,payload,status,errors,student_id
         FROM academic_import_rows
         WHERE tenant_id=$1 AND batch_id=$2
         ORDER BY row_number`,
        [req.actor.tenantId, existing.id],
      );
      return { batch: existing, rows, replayed: true };
    }

    const existingRefs = new Set(
      (
        await this.db.query<{ student_reference: string }>(
          'SELECT student_reference FROM academic_students WHERE tenant_id=$1',
          [req.actor.tenantId],
        )
      ).map((row) => row.student_reference),
    );
    const seen = new Set<string>();
    const analysed = input.rows.map((raw, index) => {
      const parsed = importRowSchema.safeParse(raw);
      const errors: string[] = [];
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          errors.push((issue.path.join('.') || 'row') + ': ' + issue.message);
        return { rowNumber: index + 1, payload: raw, status: 'error' as const, errors };
      }
      if (seen.has(parsed.data.studentReference))
        errors.push('studentReference: duplicate reference within import');
      if (existingRefs.has(parsed.data.studentReference))
        errors.push('studentReference: already exists in this workspace');
      seen.add(parsed.data.studentReference);
      return {
        rowNumber: index + 1,
        payload: parsed.data,
        status: errors.length ? ('error' as const) : ('valid' as const),
        errors,
      };
    });
    const validCount = analysed.filter((row) => row.status === 'valid').length;
    const errorCount = analysed.length - validCount;

    return this.db.tx(async (c) => {
      const batch = (
        await c.query(
          `INSERT INTO academic_import_batches(
             tenant_id,source_system,checksum,row_count,valid_count,error_count,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.sourceSystem,
            checksum,
            analysed.length,
            validCount,
            errorCount,
            req.actor.id,
          ],
        )
      ).rows[0];
      for (const row of analysed)
        await c.query(
          `INSERT INTO academic_import_rows(
             tenant_id,batch_id,row_number,payload,status,errors
           ) VALUES($1,$2,$3,$4,$5,$6)`,
          [
            req.actor.tenantId,
            batch.id,
            row.rowNumber,
            row.payload,
            row.status,
            JSON.stringify(row.errors),
          ],
        );
      await this.db.audit(c, req.actor.id, 'academic.import.preview', batch.id, {
        sourceSystem: input.sourceSystem,
        rowCount: analysed.length,
        validCount,
        errorCount,
      });
      return { batch, rows: analysed, replayed: false };
    });
  }

  @Post('imports/:id/commit')
  async commitImport(@Req() req: AuthedRequest, @Param('id') id: string) {
    const batchId = uuid(id);
    return this.db.tx(async (c) => {
      const batch = (
        await c.query(
          'SELECT * FROM academic_import_batches WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [batchId, req.actor.tenantId],
        )
      ).rows[0];
      if (!batch) throw new ConflictException('Import batch does not exist in this workspace');
      if (batch.status === 'committed' || batch.status === 'partial_failed')
        return { ...batch, replayed: true };
      if (batch.status !== 'previewed')
        throw new ConflictException('Only a previewed import batch can be committed');

      await c.query("UPDATE academic_import_batches SET status='committing' WHERE id=$1", [
        batchId,
      ]);
      const rows = (
        await c.query(
          `SELECT id,row_number,payload,status
           FROM academic_import_rows
           WHERE batch_id=$1 AND tenant_id=$2
           ORDER BY row_number
           FOR UPDATE`,
          [batchId, req.actor.tenantId],
        )
      ).rows;

      let committed = 0;
      let skipped = 0;
      for (const row of rows) {
        if (row.status !== 'valid') {
          skipped++;
          continue;
        }
        const parsed = importRowSchema.parse(row.payload);
        const scopeOk = await this.validateStudentScope(
          req.actor.tenantId,
          parsed.branchId,
          parsed.academicYearId,
          c,
        );
        if (!scopeOk) {
          await c.query("UPDATE academic_import_rows SET status='error',errors=$2 WHERE id=$1", [
            row.id,
            JSON.stringify(['branchId/academicYearId: outside this workspace']),
          ]);
          skipped++;
          continue;
        }
        const existingStudent = (
          await c.query(
            'SELECT id FROM academic_students WHERE tenant_id=$1 AND student_reference=$2',
            [req.actor.tenantId, parsed.studentReference],
          )
        ).rows[0];
        if (existingStudent) {
          await c.query(
            "UPDATE academic_import_rows SET status='skipped',student_id=$2,errors=$3 WHERE id=$1",
            [row.id, existingStudent.id, JSON.stringify(['studentReference: already exists'])],
          );
          skipped++;
          continue;
        }
        const student = (
          await c.query(
            `INSERT INTO academic_students(
               tenant_id,branch_id,academic_year_id,student_reference,full_name,date_of_birth,created_by
             ) VALUES($1,$2,$3,$4,$5,$6,$7)
             RETURNING id`,
            [
              req.actor.tenantId,
              parsed.branchId || null,
              parsed.academicYearId || null,
              parsed.studentReference,
              parsed.fullName,
              parsed.dateOfBirth || null,
              req.actor.id,
            ],
          )
        ).rows[0];
        if (parsed.externalId)
          await c.query(
            `INSERT INTO external_id_mappings(
               tenant_id,source_system,entity_type,entity_id,external_id,last_synced_at
             ) VALUES($1,$2,'student',$3,$4,now())
             ON CONFLICT(tenant_id,source_system,entity_type,external_id) DO NOTHING`,
            [req.actor.tenantId, batch.source_system, student.id, parsed.externalId],
          );
        await c.query(
          "UPDATE academic_import_rows SET status='committed',student_id=$2 WHERE id=$1",
          [row.id, student.id],
        );
        committed++;
      }

      const finalStatus = skipped ? 'partial_failed' : 'committed';
      const updated = (
        await c.query(
          `UPDATE academic_import_batches
           SET status=$2,committed_count=$3,committed_at=now()
           WHERE id=$1 RETURNING *`,
          [batchId, finalStatus, committed],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'academic.import.commit', batchId, {
        committed,
        skipped,
        finalStatus,
      });
      return { ...updated, replayed: false };
    });
  }

  @Post('external-ids')
  async mapExternalId(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = externalIdSchema.parse(body);
    await this.ensureEntity(req.actor.tenantId, input.entityType, input.entityId);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO external_id_mappings(
             tenant_id,source_system,entity_type,entity_id,external_id,source_version,last_synced_at
           ) VALUES($1,$2,$3,$4,$5,$6,now())
           RETURNING *`,
          [
            req.actor.tenantId,
            input.sourceSystem,
            input.entityType,
            input.entityId,
            input.externalId,
            input.sourceVersion || null,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'academic.external_id.map', row.id, {
        entityType: input.entityType,
        entityId: input.entityId,
        sourceSystem: input.sourceSystem,
      });
      return row;
    });
  }

  @Post('conflicts')
  async createConflict(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = conflictSchema.parse(body);
    const mapping = (
      await this.db.query('SELECT id FROM external_id_mappings WHERE id=$1 AND tenant_id=$2', [
        input.mappingId,
        req.actor.tenantId,
      ])
    )[0];
    if (!mapping)
      throw new ConflictException('External-ID mapping does not exist in this workspace');
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO erp_sync_conflicts(
             tenant_id,mapping_id,field_key,local_value,remote_value
           ) VALUES($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.mappingId,
            input.fieldKey,
            input.localValue === undefined ? null : JSON.stringify(input.localValue),
            input.remoteValue === undefined ? null : JSON.stringify(input.remoteValue),
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'academic.sync_conflict.create', row.id, {
        mappingId: input.mappingId,
        fieldKey: input.fieldKey,
      });
      return row;
    });
  }

  @Post('conflicts/:id/resolve')
  async resolveConflict(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const conflictId = uuid(id);
    const input = conflictResolutionSchema.parse(body);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `UPDATE erp_sync_conflicts
           SET status=$3,resolution_note=$4,resolved_at=now(),resolved_by=$5
           WHERE id=$1 AND tenant_id=$2 AND status='open'
           RETURNING *`,
          [conflictId, req.actor.tenantId, input.resolution, input.note, req.actor.id],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Conflict is missing or already resolved');
      await this.db.audit(c, req.actor.id, 'academic.sync_conflict.resolve', conflictId, {
        resolution: input.resolution,
      });
      return row;
    });
  }

  private async validateStudentScope(
    tenantId: string,
    branchId?: string,
    academicYearId?: string,
    client?: { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }> },
  ) {
    const q = client || {
      query: async (sql: string, args: unknown[] = []) => ({
        rows: await this.db.query(sql, args),
      }),
    };
    if (branchId) {
      const branch = (
        await q.query('SELECT id FROM branches WHERE id=$1 AND tenant_id=$2', [branchId, tenantId])
      ).rows[0];
      if (!branch) {
        if (client) return false;
        throw new ConflictException('Branch is outside this workspace');
      }
    }
    if (academicYearId) {
      const year = (
        await q.query('SELECT id FROM academic_years WHERE id=$1 AND tenant_id=$2', [
          academicYearId,
          tenantId,
        ])
      ).rows[0];
      if (!year) {
        if (client) return false;
        throw new ConflictException('Academic year is outside this workspace');
      }
    }
    return true;
  }

  private async ensureEntity(
    tenantId: string,
    type: 'student' | 'guardian' | 'catalogue',
    id: string,
  ) {
    const table =
      type === 'student'
        ? 'academic_students'
        : type === 'guardian'
          ? 'academic_guardians'
          : 'academic_catalogue';
    const row = (
      await this.db.query(`SELECT id FROM ${table} WHERE id=$1 AND tenant_id=$2`, [id, tenantId])
    )[0];
    if (!row) throw new ConflictException('Mapped record does not exist in this workspace');
  }
}
