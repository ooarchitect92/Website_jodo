import { MetadataRoute } from 'next';
import { baseUrl, site } from '@/lib/published';
export const dynamic = 'force-dynamic';
export default async function robots(): Promise<MetadataRoute.Robots> {
  const config = await site();
  const origin = config.canonicalOrigin || baseUrl();
  return {
    rules: {
      userAgent: '*',
      ...(config.indexing
        ? { allow: '/', disallow: ['/admin/', '/api/', '/search/', '/login/'] }
        : { disallow: '/' }),
    },
    sitemap: origin + '/sitemap.xml',
  };
}
