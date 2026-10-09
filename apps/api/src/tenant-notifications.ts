import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { uuid } from './content';

@Controller('v1/admin/tenant/notifications')
@UseGuards(AuthGuard)
@Roles('owner', 'sales')
export class TenantNotificationsController {
  constructor(@Inject(Db) private db: Db) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    const rows = await this.db.query(
      `SELECT n.id,n.title,n.enquiry_id,n.created_at,
              (r.user_id IS NOT NULL) AS is_read
       FROM tenant_inbox_notifications n
       LEFT JOIN tenant_inbox_reads r
         ON r.notification_id=n.id AND r.tenant_id=n.tenant_id AND r.user_id=$2
       WHERE n.tenant_id=$1
       ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,
      [req.actor.tenantId, req.actor.id],
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      enquiryId: row.enquiry_id,
      createdAt: row.created_at,
      read: row.is_read,
    }));
  }

  @Post(':id/read')
  async read(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.db.tx(async (c) => {
      const result = (
        await c.query(
          `INSERT INTO tenant_inbox_reads(tenant_id,notification_id,user_id)
           SELECT n.tenant_id,n.id,$3
           FROM tenant_inbox_notifications n
           WHERE n.id=$1 AND n.tenant_id=$2
           ON CONFLICT(notification_id,user_id) DO NOTHING
           RETURNING notification_id`,
          [uuid(id), req.actor.tenantId, req.actor.id],
        )
      ).rows[0];
      const exists = (
        await c.query('SELECT id FROM tenant_inbox_notifications WHERE id=$1 AND tenant_id=$2', [
          uuid(id),
          req.actor.tenantId,
        ])
      ).rows[0];
      if (!exists) throw new NotFoundException('Notification not found');
      if (result)
        await this.db.audit(c, req.actor.id, 'tenant.notification.read', id, {
          tenantId: req.actor.tenantId,
        });
      return { status: 'read', id: exists.id };
    });
  }
}
