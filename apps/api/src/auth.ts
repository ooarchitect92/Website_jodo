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
  sessionId: string;
  csrf: string;
}
export type AuthedRequest = Request & { actor: Actor };
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
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
      'SELECT u.id,u.email,u.role,s.id AS session_id,s.csrf_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND u.active=true',
      [digest(sid)],
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException('Session expired');
    const csrf = keyed('csrf:' + sid);
    req.actor = { id: row.id, email: row.email, role: row.role, sessionId: row.session_id, csrf };
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]) || ['owner'];
    if (!roles.includes(row.role)) {
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
        "INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
        [u.id, digest(sid), digest(csrf)],
      );
      await this.db.audit(c, u.id, 'auth.login', u.id);
    });
    res.cookie('jodo_session', sid, { ...secureCookie(), maxAge: 8 * 60 * 60 * 1000 });
    res.setHeader('Cache-Control', 'no-store');
    return { user: { id: u.id, email: u.email, role: u.role }, csrf };
  }
  @Get('me') @UseGuards(AuthGuard) @Roles('owner', 'editor', 'sales', 'analyst') me(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return {
      user: { id: req.actor.id, email: req.actor.email, role: req.actor.role },
      csrf: req.actor.csrf,
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
