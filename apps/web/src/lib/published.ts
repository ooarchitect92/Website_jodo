import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { PublicPage } from '@core/contracts';
import { previewPages, defaultNavigation, formDefinition } from '@core/site';

const readonly = () =>
  process.env.REFERENCE_READONLY_PREVIEW === 'true' && process.env.DEPLOYMENT_MODE !== 'production';

export const baseUrl = () => process.env.SITE_URL || 'http://localhost:3000';

// Host selection is request-scoped, not a client-supplied query parameter.
// Unknown domains are resolved by the API and fail closed unless activated.
const tenantHostname = cache(async () => {
  const raw = (await headers()).get('host')?.trim().toLowerCase();
  if (!raw) return null;
  let hostname: string;
  try {
    hostname = new URL('http://' + raw).hostname;
  } catch {
    notFound();
  }
  if (hostname === new URL(baseUrl()).hostname) return null;
  if (
    process.env.DEPLOYMENT_MODE !== 'production' &&
    (hostname === 'localhost' || hostname === '127.0.0.1')
  )
    return null;
  return hostname;
});

const publicUrl = async (route: string) => {
  const url = new URL(route, process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000');
  const hostname = await tenantHostname();
  if (hostname) url.searchParams.set('hostname', hostname);
  return url;
};

export const pages = cache(async (): Promise<PublicPage[]> => {
  if (readonly() && !(await tenantHostname())) return previewPages;
  const r = await fetch(await publicUrl('/v1/public/pages'), {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (r.status === 404) notFound();
  if (!r.ok) throw Error('Published content is temporarily unavailable');
  return r.json();
});

export const site = cache(async () => {
  if (readonly() && !(await tenantHostname()))
    return {
      mode: 'read-only preview',
      tenantSite: false,
      canonicalOrigin: baseUrl(),
      settings: {
        navigation: defaultNavigation,
        brand: {
          name: process.env.NEXT_PUBLIC_BRAND_NAME || 'YourCompany',
          primary: process.env.NEXT_PUBLIC_BRAND_PRIMARY || '#0f766e',
        },
        form: formDefinition,
      },
      indexing: false,
    };
  const r = await fetch(await publicUrl('/v1/public/site'), {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (r.status === 404) notFound();
  if (!r.ok) throw Error('Site configuration unavailable');
  return r.json();
});
