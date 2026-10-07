import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { Db } from './db';
import { secureCookie } from './auth';
import { LeadsService } from './leads';
import { digest, token } from '../../../packages/core/src/security';
import { leadSchema } from '../../../packages/core/src/contracts';
@Controller('v1/chat')
export class ChatController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(LeadsService) private leads: LeadsService,
  ) {}
  async session(req: Request) {
    const t = req.cookies?.jodo_chat;
    if (typeof t !== 'string') throw new ForbiddenException('Open a new support session');
    const c = (
      await this.db.query('SELECT * FROM chats WHERE token_hash=$1 AND expires_at>now()', [
        digest(t),
      ])
    )[0];
    if (!c) throw new ForbiddenException('Support session expired');
    return c;
  }
  @Post('start') async start(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let current;
    try {
      current = await this.session(req);
    } catch {
      const t = token();
      current = (
        await this.db.query('INSERT INTO chats(token_hash) VALUES($1) RETURNING *', [digest(t)])
      )[0];
      res.cookie('jodo_chat', t, { ...secureCookie(), maxAge: 86400000 });
    }
    return {
      status: current!.status,
      bot: 'Guided assistant — not a human or financial adviser',
      topics: ['Flex', 'Cred', 'Pay', 'Demo', 'Official support'],
    };
  }
  @Get('messages') async messages(@Req() req: Request) {
    const c = await this.session(req);
    return this.db.query(
      'SELECT client_id,topic,answer,created_at FROM chat_messages WHERE chat_id=$1 ORDER BY created_at LIMIT 100',
      [c.id],
    );
  }
  @Post('messages') async message(@Body() body: unknown, @Req() req: Request) {
    const v = z
      .object({
        clientId: z.uuid(),
        topic: z.enum(['Flex', 'Cred', 'Pay', 'Demo', 'Official support']),
      })
      .strict()
      .parse(body);
    const c = await this.session(req);
    const old = (
      await this.db.query('SELECT answer FROM chat_messages WHERE chat_id=$1 AND client_id=$2', [
        c.id,
        v.clientId,
      ])
    )[0];
    if (old) return { answer: old.answer };
    let answer =
      'Use the demo form to submit an enquiry to this installation. Do not provide banking details or authentication codes.';
    if (['Flex', 'Cred', 'Pay'].includes(v.topic)) {
      const product = (
        await this.db.query(
          "SELECT r.body FROM content c JOIN revisions r ON r.id=c.published_revision WHERE c.slug='/products/' AND c.deleted_at IS NULL",
        )
      )[0];
      const block = product?.body?.blocks?.find(
        (b: { type: string; title: string }) => b.type === 'product' && b.title === v.topic,
      );
      answer = block
        ? block.text +
          ' Learn more on /products/. These are reference descriptions; no payment or loan application is processed here.'
        : 'That product’s approved information is unavailable. Please use the contact page.';
    }
    if (v.topic === 'Official support')
      answer =
        'This demo cannot access Jodo accounts. Use the official Jodo website or the external student/institute login links. Never send passwords or OTPs here.';
    await this.db.query(
      'INSERT INTO chat_messages(chat_id,client_id,topic,answer) VALUES($1,$2,$3,$4) ON CONFLICT(chat_id,client_id) DO NOTHING',
      [c.id, v.clientId, v.topic, answer],
    );
    return { answer };
  }
  @Post('leads') async capture(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @Req() req: Request,
  ) {
    const chat = await this.session(req);
    const v = leadSchema.parse(body);
    if (v.source !== 'chat') throw new ForbiddenException('Use source chat for this capture');
    return this.leads.accept(v, key, req, chat.id);
  }
  @Post('handoff') async handoff(@Req() req: Request) {
    const c = await this.session(req);
    await this.db.tx(async (db) => {
      await db.query("UPDATE chats SET status='awaiting_agent' WHERE id=$1", [c.id]);
      await db.query(
        "INSERT INTO tasks(title,execution_key) VALUES('Review a requested chat handoff',$1) ON CONFLICT(execution_key) DO NOTHING",
        ['chat:' + c.id],
      );
      await this.db.audit(db, 'visitor', 'chat.handoff_requested', c.id);
    });
    return {
      status: 'awaiting_agent',
      message:
        'A review task was created. No agent has joined this conversation; use the enquiry form for a callback.',
    };
  }
}
