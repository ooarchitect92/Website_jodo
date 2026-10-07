import { cache } from 'react';
import { PublicPage } from '@core/contracts';
import { previewPages, defaultNavigation, formDefinition } from '@core/site';
const readonly = () =>
  process.env.REFERENCE_READONLY_PREVIEW === 'true' && process.env.DEPLOYMENT_MODE !== 'production';
export const pages = cache(async (): Promise<PublicPage[]> => {
  if (readonly()) return previewPages;
  const r = await fetch(
    (process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000') + '/v1/public/pages',
    { cache: 'no-store', signal: AbortSignal.timeout(5000) },
  );
  if (!r.ok) throw Error('Published content is temporarily unavailable');
  return r.json();
});
export const site = cache(async () => {
  if (readonly())
    return {
      mode: 'read-only preview',
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
  const r = await fetch(
    (process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000') + '/v1/public/site',
    { cache: 'no-store', signal: AbortSignal.timeout(5000) },
  );
  if (!r.ok) throw Error('Site configuration unavailable');
  return r.json();
});
export const baseUrl = () => process.env.SITE_URL || 'http://localhost:3000';
