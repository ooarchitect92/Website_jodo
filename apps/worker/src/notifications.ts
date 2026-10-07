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


type FeePayerProfile = {
  displayName: string;
  email?: string;
  phone?: string;
  preferredChannel: 'email' | 'whatsapp' | 'none';
};

export async function notifyFeePayer(
  db: Db,
  eventId: string,
): Promise<'provider_accepted' | 'disabled' | 'uncertain' | 'failed'> {
  const rows = await db.query(
    `SELECT l.*,p.encrypted_profile,i.due_date,i.amount_minor,i.paid_amount_minor,
            s.account_reference
     FROM fee_communication_log l
     JOIN fee_payers p ON p.id=l.payer_id
     JOIN fee_installments i ON i.id=l.installment_id
     JOIN fee_schedules s ON s.id=l.schedule_id
     WHERE l.event_id=$1`,
    [eventId],
  );
  const log = rows[0];
  if (!log) return 'disabled';
  if (log.channel !== 'email' || process.env.PAYER_NOTIFICATION_MODE !== 'smtp') {
    await db.query(
      `UPDATE fee_communication_log
       SET status='blocked',last_error='CHANNEL_NOT_ACTIVATED',updated_at=now()
       WHERE event_id=$1`,
      [eventId],
    );
    return 'disabled';
  }
  const { decrypt } = await import('../../../packages/core/src/security');
  const profile = decrypt<FeePayerProfile>(log.encrypted_profile);
  if (!profile.email) {
    await db.query(
      `UPDATE fee_communication_log
       SET status='blocked',last_error='NO_EMAIL_ADDRESS',updated_at=now()
       WHERE event_id=$1`,
      [eventId],
    );
    return 'disabled';
  }

  const messageId = '<fee-' + eventId + '@education-payments.local>';
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
    await c.query(
      `UPDATE fee_communication_log SET status='pending',updated_at=now() WHERE event_id=$1`,
      [eventId],
    );
    return true;
  });
  if (!reserved) {
    const row = (await db.query('SELECT status FROM notifications WHERE event_id=$1', [eventId]))[0];
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

  const due = new Date(log.due_date).toLocaleDateString('en-IN');
  const outstanding = Math.max(0, Number(log.amount_minor) - Number(log.paid_amount_minor));
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    outstanding / 100,
  );
  const kindText: Record<string, string> = {
    upcoming_3d: `An installment of ${amount} is due on ${due}.`,
    due_today: `An installment of ${amount} is due today (${due}).`,
    overdue: `An installment of ${amount} is overdue from ${due}.`,
    receipt: 'A payment has been recorded and a receipt is available in your secure payer portal.',
  };
  try {
    const result = await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: profile.email,
      subject:
        log.kind === 'receipt'
          ? 'Payment receipt available'
          : 'Fee payment reminder — ' + log.account_reference,
      text:
        `Hello ${profile.displayName},\n\n` +
        (kindText[log.kind] || 'There is an update to your fee schedule.') +
        '\n\nUse the secure payer portal link provided by your institute to review your schedule and receipts.' +
        '\n\nThis message never asks for card, bank or UPI credentials.',
      messageId,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const accepted = Array.isArray(result.accepted) && result.accepted.length > 0;
    await db.tx(async (c) => {
      await c.query(
        'UPDATE notifications SET status=$2,updated_at=now(),last_error=$3 WHERE event_id=$1',
        [eventId, accepted ? 'provider_accepted' : 'failed', accepted ? null : 'NO_RECIPIENT_ACCEPTED'],
      );
      await c.query(
        `UPDATE fee_communication_log
         SET status=$2,provider_reference=$3,last_error=$4,updated_at=now()
         WHERE event_id=$1`,
        [
          eventId,
          accepted ? 'provider_accepted' : 'failed',
          accepted ? messageId : null,
          accepted ? null : 'NO_RECIPIENT_ACCEPTED',
        ],
      );
    });
    return accepted ? 'provider_accepted' : 'failed';
  } catch {
    await db.tx(async (c) => {
      await c.query(
        "UPDATE notifications SET status='uncertain',last_error='TRANSPORT_RESULT_UNCERTAIN',updated_at=now() WHERE event_id=$1",
        [eventId],
      );
      await c.query(
        "UPDATE fee_communication_log SET status='uncertain',last_error='TRANSPORT_RESULT_UNCERTAIN',updated_at=now() WHERE event_id=$1",
        [eventId],
      );
    });
    return 'uncertain';
  } finally {
    transport.close();
  }
}
