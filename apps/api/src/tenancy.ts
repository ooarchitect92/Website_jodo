import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';

const permissionCatalogue = new Set([
  'tenant.read',
  'tenant.onboard.edit',
  'tenant.onboard.submit',
  'organisation.read',
  'organisation.edit',
  'beneficiary.change.request',
  'brand.edit',
  'config.publish.request',
  'domain.manage',
  'team.invite',
  'membership.assign',
  'membership.revoke',
  'role.edit',
  'role.publish',
  'access.simulate',
  'dashboard.read',
  'dashboard.personalise',
  'fee.read',
  'fee.adjust.request',
  'payment.evidence.record',
  'refund.request',
  'refund.approve',
  'approval.decide',
  'reconciliation.read',
  'content.edit',
  'builder.edit',
  'audit.read',
  'report.read',
  'lead.read',
  'lead.edit',
  'support.case.read',
  'support.case.edit',
]);

const roleSchema = z
  .object({
    roleKey: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_.-]{1,79}$/),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(300).default(''),
    grants: z.array(z.string()).max(80).default([]),
    explicitDenies: z.array(z.string()).max(80).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [field, permissions] of [
      ['grants', value.grants],
      ['explicitDenies', value.explicitDenies],
    ] as const)
      for (const permission of permissions)
        if (!permissionCatalogue.has(permission))
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: 'Unknown permission: ' + permission,
          });
  });

const onboardingSchema = z
  .object({
    section: z.enum(['organisation', 'partner', 'configuration', 'import', 'readiness']),
    data: z.record(z.string().max(80), z.union([z.string().max(500), z.boolean(), z.number()])),
  })
  .strict();

const entitySchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    registrationReference: z.string().trim().max(120).optional(),
    taxReferenceMasked: z.string().trim().max(80).optional(),
  })
  .strict();

const branchSchema = z
  .object({
    legalEntityId: z.uuid(),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{2,40}$/),
    name: z.string().trim().min(2).max(120),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
  })
  .strict();

const yearSchema = z
  .object({
    label: z.string().trim().min(2).max(40),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endsOn <= value.startsOn)
      ctx.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: 'End date must follow start date',
      });
  });

const brandSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    primaryColour: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    accentColour: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    supportEmail: z.email().max(200).optional(),
    locale: z.enum(['en-IN', 'hi-IN']).default('en-IN'),
  })
  .strict();

const domainSchema = z
  .object({
    hostname: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  })
  .strict();

function requireTenantOwner(req: AuthedRequest) {
  if (req.actor.tenantRole !== 'owner')
    throw new ForbiddenException('Tenant owner permission is required for this action');
}

function rolePayloadHash(role: {
  role_key: string;
  name: string;
  description: string;
  grants: unknown;
  explicit_denies: unknown;
  version: number;
}) {
  const grants = Array.isArray(role.grants) ? [...role.grants].sort() : [];
  const denies = Array.isArray(role.explicit_denies) ? [...role.explicit_denies].sort() : [];
  return createHash('sha256')
    .update(
      JSON.stringify({
        roleKey: role.role_key,
        name: role.name,
        description: role.description,
        grants,
        explicitDenies: denies,
        version: Number(role.version),
      }),
    )
    .digest('hex');
}

@Controller('v1/admin/tenant')
@UseGuards(AuthGuard)
@Roles('owner', 'editor', 'sales', 'analyst')
export class TenancyController {
  constructor(@Inject(Db) private db: Db) {}

  @Get('overview')
  async overview(@Req() req: AuthedRequest) {
    const tenantId = req.actor.tenantId;
    const [
      tenant,
      onboarding,
      entities,
      branches,
      years,
      brands,
      domains,
      members,
      roles,
      approvals,
    ] = await Promise.all([
      this.db.query(
        'SELECT id,slug,display_name,legal_name,status,locale,created_at,updated_at FROM tenants WHERE id=$1',
        [tenantId],
      ),
      this.db.query(
        'SELECT current_step,draft,version,submitted_at,reviewed_at,review_reason,updated_at FROM onboarding_cases WHERE tenant_id=$1',
        [tenantId],
      ),
      this.db.query(
        'SELECT id,name,registration_reference,tax_reference_masked,status,created_at FROM legal_entities WHERE tenant_id=$1 ORDER BY name',
        [tenantId],
      ),
      this.db.query(
        `SELECT b.id,b.legal_entity_id,b.code,b.name,b.city,b.state,b.status,b.created_at,
                  le.name AS legal_entity_name
           FROM branches b
           JOIN legal_entities le ON le.id=b.legal_entity_id
           WHERE b.tenant_id=$1
           ORDER BY b.code`,
        [tenantId],
      ),
      this.db.query(
        'SELECT id,label,starts_on,ends_on,status,created_at FROM academic_years WHERE tenant_id=$1 ORDER BY starts_on DESC',
        [tenantId],
      ),
      this.db.query(
        'SELECT id,name,primary_colour,accent_colour,support_email,locale,status,version,created_at,published_at FROM tenant_brand_versions WHERE tenant_id=$1 ORDER BY version DESC LIMIT 20',
        [tenantId],
      ),
      this.db.query(
        "SELECT id,hostname,status,verified_at,created_at,updated_at FROM tenant_domains WHERE tenant_id=$1 AND status<>'removed' ORDER BY created_at DESC",
        [tenantId],
      ),
      this.db.query(
        `SELECT m.id,m.user_id,u.email,m.role_key,m.status,m.branch_id,m.created_at,m.updated_at
           FROM memberships m
           JOIN users u ON u.id=m.user_id
           WHERE m.tenant_id=$1
           ORDER BY u.email`,
        [tenantId],
      ),
      this.db.query(
        `SELECT id,role_key,name,description,grants,explicit_denies,status,version,
                  created_by,published_at,created_at,updated_at
           FROM tenant_roles
           WHERE tenant_id=$1
           ORDER BY role_key,version DESC`,
        [tenantId],
      ),
      this.db.query(
        `SELECT r.id,r.role_id,r.payload_hash,r.requested_by,r.decided_by,r.status,
                  r.decision_reason,r.created_at,r.decided_at,tr.role_key,tr.name,tr.version
           FROM tenant_role_releases r
           JOIN tenant_roles tr ON tr.id=r.role_id
           WHERE r.tenant_id=$1
           ORDER BY r.created_at DESC
           LIMIT 100`,
        [tenantId],
      ),
    ]);

    return {
      tenant: tenant[0],
      onboarding: onboarding[0],
      entities,
      branches,
      academicYears: years,
      brandVersions: brands,
      domains,
      members,
      roles,
      approvals,
      permissionCatalogue: [...permissionCatalogue].sort(),
      workspaceRole: req.actor.tenantRole,
    };
  }

  @Post('onboarding')
  async saveOnboarding(@Req() req: AuthedRequest, @Body() body: unknown) {
    requireTenantOwner(req);
    const input = onboardingSchema.parse(body);
    const encoded = JSON.stringify(input.data);
    if (Buffer.byteLength(encoded, 'utf8') > 16_384)
      throw new ConflictException('Onboarding section is too large');

    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `UPDATE onboarding_cases
           SET current_step=$2,
               draft=draft || jsonb_build_object($2,$3::jsonb),
               version=version+1,
               updated_at=now()
           WHERE tenant_id=$1
           RETURNING current_step,draft,version,updated_at`,
          [req.actor.tenantId, input.section, encoded],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'tenant.onboarding.save', req.actor.tenantId, {
        tenantId: req.actor.tenantId,
        section: input.section,
        version: row.version,
      });
      return row;
    });
  }

  @Post('organisation/entities')
  async createEntity(@Req() req: AuthedRequest, @Body() body: unknown) {
    requireTenantOwner(req);
    const input = entitySchema.parse(body);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO legal_entities(
             tenant_id,name,registration_reference,tax_reference_masked
           ) VALUES($1,$2,$3,$4)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.name,
            input.registrationReference || null,
            input.taxReferenceMasked || null,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'organisation.entity.create', row.id, {
        tenantId: req.actor.tenantId,
      });
      return row;
    });
  }

  @Post('organisation/branches')
  async createBranch(@Req() req: AuthedRequest, @Body() body: unknown) {
    requireTenantOwner(req);
    const input = branchSchema.parse(body);
    const entity = (
      await this.db.query('SELECT id FROM legal_entities WHERE id=$1 AND tenant_id=$2', [
        input.legalEntityId,
        req.actor.tenantId,
      ])
    )[0];
    if (!entity) throw new ForbiddenException('Legal entity is outside this workspace');

    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO branches(tenant_id,legal_entity_id,code,name,city,state)
           VALUES($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.legalEntityId,
            input.code,
            input.name,
            input.city || null,
            input.state || null,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'organisation.branch.create', row.id, {
        tenantId: req.actor.tenantId,
        legalEntityId: input.legalEntityId,
      });
      return row;
    });
  }

  @Post('organisation/academic-years')
  async createAcademicYear(@Req() req: AuthedRequest, @Body() body: unknown) {
    requireTenantOwner(req);
    const input = yearSchema.parse(body);
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO academic_years(tenant_id,label,starts_on,ends_on)
           VALUES($1,$2,$3,$4)
           RETURNING *`,
          [req.actor.tenantId, input.label, input.startsOn, input.endsOn],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'organisation.academic_year.create', row.id, {
        tenantId: req.actor.tenantId,
      });
      return row;
    });
  }

  @Post('brand')
  async saveBrand(@Req() req: AuthedRequest, @Body() body: unknown) {
    requireTenantOwner(req);
    const input = brandSchema.parse(body);
    return this.db.tx(async (c) => {
      const nextVersion = Number(
        (
          await c.query(
            'SELECT coalesce(max(version),0)+1 AS version FROM tenant_brand_versions WHERE tenant_id=$1',
            [req.actor.tenantId],
          )
        ).rows[0]!.version,
      );
      const row = (
        await c.query(
          `INSERT INTO tenant_brand_versions(
             tenant_id,name,primary_colour,accent_colour,support_email,locale,status,version,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.name,
            input.primaryColour,
            input.accentColour,
            input.supportEmail || null,
            input.locale,
            nextVersion,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'brand.draft.create', row.id, {
        tenantId: req.actor.tenantId,
        version: nextVersion,
      });
      return row;
    });
  }

  @Post('domains')
  async addDomain(@Req() req: AuthedRequest, @Body() body: unknown) {
    requireTenantOwner(req);
    const input = domainSchema.parse(body);
    const challenge = 'platform-verify=' + randomBytes(24).toString('hex');
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO tenant_domains(tenant_id,hostname,challenge,created_by)
           VALUES($1,$2,$3,$4)
           RETURNING id,hostname,status,created_at`,
          [req.actor.tenantId, input.hostname, challenge, req.actor.id],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'domain.challenge.create', row.id, {
        tenantId: req.actor.tenantId,
        hostname: input.hostname,
      });
      return {
        ...row,
        dns: {
          type: 'TXT',
          name: '_payments-platform-verification.' + input.hostname,
          value: challenge,
        },
      };
    });
  }

  @Post('domains/:id/verify')
  async verifyDomain(@Req() req: AuthedRequest, @Param('id') id: string) {
    requireTenantOwner(req);
    const parsedId = z.uuid().parse(id);
    const row = (
      await this.db.query(
        "SELECT id,hostname,challenge,status FROM tenant_domains WHERE id=$1 AND tenant_id=$2 AND status<>'removed'",
        [parsedId, req.actor.tenantId],
      )
    )[0];
    if (!row) throw new ForbiddenException('Domain is outside this workspace');
    if (row.status === 'verified' || row.status === 'active')
      return { id: row.id, hostname: row.hostname, status: row.status, verified: true };

    let records: string[][] = [];
    try {
      records = await dns.resolveTxt('_payments-platform-verification.' + row.hostname);
    } catch {
      throw new ConflictException('Verification TXT record is not visible yet');
    }
    const flattened = records.map((parts) => parts.join(''));
    if (!flattened.includes(row.challenge))
      throw new ConflictException('Verification TXT value does not match');

    return this.db.tx(async (c) => {
      const verified = (
        await c.query(
          `UPDATE tenant_domains
           SET status='verified',verified_at=now(),updated_at=now()
           WHERE id=$1 AND tenant_id=$2
           RETURNING id,hostname,status,verified_at`,
          [parsedId, req.actor.tenantId],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'domain.verify', parsedId, {
        tenantId: req.actor.tenantId,
        hostname: row.hostname,
      });
      return { ...verified, verified: true };
    });
  }

  @Post('roles')
  async createRole(@Req() req: AuthedRequest, @Body() body: unknown) {
    requireTenantOwner(req);
    const input = roleSchema.parse(body);
    if (input.roleKey === 'owner')
      throw new ConflictException('The protected owner template cannot be replaced');

    return this.db.tx(async (c) => {
      const latest = (
        await c.query(
          `SELECT coalesce(max(version),0)::int AS version
           FROM tenant_roles WHERE tenant_id=$1 AND role_key=$2`,
          [req.actor.tenantId, input.roleKey],
        )
      ).rows[0]!;
      const version = Number(latest.version) + 1;
      const row = (
        await c.query(
          `INSERT INTO tenant_roles(
             tenant_id,role_key,name,description,grants,explicit_denies,status,version,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8)
           RETURNING *`,
          [
            req.actor.tenantId,
            input.roleKey,
            input.name,
            input.description,
            [...new Set(input.grants)].sort(),
            [...new Set(input.explicitDenies)].sort(),
            version,
            req.actor.id,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'role.draft.create', row.id, {
        tenantId: req.actor.tenantId,
        roleKey: input.roleKey,
        version,
      });
      return row;
    });
  }

  @Post('roles/:id/request-publish')
  async requestRolePublish(@Req() req: AuthedRequest, @Param('id') id: string) {
    requireTenantOwner(req);
    const roleId = z.uuid().parse(id);
    return this.db.tx(async (c) => {
      const role = (
        await c.query(
          `SELECT * FROM tenant_roles
           WHERE id=$1 AND tenant_id=$2
           FOR UPDATE`,
          [roleId, req.actor.tenantId],
        )
      ).rows[0];
      if (!role) throw new ForbiddenException('Role is outside this workspace');
      if (role.status !== 'draft')
        throw new ConflictException('Only a draft role can be submitted for approval');

      const pending = (
        await c.query(
          `SELECT id FROM tenant_role_releases
           WHERE tenant_id=$1 AND role_id=$2 AND status='pending'`,
          [req.actor.tenantId, roleId],
        )
      ).rows[0];
      if (pending) throw new ConflictException('This role already has a pending approval');

      const hash = rolePayloadHash(role);
      const release = (
        await c.query(
          `INSERT INTO tenant_role_releases(
             tenant_id,role_id,payload_hash,requested_by
           ) VALUES($1,$2,$3,$4)
           RETURNING *`,
          [req.actor.tenantId, roleId, hash, req.actor.id],
        )
      ).rows[0];
      await c.query(
        "UPDATE tenant_roles SET status='pending_approval',updated_at=now() WHERE id=$1",
        [roleId],
      );
      await this.db.audit(c, req.actor.id, 'role.publish.request', release.id, {
        tenantId: req.actor.tenantId,
        roleId,
        payloadHash: hash,
      });
      return release;
    });
  }

  @Post('approvals/:id/decide')
  async decideRolePublish(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    requireTenantOwner(req);
    const approvalId = z.uuid().parse(id);
    const input = z
      .object({
        decision: z.enum(['approve', 'reject']),
        reason: z.string().trim().min(3).max(300),
      })
      .strict()
      .parse(body);

    return this.db.tx(async (c) => {
      const approval = (
        await c.query(
          `SELECT r.*,tr.role_key,tr.name,tr.description,tr.grants,tr.explicit_denies,tr.version,
                  tr.status AS role_status
           FROM tenant_role_releases r
           JOIN tenant_roles tr ON tr.id=r.role_id
           WHERE r.id=$1 AND r.tenant_id=$2
           FOR UPDATE OF r,tr`,
          [approvalId, req.actor.tenantId],
        )
      ).rows[0];
      if (!approval) throw new ForbiddenException('Approval is outside this workspace');
      if (approval.status !== 'pending')
        throw new ConflictException('This approval is already decided');
      if (approval.requested_by === req.actor.id)
        throw new ForbiddenException('The maker cannot approve or reject their own role release');
      if (approval.role_status !== 'pending_approval')
        throw new ConflictException('Role state changed after the approval was requested');

      const currentHash = rolePayloadHash(approval);
      if (currentHash !== approval.payload_hash)
        throw new ConflictException('Role definition changed; submit a new approval request');

      if (input.decision === 'approve') {
        await c.query(
          `UPDATE tenant_roles
           SET status='retired',updated_at=now()
           WHERE tenant_id=$1 AND role_key=$2 AND status='published' AND id<>$3`,
          [req.actor.tenantId, approval.role_key, approval.role_id],
        );
        await c.query(
          `UPDATE tenant_roles
           SET status='published',published_at=now(),updated_at=now()
           WHERE id=$1`,
          [approval.role_id],
        );
      } else {
        await c.query(
          `UPDATE tenant_roles
           SET status='draft',updated_at=now()
           WHERE id=$1`,
          [approval.role_id],
        );
      }

      const decided = (
        await c.query(
          `UPDATE tenant_role_releases
           SET status=$2,decided_by=$3,decision_reason=$4,decided_at=now()
           WHERE id=$1
           RETURNING *`,
          [
            approvalId,
            input.decision === 'approve' ? 'approved' : 'rejected',
            req.actor.id,
            input.reason,
          ],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'role.publish.decide', approvalId, {
        tenantId: req.actor.tenantId,
        roleId: approval.role_id,
        decision: input.decision,
        payloadHash: currentHash,
      });
      return decided;
    });
  }

  @Post('roles/simulate')
  simulateRole(@Req() req: AuthedRequest, @Body() body: unknown) {
    requireTenantOwner(req);
    const input = z
      .object({
        grants: z.array(z.string()).max(80),
        explicitDenies: z.array(z.string()).max(80),
        action: z.string(),
      })
      .strict()
      .parse(body);
    if (!permissionCatalogue.has(input.action)) throw new ConflictException('Unknown permission');
    const denied = input.explicitDenies.includes(input.action);
    const granted = input.grants.includes(input.action);
    return {
      action: input.action,
      allowed: granted && !denied,
      reasons: denied ? ['explicit_deny'] : granted ? ['explicit_grant'] : ['no_matching_grant'],
    };
  }
}
