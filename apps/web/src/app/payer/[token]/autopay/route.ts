import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token))
    return NextResponse.redirect(new URL('/?mandate=invalid', req.url), 303);

  const form = await req.formData();
  const rail = String(form.get('rail') || '');
  const idempotencyKey = String(form.get('idempotencyKey') || '');
  if (!['upi_autopay', 'enach'].includes(rail) || !/^[0-9a-f-]{36}$/i.test(idempotencyKey))
    return NextResponse.redirect(
      new URL('/payer/' + encodeURIComponent(token) + '/?mandate=invalid', req.url),
      303,
    );

  const base = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
  try {
    const response = await fetch(base + '/v1/payer/' + encodeURIComponent(token) + '/mandates', {
      method: 'POST',
      headers: {
        Origin: process.env.SITE_URL!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rail, idempotencyKey }),
      cache: 'no-store',
      signal: AbortSignal.timeout(7000),
    });
    const data = await response.json();
    if (!response.ok || !data.authorizationUrl)
      return NextResponse.redirect(
        new URL('/payer/' + encodeURIComponent(token) + '/?mandate=failed', req.url),
        303,
      );
    return NextResponse.redirect(data.authorizationUrl, 303);
  } catch {
    return NextResponse.redirect(
      new URL('/payer/' + encodeURIComponent(token) + '/?mandate=unavailable', req.url),
      303,
    );
  }
}
