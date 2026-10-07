import { z } from 'zod';
import { Db } from '../../api/src/db';

const debitProviderResponseSchema = z
  .object({
    providerReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{3,120}$/),
    status: z.enum(['accepted', 'rejected']),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{2,80}$/)
      .optional(),
  })
  .strict();

function configuredHosts() {
  return new Set(
    (process.env.AUTOPAY_ALLOWED_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function safeProviderUrl(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error('AUTOPAY_DEBIT_CREATE_URL_UNSAFE');
  const local =
    process.env.DEPLOYMENT_MODE !== 'production' &&
    ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('AUTOPAY_DEBIT_CREATE_URL_NOT_HTTPS');
  if (!configuredHosts().has(url.hostname.toLowerCase()))
    throw new Error('AUTOPAY_DEBIT_CREATE_URL_NOT_ALLOWLISTED');
  return url;
}

function nextRetry(attemptNo: number) {
  if (attemptNo === 1) return "now()+interval '1 hour'";
  if (attemptNo === 2) return "now()+interval '24 hours'";
  return "now()+interval '48 hours'";
}

export async function submitAutopayDebit(db: Db, eventId: string) {
  if (process.env.AUTOPAY_PROVIDER_MODE !== 'mandate_api') return 'disabled';

  const attempt = (
    await db.query(
      `SELECT a.*,m.provider_reference AS mandate_reference
       FROM autopay_debit_attempts a
       JOIN payment_mandates m ON m.id=a.mandate_id
       JOIN outbox o ON o.aggregate_id=a.id
       WHERE o.event_id=$1 AND o.type='autopay.debit.requested'
       LIMIT 1`,
      [eventId],
    )
  )[0];
  if (!attempt) throw new Error('AUTOPAY_ATTEMPT_NOT_FOUND');
  if (attempt.status === 'submitted' || attempt.status === 'confirmed') return 'provider_accepted';
  if (attempt.status === 'cancelled') return 'provider_accepted';

  const maxAttempts = Math.max(1, Math.min(10, Number(process.env.AUTOPAY_MAX_ATTEMPTS || 3)));
  const url = safeProviderUrl(process.env.AUTOPAY_DEBIT_CREATE_URL || '');
  const timeoutMs = Number(process.env.AUTOPAY_TIMEOUT_MS || 5000);
  const secret = process.env.AUTOPAY_API_KEY!;

  let result: z.infer<typeof debitProviderResponseSchema>;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/json',
        'Idempotency-Key': attempt.idempotency_key,
      },
      body: JSON.stringify({
        merchantAttemptId: attempt.id,
        scheduleId: attempt.schedule_id,
        installmentId: attempt.installment_id,
        mandateReference: attempt.mandate_reference,
        amountMinor: Number(attempt.amount_minor),
        currency: attempt.currency,
        metadata: {
          scheduleId: attempt.schedule_id,
          installmentId: attempt.installment_id,
          debitAttemptId: attempt.id,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error('PROVIDER_HTTP_' + response.status);
    result = debitProviderResponseSchema.parse(await response.json());
  } catch {
    await db.query(
      `UPDATE autopay_debit_attempts
       SET status='uncertain',failure_code='PROVIDER_SUBMIT_UNCERTAIN',
           next_retry_at=now()+interval '30 minutes',updated_at=now()
       WHERE id=$1 AND status IN('queued','uncertain')`,
      [attempt.id],
    );
    throw new Error('AUTOPAY_PROVIDER_SUBMIT_UNCERTAIN');
  }

  if (result.status === 'rejected') {
    const retrySql =
      attempt.attempt_no < maxAttempts ? nextRetry(Number(attempt.attempt_no)) : 'NULL';
    await db.tx(async (c) => {
      await c.query(
        `UPDATE autopay_debit_attempts
         SET provider_reference=$2,status='failed',failure_code=$3,
             next_retry_at=${retrySql},updated_at=now()
         WHERE id=$1`,
        [attempt.id, result.providerReference, result.reasonCode || 'PROVIDER_REJECTED'],
      );
      await db.audit(c, 'worker', 'fees.autopay.rejected', attempt.id, {
        installmentId: attempt.installment_id,
        providerReference: result.providerReference,
        attemptNo: Number(attempt.attempt_no),
        reasonCode: result.reasonCode || 'PROVIDER_REJECTED',
      });
    });
    return 'provider_accepted';
  }

  await db.tx(async (c) => {
    await c.query(
      `UPDATE autopay_debit_attempts
       SET provider_reference=$2,status='submitted',failure_code=NULL,next_retry_at=NULL,
           submitted_at=now(),updated_at=now()
       WHERE id=$1`,
      [attempt.id, result.providerReference],
    );
    await db.audit(c, 'worker', 'fees.autopay.submitted', attempt.id, {
      installmentId: attempt.installment_id,
      providerReference: result.providerReference,
      attemptNo: Number(attempt.attempt_no),
      amountMinor: Number(attempt.amount_minor),
    });
  });
  return 'provider_accepted';
}
