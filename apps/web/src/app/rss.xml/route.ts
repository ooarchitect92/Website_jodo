import { pages, baseUrl, site } from '@/lib/published';
export const dynamic = 'force-dynamic';
const x = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export async function GET() {
  const config = await site();
  if (config.tenantSite) return new Response('Not Found', { status: 404 });
  const posts = (await pages()).filter((p) => p.kind === 'post');
  return new Response(
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Website Jodo perspectives</title><link>' +
      x(baseUrl()) +
      '</link><description>Attributed reference overviews</description>' +
      posts
        .map(
          (p) =>
            '<item><title>' +
            x(p.body.title) +
            '</title><link>' +
            x(new URL(p.slug, baseUrl()).toString()) +
            '</link><guid>' +
            x(p.id) +
            '</guid><description>' +
            x(p.body.description) +
            '</description></item>',
        )
        .join('') +
      '</channel></rss>',
    {
      headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'X-Robots-Tag': 'noindex' },
    },
  );
}
