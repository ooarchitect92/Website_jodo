import nodemailer from 'nodemailer';
import { Db } from '../../api/src/db';
export async function notifyStaff(
  db: Db,
  eventId: string,
): Promise<'provider_accepted' | 'disabled' | 'uncertain' | 'failed'> {
  if (process.env.NOTIFICATION_MODE !== 'smtp') return 'disabled';
  const messageId = '<' + eventId + '@website-jodo.local>';
  const reserved = await db.tx(async (c) => {
    await c.query(
      'INSERT INTO notifications(event_id,message_id) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING',
      [eventId, messageId],
    );
    const row = (
      await c.query('SELECT * FROM notifications WHERE event_id=$1 FOR UPDATE', [eventId])
    ).rows[0];
    if (row.status !== 'pending') return false;
    await c.query("UPDATE notifications SET status='sending',updated_at=now() WHERE event_id=$1", [
      eventId,
    ]);
    return true;
  });
  if (!reserved) {
    const row = (
      await db.query('SELECT status FROM notifications WHERE event_id=$1', [eventId])
    )[0];
    return row?.status === 'provider_accepted' ? 'provider_accepted' : 'uncertain';
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    requireTLS: process.env.DEPLOYMENT_MODE === 'production',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.NOTIFICATION_TO,
      subject: 'New website enquiry — staff review required',
      text:
        'A new enquiry was durably accepted. Sign in to the owner console to review it: ' +
        process.env.SITE_URL +
        '/admin/\n\nNo customer contact data is included in this notification.',
      messageId,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const accepted = Array.isArray(result.accepted) && result.accepted.length > 0;
    await db.query(
      'UPDATE notifications SET status=$2,updated_at=now(),last_error=$3 WHERE event_id=$1',
      [
        eventId,
        accepted ? 'provider_accepted' : 'failed',
        accepted ? null : 'NO_RECIPIENT_ACCEPTED',
      ],
    );
    return accepted ? 'provider_accepted' : 'failed';
  } catch {
    await db.query(
      "UPDATE notifications SET status='uncertain',last_error='TRANSPORT_RESULT_UNCERTAIN',updated_at=now() WHERE event_id=$1",
      [eventId],
    );
    return 'uncertain';
  } finally {
    transport.close();
  }
}
