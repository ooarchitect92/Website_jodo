import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { Db } from './db';
import { decrypt, digest, equal, keyed, token } from '../../../packages/core/src/security';
export interface Actor {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  tenantRole: string;
  sessionId: string;
  csrf: string;
}
export type AuthedRequest = Request & { actor: Actor };
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
export const isTenantReadOnly = (status: string) => status === 'suspended';
export const secureCookie = () => ({
  httpOnly: true,
  secure: process.env.DEPLOYMENT_MODE === 'production',
  sameSite: 'strict' as const,
  path: '/',
});
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Reflector) private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const sid = req.cookies?.jodo_session;
    if (typeof sid !== 'string') throw new UnauthorizedException('Sign in to the owner console');
    const rows = await this.db.query(
      `SELECT u.id,u.email,u.role,s.id AS session_id,s.csrf_hash,s.tenant_id,
              t.display_name AS tenant_name,t.status AS tenant_status,m.role_key AS tenant_role,m.status AS membership_status
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       JOIN tenants t ON t.id=s.tenant_id
       JOIN memberships m ON m.user_id=u.id AND m.tenant_id=s.tenant_id
       WHERE s.token_hash=$1
         AND s.expires_at>now()
         AND s.revoked_at IS NULL
         AND u.active=true
         AND m.status='active'
         AND t.status NOT IN('archived')`,
      [digest(sid)],
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException('Session expired');
    const csrf = keyed('csrf:' + sid);
    req.actor = {
      id: row.id,
      email: row.email,
      role: row.role,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      tenantStatus: row.tenant_status,
      tenantRole: row.tenant_role,
      sessionId: row.session_id,
      csrf,
    };
    // A suspended institution may inspect existing records, but it may not
    // issue new financial or configuration instructions until reinstated.
    // Logout and switching to another authorised workspace remain available
    // so a suspended institution cannot trap the user in that workspace.
    const path = String(req.path || req.route?.path || '');
    if (
      row.tenant_status === 'suspended' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      path !== '/v1/auth/logout' &&
      path !== '/v1/auth/switch-tenant'
    ) {
      await this.db.tx((c) =>
        this.db.audit(c, row.id, 'access.denied', path, { reason: 'tenant_suspended' }),
      );
      throw new ForbiddenException('This institution is suspended for new changes');
    }
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]) || ['owner'];
    // Route permissions belong to the active tenant membership, not the
    // user's global account role. Never inherit rights across workspaces.
    if (!roles.includes(row.tenant_role)) {
      await this.db.tx((c) =>
        this.db.audit(c, row.id, 'access.denied', req.route?.path || 'admin', { reason: 'role' }),
      );
      throw new ForbiddenException('This role cannot perform that action');
    }
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (!equal(String(req.headers['x-csrf-token'] || ''), csrf) || digest(csrf) !== row.csrf_hash)
    )
      throw new ForbiddenException('Refresh the console and try again');
    return true;
  }
}
@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(Db) private db: Db) {}
  @Post('login') async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = z
      .object({
        email: z.email().max(200),
        password: z.string().min(1).max(200),
        otp: z.string().regex(/^\d{6}$/),
      })
      .strict()
      .parse(body);
    const limitKey = 'login:' + keyed(input.email.toLowerCase());
    const limits = await this.db.query(
      `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE rate_limits.expires_at END RETURNING count`,
      [limitKey],
    );
    if (limits[0]!.count > 10)
      throw new UnauthorizedException('Sign-in temporarily limited. Try later.');
    const u = (
      await this.db.query('SELECT * FROM users WHERE lower(email)=$1 AND active=true', [
        input.email.toLowerCase(),
      ])
    )[0];
    let valid = false;
    if (u)
      valid =
        (await argon2.verify(u.password_hash, input.password)) &&
        authenticator.check(input.otp, decrypt<string>(u.totp_secret));
    if (!u || !valid) {
      await this.db.tx((c) =>
        this.db.audit(c, 'anonymous', 'auth.denied', 'login', { reason: 'credentials' }),
      );
      throw new UnauthorizedException('Email, password or authentication code is incorrect');
    }
    const memberships = await this.db.query(
      `SELECT m.tenant_id,m.role_key,t.display_name,t.status
       FROM memberships m
       JOIN tenants t ON t.id=m.tenant_id
       WHERE m.user_id=$1 AND m.status='active' AND t.status<>'archived'
       ORDER BY CASE WHEN m.role_key='owner' THEN 0 ELSE 1 END,t.display_name`,
      [u.id],
    );
    if (!memberships.length)
      throw new UnauthorizedException('No active workspace membership is available');

    const activeMembership = memberships[0]!;
    const sid = token();
    const csrf = keyed('csrf:' + sid);
    const step = Math.floor(Date.now() / 30000);
    await this.db.tx(async (c) => {
      const updated = await c.query(
        'UPDATE users SET last_totp_step=$2 WHERE id=$1 AND last_totp_step<$2 RETURNING id',
        [u.id, step],
      );
      if (!updated.rowCount) throw new UnauthorizedException('Wait for a new authentication code');
      await c.query(
        `INSERT INTO sessions(user_id,token_hash,csrf_hash,tenant_id,expires_at)
         VALUES($1,$2,$3,$4,now()+interval '8 hours')`,
        [u.id, digest(sid), digest(csrf), activeMembership.tenant_id],
      );
      await this.db.audit(c, u.id, 'auth.login', u.id);
    });
    res.cookie('jodo_session', sid, { ...secureCookie(), maxAge: 8 * 60 * 60 * 1000 });
    res.setHeader('Cache-Control', 'no-store');
    return {
      user: { id: u.id, email: u.email, role: u.role },
      tenant: {
        id: activeMembership.tenant_id,
        name: activeMembership.display_name,
        role: activeMembership.role_key,
        status: activeMembership.status,
        readOnly: isTenantReadOnly(activeMembership.status),
      },
      workspaces: memberships.map((m) => ({
        id: m.tenant_id,
        name: m.display_name,
        role: m.role_key,
        status: m.status,
        readOnly: isTenantReadOnly(m.status),
      })),
      csrf,
    };
  }
  @Get('me') @UseGuards(AuthGuard) @Roles('owner', 'editor', 'sales', 'analyst') async me(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const workspaces = await this.db.query(
      `SELECT m.tenant_id AS id,t.display_name AS name,m.role_key AS role,t.status
       FROM memberships m
       JOIN tenants t ON t.id=m.tenant_id
       WHERE m.user_id=$1 AND m.status='active' AND t.status<>'archived'
       ORDER BY CASE WHEN m.tenant_id=$2 THEN 0 ELSE 1 END,t.display_name`,
      [req.actor.id, req.actor.tenantId],
    );
    return {
      user: { id: req.actor.id, email: req.actor.email, role: req.actor.role },
      tenant: {
        id: req.actor.tenantId,
        name: req.actor.tenantName,
        status: req.actor.tenantStatus,
        readOnly: isTenantReadOnly(req.actor.tenantStatus),
        role: req.actor.tenantRole,
      },
      workspaces: workspaces.map((m) => ({
        ...m,
        readOnly: isTenantReadOnly(m.status),
      })),
      csrf: req.actor.csrf,
    };
  }

  @Post('switch-tenant')
  @UseGuards(AuthGuard)
  @Roles('owner', 'editor', 'sales', 'analyst')
  async switchTenant(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = z.object({ tenantId: z.uuid() }).strict().parse(body);
    const membership = (
      await this.db.query(
        `SELECT m.tenant_id,m.role_key,t.display_name,t.status
         FROM memberships m
         JOIN tenants t ON t.id=m.tenant_id
         WHERE m.user_id=$1 AND m.tenant_id=$2
           AND m.status='active' AND t.status<>'archived'`,
        [req.actor.id, input.tenantId],
      )
    )[0];
    if (!membership)
      throw new ForbiddenException('That workspace is not available to this account');
    await this.db.tx(async (c) => {
      const switched = await c.query(
        `UPDATE sessions s SET tenant_id=$2
         WHERE s.id=$1 AND s.user_id=$3
           AND s.revoked_at IS NULL AND s.expires_at>now()
           AND EXISTS (
             SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id
             WHERE m.user_id=s.user_id AND m.tenant_id=$2
               AND m.status='active' AND t.status<>'archived'
           )
         RETURNING s.id`,
        [req.actor.sessionId, membership.tenant_id, req.actor.id],
      );
      if (!switched.rowCount) {
        throw new ForbiddenException('Workspace or session is no longer available');
      }
      await this.db.audit(c, req.actor.id, 'membership.switch', membership.tenant_id, {
        fromTenantId: req.actor.tenantId,
        role: membership.role_key,
      });
    });
    return {
      tenant: {
        id: membership.tenant_id,
        name: membership.display_name,
        role: membership.role_key,
        status: membership.status,
        readOnly: isTenantReadOnly(membership.status),
      },
    };
  }
  @Post('logout') @UseGuards(AuthGuard) @Roles('owner', 'editor', 'sales', 'analyst') async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.tx(async (c) => {
      await c.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [req.actor.sessionId]);
      await this.db.audit(c, req.actor.id, 'auth.logout', req.actor.id);
    });
    res.clearCookie('jodo_session', secureCookie());
    return { status: 'signed_out' };
  }
}
