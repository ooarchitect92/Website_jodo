import { NextRequest, NextResponse } from 'next/server';

function siteBase() {
  return (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const origin = request.headers.get('origin');
  if (origin !== siteBase())
    return new NextResponse('Request origin is not allowed', { status: 403 });

  const form = await request.formData();
  const installmentId = String(form.get('installmentId') || '');
  const amountMinor = Number(form.get('amountMinor'));
  const idempotencyKey = String(form.get('idempotencyKey') || '');
  if (
    !/^[0-9a-f-]{36}$/i.test(installmentId) ||
    !Number.isInteger(amountMinor) ||
    amountMinor <= 0 ||
    !/^[0-9a-f-]{36}$/i.test(idempotencyKey)
  )
    return NextResponse.redirect(siteBase() + '/payer/' + encodeURIComponent(token) + '/?checkout=invalid', 303);

  const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
  const response = await fetch(api + '/v1/payer/' + encodeURIComponent(token) + '/checkout', {
    method: 'POST',
    headers: {
      Origin: siteBase(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      installmentId,
      amountMinor,
      idempotencyKey,
      allocations: [],
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  if (!response)
    return NextResponse.redirect(
      siteBase() + '/payer/' + encodeURIComponent(token) + '/?checkout=unavailable',
      303,
    );

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.checkoutUrl)
    return NextResponse.redirect(
      siteBase() + '/payer/' + encodeURIComponent(token) + '/?checkout=unavailable',
      303,
    );

  let checkout: URL;
  try {
    checkout = new URL(data.checkoutUrl);
  } catch {
    return NextResponse.redirect(
      siteBase() + '/payer/' + encodeURIComponent(token) + '/?checkout=unavailable',
      303,
    );
  }
  if (checkout.protocol !== 'https:' && process.env.NODE_ENV === 'production')
    return NextResponse.redirect(
      siteBase() + '/payer/' + encodeURIComponent(token) + '/?checkout=unavailable',
      303,
    );
  return NextResponse.redirect(checkout, 303);
}
