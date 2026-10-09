import { MetadataRoute } from 'next';
import { pages, site, baseUrl } from '@/lib/published';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = await site();
  if (!config.indexing) return [];
  return (await pages())
    .filter((p) => p.body.indexable)
    .map((p) => ({ url: new URL(p.slug, config.canonicalOrigin || baseUrl()).toString(), lastModified: p.modifiedAt }));
}
