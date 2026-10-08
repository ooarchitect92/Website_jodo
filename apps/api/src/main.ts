import 'reflect-metadata';
import {
  Catch,
  Controller,
  ExceptionFilter,
  ArgumentsHost,
  Get,
  Inject,
  Module,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { Db } from './db';
import { checkConfig } from './config';
import { AuthController, AuthGuard } from './auth';
import { ContentController, PublicContentController, SettingsController } from './content';
import { FormsController, LeadsController, LeadsService } from './leads';
import { PrivacyController } from './privacy';
import { OperationsController } from './operations';
import { ChatController } from './chat';
import { MediaController } from './media';
import { FeeOperationsController } from './fees';
import { PayerAdminController, PayerLinkAdminController, PayerPortalController } from './payer';
import { PaymentProviderAdminController, PaymentProviderController } from './payment-provider';
import { PayerCheckoutController, PaymentReturnController } from './payment-checkout';
import {
  AutopayAdminController,
  MandateReturnController,
  PayerMandateController,
} from './mandate-autopay';
import { TenancyController } from './tenancy';
import { AcademicOperationsController } from './academic';
import { keyed } from '../../../packages/core/src/security';
@Catch()
class SafeErrors implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status =
      e instanceof ZodError
        ? 422
        : e.getStatus?.() || (e.code === '23505' ? 409 : e.code === '23503' ? 422 : 500);
    if (status < 400 || status > 599) status = 500;
    const message =
      e instanceof ZodError
        ? 'Please check the highlighted fields.'
        : status < 500
          ? typeof e.message === 'string'
            ? e.message
            : 'Request rejected'
          : 'The service could not complete the request. No success is confirmed; retry with the same submission key.';
    res.status(status).json({
      code: e instanceof ZodError ? 'VALIDATION_FAILED' : `HTTP_${status}`,
      message,
      ...(e instanceof ZodError
        ? { fields: e.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }
        : {}),
    });
  }
}
@Controller('health')
class Health {
  constructor(@Inject(Db) private db: Db) {}
  @Get('live') live() {
    return { status: 'alive' };
  }
  @Get('ready') async ready() {
    await this.db.query('SELECT 1');
    return { status: 'ready' };
  }
}
@Module({
  controllers: [
    Health,
    AuthController,
    ContentController,
    PublicContentController,
    SettingsController,
    FormsController,
    LeadsController,
    PrivacyController,
    OperationsController,
    ChatController,
    MediaController,
    FeeOperationsController,
    PayerAdminController,
    PayerLinkAdminController,
    PayerPortalController,
    PaymentProviderController,
    PaymentProviderAdminController,
    PayerCheckoutController,
    PaymentReturnController,
    PayerMandateController,
    MandateReturnController,
    AutopayAdminController,
    TenancyController,
    AcademicOperationsController,
  ],
  providers: [Db, AuthGuard, LeadsService],
})
class AppModule {}
export async function createApp() {
  checkConfig();
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
    bodyParser: true,
    rawBody: true,
  });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.useGlobalFilters(new SafeErrors());
  const db = app.get(Db);
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Request-Id', crypto.randomUUID());
    if (
      req.path.startsWith('/v1/admin') ||
      req.path.startsWith('/v1/auth') ||
      req.path.startsWith('/v1/chat') ||
      req.path.startsWith('/v1/provider/') ||
      req.path.startsWith('/v1/payer/') ||
      req.path.startsWith('/v1/payment-return/') ||
      req.path.startsWith('/v1/mandate-return/')
    )
      res.setHeader('Cache-Control', 'no-store');
    const providerWebhook = req.path.startsWith('/v1/provider/');
    if (
      !providerWebhook &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin !== process.env.SITE_URL
    )
      return res.status(403).json({ message: 'Request origin is not allowed' });
    next();
  });
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET') return next();
    try {
      const key = 'request:' + keyed(req.socket.remoteAddress || 'unknown');
      const row = (
        await db.query(
          "INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+interval '1 minute' ELSE rate_limits.expires_at END RETURNING count",
          [key],
        )
      )[0];
      if (row!.count > 300) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ message: 'Please wait before trying again' });
      }
      next();
    } catch {
      res
        .status(503)
        .json({ message: 'Service temporarily unavailable; no submission has been accepted' });
    }
  });
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Education Payments Platform API')
      .setVersion('1.0')
      .addCookieAuth('jodo_session')
      .build(),
  );
  if (process.env.DEPLOYMENT_MODE !== 'production') SwaggerModule.setup('docs', app, doc);
  app.enableShutdownHooks();
  await app.init();
  return app;
}
if (require.main === module)
  createApp()
    .then((app) => app.listen(Number(process.env.API_PORT || 4000), '0.0.0.0'))
    .catch(() => {
      console.error('API startup failed; check required configuration and database availability.');
      process.exitCode = 1;
    });
