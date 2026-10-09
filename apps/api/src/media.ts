import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import sharp from 'sharp';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthedRequest, Roles } from './auth';
import { digest } from '../../../packages/core/src/security';
@Controller('v1')
export class MediaController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('media/:filename') async serve(@Param('filename') name: string, @Res() res: Response) {
    if (!/^[a-f0-9-]{36}\.webp$/.test(name))
      throw new UnprocessableEntityException('Invalid media reference');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
    res.type('webp').sendFile(resolve(process.env.MEDIA_DIRECTORY || '.data/media', name));
  }
  @Get('admin/media')
  @UseGuards(AuthGuard)
  @Roles('owner', 'editor')
  async list(@Req() req: AuthedRequest) {
    return this.db.query(
      'SELECT * FROM media WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200',
      [req.actor.tenantId],
    );
  }
  @Post('admin/media')
  @UseGuards(AuthGuard)
  @Roles('owner', 'editor')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 2 } }),
  )
  async upload(
    @UploadedFile() file: { buffer: Buffer },
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const v = z
      .object({ alt: z.string().min(3).max(200), rights: z.string().min(5).max(300) })
      .strict()
      .parse(body);
    if (!file?.buffer) throw new UnprocessableEntityException('Choose an image');
    let bytes: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 24000000 });
      const info = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(info.format || '')) throw Error('format');
      bytes = await image
        .rotate()
        .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new UnprocessableEntityException('Use a valid JPEG, PNG or WebP image under 4 MB');
    }
    const id = randomUUID();
    const path = '/media/' + id + '.webp';
    await mkdir(resolve(process.env.MEDIA_DIRECTORY || '.data/media'), { recursive: true });
    await writeFile(resolve(process.env.MEDIA_DIRECTORY || '.data/media', id + '.webp'), bytes, {
      flag: 'wx',
    });
    try {
      return await this.db.tx(async (c) => {
        await c.query(
          'INSERT INTO media(id,path,alt,rights,checksum,created_by,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [id, path, v.alt, v.rights, digest(bytes.toString('base64')), req.actor.id, req.actor.tenantId],
        );
        await this.db.audit(c, req.actor.id, 'media.create', id);
        return { id, path, alt: v.alt };
      });
    } catch (error) {
      // A failed database transaction must not leave an untracked public media file.
      await unlink(resolve(process.env.MEDIA_DIRECTORY || '.data/media', id + '.webp')).catch(
        () => undefined,
      );
      throw error;
    }
  }
}
