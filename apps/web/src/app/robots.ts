import { MetadataRoute } from 'next';
import { baseUrl } from '@/lib/published';
export default function robots(): MetadataRoute.Robots {
  const enabled =
    process.env.PUBLIC_INDEXING_ENABLED === 'true' && process.env.SITE_APPROVED === 'true';
  return {
    rules: {
      userAgent: '*',
      ...(enabled
        ? { allow: '/', disallow: ['/admin/', '/api/', '/search/', '/login/'] }
        : { disallow: '/' }),
    },
    sitemap: baseUrl() + '/sitemap.xml',
  };
}
