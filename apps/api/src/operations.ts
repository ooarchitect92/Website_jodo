import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { uuid } from './content';
import {
  campaignSchema,
  simulateWorkflow,
  workflowSchema,
} from '../../../packages/core/src/contracts';
import { decrypt } from '../../../packages/core/src/security';
@Controller('v1/admin')
@UseGuards(AuthGuard)
@Roles('owner')
export class OperationsController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('overview') @Roles('owner', 'editor', 'sales', 'analyst') async overview() {
    const stats = (
      await this.db.query(
        `SELECT (SELECT count(*)::int FROM content WHERE published_revision IS NOT NULL AND deleted_at IS NULL) AS published,(SELECT count(*)::int FROM leads) AS leads,(SELECT count(*)::int FROM leads WHERE stage='new') AS new_leads,(SELECT count(*)::int FROM tasks WHERE status='open') AS open_tasks,(SELECT count(*)::int FROM outbox WHERE status IN('blocked','dead_letter','retry')) AS attention`,
      )
    )[0];
    return {
      stats,
      mode: process.env.DEPLOYMENT_MODE,
      updatedAt: new Date().toISOString(),
      definition:
        'Business counts come from PostgreSQL. Analytics is consent-limited and is not a complete visitor count.',
      productionAccepted: false,
    };
  }
  @Get('tasks') @Roles('owner', 'sales') tasks() {
    return this.db.query('SELECT * FROM tasks ORDER BY due_at LIMIT 200');
  }
  @Post('tasks/:id/complete') @Roles('owner', 'sales') async task(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ) {
    await this.db.tx(async (c) => {
      const updated = await c.query("UPDATE tasks SET status='done' WHERE id=$1 RETURNING id", [
        uuid(id),
      ]);
      if (!updated.rowCount) throw new ConflictException('Task does not exist');
      await this.db.audit(c, req.actor.id, 'task.complete', id);
    });
    return { status: 'done' };
  }
  @Get('audit') async audit() {
    return this.db.query('SELECT * FROM audit ORDER BY id DESC LIMIT 200');
  }
  @Get('outbox') outbox() {
    return this.db.query(
      'SELECT id,type,aggregate_id,status,attempts,last_error,created_at,available_at FROM outbox ORDER BY created_at DESC LIMIT 200',
    );
  }
  @Post('outbox/:id/retry') async retry(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.db.tx(async (c) => {
      const rows = await c.query(
        "UPDATE outbox SET status='pending',available_at=now(),lease_until=NULL WHERE id=$1 AND status IN('retry','blocked','dead_letter') RETURNING id",
        [uuid(id)],
      );
      if (!rows.rowCount) throw new ConflictException('This job cannot be retried');
      await this.db.audit(c, req.actor.id, 'outbox.retry', id);
    });
    return { status: 'pending' };
  }
  @Get('campaigns') campaigns() {
    return this.db.query('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 200');
  }
  @Post('campaigns') async campaign(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = campaignSchema.parse(body);
    const url = new URL(v.path, process.env.SITE_URL);
    url.search = new URLSearchParams({
      utm_source: v.source,
      utm_medium: v.medium,
      utm_campaign: v.campaign,
    }).toString();
    return this.db.tx(async (c) => {
      const row = (
        await c.query(
          'INSERT INTO campaigns(definition,url,created_by) VALUES($1,$2,$3) RETURNING *',
          [v, url.toString(), req.actor.id],
        )
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'campaign.create', row.id);
      return row;
    });
  }
  @Get('workflows') workflows() {
    return this.db.query('SELECT * FROM workflows ORDER BY created_at DESC LIMIT 100');
  }
  @Post('workflows') async workflow(@Body() body: unknown, @Req() req: AuthedRequest) {
    const v = workflowSchema.parse(body);
    return this.db.tx(async (c) => {
      const row = (
        await c.query('INSERT INTO workflows(definition,created_by) VALUES($1,$2) RETURNING *', [
          v,
          req.actor.id,
        ])
      ).rows[0];
      await this.db.audit(c, req.actor.id, 'workflow.create', row.id);
      return row;
    });
  }
  @Post('workflows/simulate') simulate(@Body() body: unknown) {
    const v = z.object({ definition: workflowSchema, contacted: z.boolean() }).strict().parse(body);
    return {
      mode: 'simulation_only',
      externalEffects: false,
      timeline: simulateWorkflow(v.definition, new Date(), v.contacted),
    };
  }
  @Patch('workflows/:id') async toggle(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const v = z
      .object({ active: z.boolean(), expectedVersion: z.number().int().positive() })
      .strict()
      .parse(body);
    return this.db.tx(async (c) => {
      const r = await c.query(
        'UPDATE workflows SET active=$2,version=version+1 WHERE id=$1 AND version=$3 RETURNING *',
        [uuid(id), v.active, v.expectedVersion],
      );
      if (!r.rowCount) throw new ConflictException('Workflow version changed');
      await this.db.audit(c, req.actor.id, v.active ? 'workflow.activate' : 'workflow.pause', id);
      return r.rows[0];
    });
  }
  @Get('workflows/runs') runs() {
    return this.db.query(
      'SELECT id,workflow_id,lead_id,next_node,status,due_at FROM workflow_runs ORDER BY due_at DESC LIMIT 200',
    );
  }
  @Get('privacy-requests') async rights(@Req() req: AuthedRequest) {
    await this.db.tx((c) => this.db.audit(c, req.actor.id, 'privacy.requests.read', 'queue'));
    return (
      await this.db.query('SELECT * FROM privacy_requests ORDER BY created_at DESC LIMIT 100')
    ).map((r) => ({
      ...r,
      contact: decrypt<string>(r.encrypted_contact),
      encrypted_contact: undefined,
    }));
  }
  @Get('conversations') async conversations() {
    return this.db.query(
      'SELECT id,status,created_at,expires_at FROM chats ORDER BY created_at DESC LIMIT 100',
    );
  }
  @Get('users') users() {
    return this.db.query('SELECT id,email,role,active,created_at FROM users ORDER BY created_at');
  }
  @Post('users/:id/revoke-sessions') async revoke(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ) {
    await this.db.tx(async (c) => {
      await c.query(
        'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [uuid(id)],
      );
      await this.db.audit(c, req.actor.id, 'sessions.revoke', id);
    });
    return { status: 'revoked' };
  }
  @Post('content-export') async export(@Req() req: AuthedRequest, @Res() res: Response) {
    const pages = await this.db.query('SELECT * FROM content ORDER BY slug');
    const revisions = await this.db.query('SELECT * FROM revisions ORDER BY created_at');
    const media = await this.db.query('SELECT * FROM media');
    const settings = await this.db.query('SELECT * FROM settings');
    await this.db.tx((c) =>
      this.db.audit(c, req.actor.id, 'content.export', 'snapshot', { count: pages.length }),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="content-export.json"');
    res.json({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      pages,
      revisions,
      media,
      settings,
    });
  }
  @Get('integrations') integrations() {
    return [
      {
        name: 'SMTP notifications',
        status:
          process.env.NOTIFICATION_MODE === 'smtp'
            ? 'Configured — delivery must be verified'
            : 'Disabled',
        implemented: true,
      },
      {
        name: 'Google / Meta reporting and conversion delivery',
        status: 'Not implemented; no advertising data is sent',
        implemented: false,
      },
      {
        name: 'Fee schedules / payment evidence / reconciliation',
        status: 'Core ledger implemented; live money movement provider not activated',
        implemented: true,
      },
      {
        name: 'Fee structures and collection pages',
        status: 'Implemented; checkout stays blocked until a hosted payment provider is activated',
        implemented: true,
      },
      {
        name: 'Signed payment provider callbacks',
        status:
          process.env.PAYMENT_PROVIDER_MODE === 'signed_hmac'
            ? 'Configured; verify provider-side mapping and end-to-end evidence'
            : 'Implemented but disabled until provider secret and mapping are approved',
        implemented: true,
      },
      {
        name: 'Hosted checkout / lending / KYC provider',
        status:
          'Not activated; requires provider contract, credentials and tested money-movement flows',
        implemented: false,
      },
      {
        name: 'Independent WORM audit export',
        status: 'Local signed checkpoints only; independent storage not configured',
        implemented: false,
      },
      {
        name: 'Object storage',
        status: 'Local durable media adapter; S3 adapter not implemented',
        implemented: false,
      },
    ];
  }
}
