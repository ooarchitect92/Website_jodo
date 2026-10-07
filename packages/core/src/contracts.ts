import { z } from 'zod';
export const safePath = z
  .string()
  .max(240)
  .regex(/^\/(?:[a-z0-9][a-z0-9\-/]*)?$/)
  .refine((s) => !s.includes('//') && !s.includes('..'), 'Use an internal lowercase path');
export const safeLink = z
  .string()
  .max(500)
  .refine((s) => {
    if (/[\x00-\x20]/.test(s)) return false;
    if (s.startsWith('/') && !s.startsWith('//') && !s.includes('\\')) return true;
    try {
      const u = new URL(s);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'Use a local path or HTTPS link');
export const localImage = z
  .string()
  .max(300)
  .refine(
    (s) => !s || (/^\/(reference|media)\/[-\w./]+$/.test(s) && !s.includes('..')),
    'Use a registered local image path',
  );
export const itemSchema = z
  .object({
    title: z.string().max(180),
    text: z.string().max(1800).default(''),
    image: localImage.optional(),
    href: safeLink.optional(),
    label: z.string().max(80).optional(),
  })
  .strict();
export const blockSchema = z
  .object({
    id: z.string().min(1).max(80),
    type: z.enum([
      'hero',
      'logos',
      'stats',
      'products',
      'features',
      'security',
      'stories',
      'steps',
      'articles',
      'cta',
      'text',
      'faq',
      'product',
      'team',
      'form',
      'calculator',
    ]),
    title: z.string().max(240).default(''),
    accent: z.string().max(160).optional(),
    eyebrow: z.string().max(100).optional(),
    text: z.string().max(6000).default(''),
    image: localImage.optional(),
    imageAlt: z.string().max(200).optional(),
    href: safeLink.optional(),
    label: z.string().max(80).optional(),
    items: z.array(itemSchema).max(30).default([]),
    tone: z.enum(['white', 'lavender', 'gradient', 'blue']).default('white'),
    reverse: z.boolean().default(false),
  })
  .strict()
  .refine(
    (b) => !b.image || (/^\/(reference|media)\/[-\w./]+$/.test(b.image) && !b.image.includes('..')),
    'Use a registered local image',
  );
export const pageSchema = z
  .object({
    title: z.string().min(3).max(200),
    description: z.string().min(10).max(300),
    blocks: z.array(blockSchema).min(1).max(50),
    category: z.string().max(50).default(''),
    cover: localImage.default(''),
    author: z.string().max(100).default('Editorial team'),
    sourceUrl: safeLink.optional(),
    sourceDate: z.string().max(30).optional(),
    indexable: z.boolean().default(false),
  })
  .strict();
export type PageBody = z.infer<typeof pageSchema>;
export type Block = z.infer<typeof blockSchema>;
export interface PublicPage {
  id: string;
  slug: string;
  kind: 'page' | 'post' | 'case';
  body: PageBody;
  revision: string;
  modifiedAt: string;
}
export const leadSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.email().max(200),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d ()-]{8,20}$/),
    institute: z.string().trim().min(2).max(180),
    role: z.enum(['Owner', 'Principal', 'Finance', 'Administrator', 'Other']),
    students: z.number().int().min(1).max(10000000),
    city: z.string().trim().min(2).max(100),
    interest: z.enum(['Flex', 'Cred', 'Pay', 'Not sure']),
    message: z.string().max(1500).default(''),
    noticeAccepted: z.literal(true),
    marketingOptIn: z.boolean().default(false),
    website: z.string().max(0).default(''),
    formRevision: z.string().regex(/^demo-v[1-9][0-9]*$/),
    source: z.enum(['form', 'chat']).default('form'),
  })
  .strict();
export type LeadInput = z.infer<typeof leadSchema>;

export const moneyMinor = z.number().int().positive().max(1_000_000_000_000);
export const feeInstallmentInputSchema = z
  .object({
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountMinor: moneyMinor,
  })
  .strict();
export const feeScheduleCreateSchema = z
  .object({
    accountReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{2,80}$/),
    payerId: z.uuid().optional(),
    currency: z.literal('INR').default('INR'),
    installments: z.array(feeInstallmentInputSchema).min(1).max(60),
    note: z.string().trim().max(300).default(''),
  })
  .strict()
  .superRefine((value, ctx) => {
    const dates = value.installments.map((i) => i.dueDate);
    if (new Set(dates).size !== dates.length)
      ctx.addIssue({
        code: 'custom',
        path: ['installments'],
        message: 'Installment due dates must be unique',
      });
  });
export const feeScheduleActivationSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const externalPaymentRecordSchema = z
  .object({
    installmentId: z.uuid(),
    amountMinor: moneyMinor,
    currency: z.literal('INR'),
    providerReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{3,120}$/),
    idempotencyKey: z.uuid(),
    evidenceNote: z.string().trim().min(3).max(300),
  })
  .strict();

export const paymentProviderEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      eventId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._:-]{3,160}$/),
      type: z.literal('payment_confirmed'),
      installmentId: z.uuid(),
      providerReference: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._:-]{3,120}$/),
      amountMinor: moneyMinor,
      currency: z.literal('INR'),
      occurredAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      eventId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._:-]{3,160}$/),
      type: z.literal('payment_failed'),
      installmentId: z.uuid(),
      providerReference: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._:-]{3,120}$/),
      amountMinor: moneyMinor,
      currency: z.literal('INR'),
      reasonCode: z
        .string()
        .trim()
        .regex(/^[A-Z0-9_-]{2,80}$/),
      occurredAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      eventId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._:-]{3,160}$/),
      type: z.literal('mandate_status'),
      scheduleId: z.uuid(),
      rail: z.enum(['upi_autopay', 'enach']),
      providerReference: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._:-]{3,120}$/),
      status: z.enum(['pending', 'active', 'paused', 'revoked', 'failed']),
      occurredAt: z.iso.datetime(),
    })
    .strict(),
]);

export const refundRecordSchema = z
  .object({
    paymentId: z.uuid(),
    amountMinor: moneyMinor,
    idempotencyKey: z.uuid(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export const mandateRecordSchema = z
  .object({
    scheduleId: z.uuid(),
    rail: z.enum(['upi_autopay', 'enach']),
    providerReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{3,120}$/),
    status: z.enum(['pending', 'active', 'paused', 'revoked', 'failed']),
  })
  .strict();

export const feeHeadSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_]{2,40}$/),
    name: z.string().trim().min(2).max(100),
    settlementAccountKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{2,80}$/)
      .optional(),
  })
  .strict();

export const installmentComponentSchema = z
  .object({
    installmentId: z.uuid(),
    components: z
      .array(
        z
          .object({
            feeHeadId: z.uuid(),
            amountMinor: moneyMinor,
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.components.map((x) => x.feeHeadId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Fee heads must be unique per installment',
      });
  });

export const feeAdjustmentSchema = z
  .object({
    installmentId: z.uuid(),
    kind: z.enum(['discount', 'concession', 'late_fee', 'waiver']),
    amountMinor: moneyMinor,
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const feeAdjustmentReverseSchema = z
  .object({
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const collectionPageCreateSchema = z
  .object({
    scheduleId: z.uuid(),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(600).default(''),
    allowFull: z.boolean().default(true),
    allowPartial: z.boolean().default(false),
    allowCustom: z.boolean().default(false),
    minimumMinor: moneyMinor.optional(),
    maximumMinor: moneyMinor.optional(),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.allowFull && !value.allowPartial && !value.allowCustom)
      ctx.addIssue({
        code: 'custom',
        path: ['allowFull'],
        message: 'Enable at least one collection mode',
      });
    if (
      value.minimumMinor !== undefined &&
      value.maximumMinor !== undefined &&
      value.maximumMinor < value.minimumMinor
    )
      ctx.addIssue({
        code: 'custom',
        path: ['maximumMinor'],
        message: 'Maximum must be at least the minimum',
      });
  });

export const collectionIntentSchema = z
  .object({
    installmentId: z.uuid().optional(),
    mode: z.enum(['full', 'partial', 'custom']),
    amountMinor: moneyMinor.optional(),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const feePayerProfileSchema = z
  .object({
    accountReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{2,80}$/),
    displayName: z.string().trim().min(2).max(120),
    email: z.email().max(200).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d ()-]{8,20}$/)
      .optional(),
    preferredChannel: z.enum(['email', 'whatsapp', 'none']).default('email'),
    locale: z.enum(['en-IN']).default('en-IN'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.preferredChannel === 'email' && !v.email)
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Email is required for email reminders',
      });
    if (v.preferredChannel === 'whatsapp' && !v.phone)
      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'Phone is required for WhatsApp reminders',
      });
  });
export const payerLinkSchema = z
  .object({
    expiresHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(72),
  })
  .strict();

export const consentSchema = z
  .object({
    analytics: z.boolean(),
    advertising: z.boolean(),
    policyVersion: z.literal('2026-10-v1'),
  })
  .strict();
export const eventSchema = z
  .object({
    id: z.uuid(),
    name: z.enum([
      'page_view',
      'cta_click',
      'faq_open',
      'form_start',
      'form_validation_error',
      'download_click',
      'section_view',
    ]),
    route: safePath,
    actionId: z
      .string()
      .max(80)
      .regex(/^[a-z0-9_-]+$/)
      .optional(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export const navSchema = z
  .array(z.object({ label: z.string().min(1).max(40), href: safeLink }))
  .max(12);
export const campaignSchema = z
  .object({
    name: z.string().min(3).max(80),
    path: safePath,
    source: z.enum(['google', 'meta', 'email', 'partner', 'qr']),
    medium: z.enum(['cpc', 'paid_social', 'email', 'referral', 'qr']),
    campaign: z.string().regex(/^[a-z0-9_-]{2,80}$/),
  })
  .strict();
export const workflowSchema = z
  .object({
    name: z.string().min(3).max(100),
    nodes: z
      .array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('task'), title: z.string().min(3).max(160) }).strict(),
          z
            .object({ type: z.literal('delay'), minutes: z.number().int().min(1).max(10080) })
            .strict(),
          z.object({ type: z.literal('exit_if_contacted') }).strict(),
        ]),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type Workflow = z.infer<typeof workflowSchema>;
export function simulateWorkflow(workflow: Workflow, now: Date, contacted = false) {
  let due = now.getTime();
  const result: { type: string; at: string; title?: string }[] = [];
  for (const node of workflow.nodes) {
    if (node.type === 'delay') due += node.minutes * 60000;
    else if (node.type === 'exit_if_contacted' && contacted) {
      result.push({ type: 'cancelled', at: new Date(due).toISOString() });
      break;
    } else if (node.type === 'task')
      result.push({ type: 'task', title: node.title, at: new Date(due).toISOString() });
  }
  return result;
}
export function sanitizeCampaign(input: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content']) {
    const v = input[key];
    if (typeof v === 'string' && /^[a-z0-9_-]{1,80}$/i.test(v) && !/[0-9]{7}/.test(v))
      result[key] = v;
  }
  return result;
}
export function estimateCost(input: {
  students: number;
  annualFee: number;
  onTime: number;
  delayDays: number;
  capitalRate: number;
  staffMonthly: number;
  staffShare: number;
}) {
  for (const n of Object.values(input))
    if (!Number.isFinite(n) || n < 0) throw new Error('All inputs must be finite and non-negative');
  if (
    input.onTime > 100 ||
    input.staffShare > 100 ||
    input.capitalRate > 100 ||
    input.delayDays > 365
  )
    throw new Error('Input outside estimate limits');
  const annualFees = input.students * input.annualFee;
  const delayed = annualFees * (1 - input.onTime / 100);
  const financing = delayed * (input.capitalRate / 100) * (input.delayDays / 365);
  const administration =
    Math.ceil(input.students / 400) * 2 * input.staffMonthly * 12 * (input.staffShare / 100);
  return { annualFees, delayed, financing, administration, total: financing + administration };
}
export function scoreLead(input: Pick<LeadInput, 'role' | 'interest'>) {
  const contributions = [
    { reason: 'An explicit product was selected', points: input.interest === 'Not sure' ? 0 : 20 },
    {
      reason: 'A decision-making role was declared',
      points: ['Owner', 'Principal'].includes(input.role) ? 20 : 10,
    },
  ];
  return {
    score: contributions.reduce((a, b) => a + b.points, 0),
    ruleVersion: 'declared-fit-v1',
    contributions,
    qualification: 'Not inferred from score',
  };
}
export function csvCell(value: unknown) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
