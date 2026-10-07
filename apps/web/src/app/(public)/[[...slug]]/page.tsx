import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { pages, baseUrl, site } from '@/lib/published';
import { BlockRenderer, ArticleCards } from '@/components/blocks';
import { SmartLink } from '@/components/links';
import { CookiePreferences } from '@/components/consent';
import { PrivacyRequest } from '@/components/privacy-request';
type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const pathFor = (slug?: string[]) => (slug?.length ? '/' + slug.join('/') + '/' : '/');
export const dynamic = 'force-dynamic';
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const path = pathFor(slug);
  const data = await pages();
  const found = data.find((p) => p.slug === path);
  const config = await site();
  const title =
    found?.body.title ||
    (
      {
        '/blog/': 'Perspectives | YourCompany',
        '/case-studies/': 'Case studies | YourCompany',
        '/search/': 'Search | YourCompany',
        '/cookie-preferences/': 'Privacy choices | YourCompany',
      } as Record<string, string>
    )[path] ||
    (process.env.NEXT_PUBLIC_BRAND_NAME || 'YourCompany');
  return {
    title,
    description: found?.body.description || 'Browse the education payments platform.',
    alternates: { canonical: new URL(path, baseUrl()).toString() },
    robots: { index: !!config.indexing && !!found?.body.indexable, follow: !!config.indexing },
    openGraph: {
      title,
      description: found?.body.description || (process.env.NEXT_PUBLIC_BRAND_NAME || 'YourCompany'),
      url: new URL(path, baseUrl()).toString(),
      ...(found?.body.cover ? { images: [new URL(found.body.cover, baseUrl()).toString()] } : {}),
    },
  };
}
export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params;
  const path = pathFor(slug);
  const all = await pages();
  const search = await searchParams;
  if (path === '/cookie-preferences/') return <CookiePreferences />;
  const blog = path === '/blog/' || /^\/blog\/(engineering|insight|product)\/$/.test(path),
    cases = path === '/case-studies/',
    isSearch = path === '/search/';
  if (blog || cases || isSearch) {
    const category = blog && slug?.length === 2 ? slug[1] : null;
    const q = typeof search.q === 'string' ? search.q.slice(0, 100) : '';
    const filtered = all.filter(
      (p) =>
        (isSearch || p.kind === (cases ? 'case' : 'post')) &&
        (!category || p.body.category.toLowerCase() === category) &&
        (!q || (p.body.title + ' ' + p.body.description).toLowerCase().includes(q.toLowerCase())),
    );
    const n = Math.max(1, Math.min(100, Number(search.page) || 1));
    const selected = filtered.slice((n - 1) * 9, n * 9);
    return (
      <section className="wrap section listing">
        <div className="section-heading">
          <p className="eyebrow">{isSearch ? 'Find your next step' : 'Perspectives'}</p>
          <h1>
            {cases
              ? 'Stories from institutes.'
              : isSearch
                ? 'Search the website.'
                : 'Ideas worth sharing.'}
          </h1>
          <p>
            {cases
              ? 'Customer stories are published only after company approval and evidence review.'
              : 'Education, payments and the engineering behind them.'}
          </p>
        </div>
        <div className="list-tools">
          {blog && (
            <nav className="filter-tabs" aria-label="Article category">
              {['All', 'Insight', 'Engineering', 'Product'].map((c) => (
                <Link
                  className={
                    (!category && c === 'All') || c.toLowerCase() === category ? 'selected' : ''
                  }
                  href={c === 'All' ? '/blog/' : '/blog/' + c.toLowerCase() + '/'}
                  key={c}
                >
                  {c}
                </Link>
              ))}
            </nav>
          )}
          <form role="search">
            <label className="sr-only" htmlFor="site-search">
              Search content
            </label>
            <input
              id="site-search"
              name="q"
              type="search"
              maxLength={100}
              placeholder="Search articles…"
              defaultValue={q}
            />
            <button className="button primary">Search</button>
          </form>
        </div>
        {selected.length ? (
          <ArticleCards items={selected} />
        ) : (
          <div className="empty-state">
            <h2>No results found.</h2>
            <p>Try a broader term or browse another category.</p>
          </div>
        )}
        <nav className="pagination" aria-label="Pagination">
          {Array.from({ length: Math.ceil(filtered.length / 9) }, (_, i) => (
            <Link
              key={i}
              aria-current={n === i + 1 ? 'page' : undefined}
              href={path + '?' + new URLSearchParams({ page: String(i + 1), ...(q ? { q } : {}) })}
            >
              {i + 1}
            </Link>
          ))}
        </nav>
        <p className="small muted">
          Article pages contain original reference overviews and link to the full source, rather
          than republishing the original articles.
        </p>
      </section>
    );
  }
  const p = all.find((p) => p.slug === path);
  if (!p) notFound();
  return (
    <>
      {p.kind !== 'page' && (
        <header className="article-header wrap narrow">
          <nav aria-label="Breadcrumb">
            <SmartLink href={p.kind === 'case' ? '/case-studies/' : '/blog/'}>
              ← {p.kind === 'case' ? 'Case studies' : 'All articles'}
            </SmartLink>
          </nav>
          <p className="eyebrow">{p.body.category}</p>
          <h1>{p.body.title}</h1>
          <p className="lead">{p.body.description}</p>
          <p className="small">
            Editorial content · Reviewed {p.body.sourceDate || 'before publication'}
          </p>
          {p.body.cover && (
            <img src={p.body.cover} alt="Source publication cover" width={1100} height={650} />
          )}
        </header>
      )}
      <BlockRenderer blocks={p.body.blocks} entries={all} />
      {path === '/privacy-policy/' && <PrivacyRequest />}
      {path === '/login/' && (
        <section className="wrap portal-grid">
          {[
            ['Students and parents', process.env.NEXT_PUBLIC_STUDENT_PORTAL_URL || '/contact-us/'],
            ['Educational institutes', process.env.NEXT_PUBLIC_INSTITUTE_PORTAL_URL || '/contact-us/'],
            ['Businesses', process.env.NEXT_PUBLIC_BUSINESS_PORTAL_URL || '/contact-us/'],
            ['Owner console', '/admin/'],
          ].map(([name, href]) => (
            <article key={name}>
              <h2>{name}</h2>
              <p>
                {href!.startsWith('https')
                  ? 'Configured secure external portal'
                  : name === 'Owner console'
                    ? 'Local staff authentication with MFA'
                    : 'Portal integration is not configured yet; continue to contact.'}
              </p>
              <SmartLink className="button primary" href={href!}>
                Continue
              </SmartLink>
            </article>
          ))}
        </section>
      )}
      {p.body.sourceUrl && (
        <aside className="source-note wrap">
          Source information:{' '}
          <SmartLink href={p.body.sourceUrl}>
            Original {p.kind === 'page' ? 'page' : 'publication'}
          </SmartLink>
          . External source material remains attributable to its publisher.
        </aside>
      )}
    </>
  );
}
