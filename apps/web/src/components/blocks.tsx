import { Block, PublicPage } from '@core/contracts';
import { SmartLink } from './links';
import { LeadForm } from './form';
import { Calculator } from './calculator';
function Image({
  src,
  alt = '',
  hero = false,
  className = '',
}: {
  src: string;
  alt?: string;
  hero?: boolean;
  className?: string;
}) {
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={hero ? 'eager' : 'lazy'}
      fetchPriority={hero ? 'high' : 'auto'}
      width={900}
      height={650}
    />
  );
}
export function ArticleCards({ items }: { items: PublicPage[] }) {
  return (
    <div className="article-grid">
      {items.map((p) => (
        <article className="article-card" key={p.id}>
          {p.body.cover && (
            <SmartLink href={p.slug} aria-label={'Read ' + p.body.title}>
              <Image src={p.body.cover} alt="" />
            </SmartLink>
          )}
          <div className="article-copy">
            <span className="eyebrow">{p.body.category || 'Reference story'}</span>
            <h3>
              <SmartLink href={p.slug}>{p.body.title}</SmartLink>
            </h3>
            <p>{p.body.description}</p>
            <SmartLink href={p.slug} className="read-link">
              Read overview <span>→</span>
            </SmartLink>
          </div>
        </article>
      ))}
    </div>
  );
}
export function BlockRenderer({
  blocks,
  entries = [],
}: {
  blocks: Block[];
  entries?: PublicPage[];
}) {
  return (
    <>
      {blocks.map((b, index) => {
        const head = (
          <div className="section-heading">
            {b.eyebrow && <p className="eyebrow">{b.eyebrow}</p>}
            <h2>{b.title}</h2>
            {b.text && <p>{b.text}</p>}
          </div>
        );
        const link = b.href && (
          <SmartLink className="button primary" href={b.href} data-action-id={b.id}>
            {b.label || 'Learn more'}
          </SmartLink>
        );
        if (b.type === 'hero')
          return (
            <section key={b.id} className={'hero tone-' + b.tone + (b.image ? '' : ' text-hero')}>
              <div className="hero-copy">
                {b.eyebrow && <p className="eyebrow">{b.eyebrow}</p>}
                <h1>
                  {b.accent && <span className="accent underline-accent">{b.accent}</span>}
                  {b.title}
                </h1>
                <p className="hero-description">{b.text}</p>
                {link}
                {!!b.items.length && (
                  <>
                    <div className="hero-stats">
                      {b.items.map((i) => (
                        <div key={i.title}>
                          <strong>{i.title}</strong>
                          <span>{i.text}</span>
                        </div>
                      ))}
                    </div>
                    <p className="source-caption">
                      Illustrative figures must be replaced with verified company metrics before
                      production.
                    </p>
                  </>
                )}
              </div>
              {b.image && (
                <Image
                  src={b.image}
                  alt={b.imageAlt || b.title}
                  hero={index === 0}
                  className="hero-image"
                />
              )}
            </section>
          );
        if (b.type === 'logos')
          return (
            <section key={b.id} className="logo-section wrap">
              <div>
                <h2>{b.title}</h2>
                <p className="small">{b.text}</p>
              </div>
              <div className="logo-track" tabIndex={0} aria-label={b.title || 'Partner logos'}>
                {b.items.map((i) => (
                  <div key={i.title}>
                    {i.image ? (
                      <img src={i.image} alt={i.title} width={140} height={70} loading="lazy" />
                    ) : (
                      <span>{i.title}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        if (b.type === 'stats')
          return (
            <section key={b.id} className="section wrap stats-section">
              {head}
              <div className="stat-grid">
                {b.items.map((i) => (
                  <div key={i.title}>
                    <strong>{i.title}</strong>
                    <p>{i.text}</p>
                  </div>
                ))}
              </div>
            </section>
          );
        if (b.type === 'products')
          return (
            <section key={b.id} className="section wrap">
              {head}
              <div className="product-cards">
                {b.items.map((i, n) => (
                  <article className={'product-card product-' + n} key={i.title}>
                    <span className="eyebrow">Platform · {i.title}</span>
                    <h3>
                      {[
                        'Automate recurring fees.',
                        'Bring payments forward.',
                        'Give families more choice.',
                      ][n] || i.title}
                    </h3>
                    <p>{i.text}</p>
                    {i.image && <Image src={i.image} alt={i.title + ' product illustration'} />}
                    <SmartLink className="button outline" href={i.href || '/products/'}>
                      {i.label || 'Explore product'} →
                    </SmartLink>
                  </article>
                ))}
              </div>
            </section>
          );
        if (b.type === 'features')
          return (
            <section key={b.id} className={'section feature-section tone-' + b.tone}>
              <div className="wrap">
                {head}
                <div className="feature-grid">
                  <div className="feature-items">
                    {b.items.map((i, n) => (
                      <article key={i.title}>
                        {i.image ? (
                          <img src={i.image} alt="" width={42} height={42} />
                        ) : (
                          <span className="feature-number">0{n + 1}</span>
                        )}
                        <div>
                          <h3>{i.title}</h3>
                          <p>{i.text}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                  {b.image && <Image src={b.image} alt={b.imageAlt || b.title} />}
                </div>
              </div>
            </section>
          );
        if (b.type === 'product')
          return (
            <section
              id={b.eyebrow || b.id}
              key={b.id}
              className={'section product-detail tone-' + b.tone}
            >
              <div className={'wrap split ' + (b.reverse ? 'reverse' : '')}>
                <div>
                  <p className="eyebrow">Platform product</p>
                  <h2>
                    {b.title}
                    <span className="yellow-dot">.</span>
                  </h2>
                  <p className="lead">{b.text}</p>
                  <div className="feature-items">
                    {b.items.map((i, n) => (
                      <article key={i.title}>
                        <span className="feature-number">0{n + 1}</span>
                        <div>
                          <h3>{i.title}</h3>
                          <p>{i.text}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                  <SmartLink href="/contact-us/" className="button primary">
                    Explore with a demo
                  </SmartLink>
                </div>
                {b.image && <Image src={b.image} alt={b.imageAlt || b.title} />}
              </div>
            </section>
          );
        if (b.type === 'security')
          return (
            <section key={b.id} className="section wrap security-section">
              {head}
              <div className="security-grid">
                {b.image && <Image src={b.image} alt={b.imageAlt || b.title} />}
                <div>
                  {b.items.map((i) => (
                    <article key={i.title}>
                      <span className="check-icon">✓</span>
                      <h3>{i.title}</h3>
                      <p>{i.text}</p>
                      {i.href && <SmartLink href={i.href}>{i.label || 'Learn more'}</SmartLink>}
                    </article>
                  ))}
                </div>
              </div>
            </section>
          );
        if (b.type === 'stories' || b.type === 'articles')
          return (
            <section key={b.id} className={'section tone-' + b.tone}>
              <div className="wrap">
                {head}
                <ArticleCards
                  items={entries
                    .filter((p) => p.kind === (b.type === 'stories' ? 'case' : 'post'))
                    .slice(0, 3)}
                />
                <div className="center">
                  <SmartLink
                    href={b.type === 'stories' ? '/case-studies/' : '/blog/'}
                    className="button outline"
                  >
                    View all {b.type === 'stories' ? 'case studies' : 'articles'}
                  </SmartLink>
                </div>
              </div>
            </section>
          );
        if (b.type === 'steps' || b.type === 'team')
          return (
            <section key={b.id} className="section wrap">
              {head}
              <div className={'steps-grid ' + (b.type === 'team' ? 'team-grid' : '')}>
                {b.items.map((i, n) => (
                  <article key={i.title}>
                    <span className="step-count">
                      {b.type === 'team'
                        ? i.title
                            .split(' ')
                            .map((s) => s[0])
                            .join('')
                        : String(n + 1).padStart(2, '0')}
                    </span>
                    <h3>{i.title}</h3>
                    <p>{i.text}</p>
                  </article>
                ))}
              </div>
            </section>
          );
        if (b.type === 'cta')
          return (
            <section key={b.id} className="cta wrap tone-gradient">
              <div>
                <h2>{b.title}</h2>
                <p>{b.text}</p>
                {link}
              </div>
              {b.image && <Image src={b.image} alt={b.imageAlt || ''} />}
            </section>
          );
        if (b.type === 'faq')
          return (
            <section key={b.id} className="section wrap narrow">
              {head}
              <div className="faq-list">
                {b.items.map((i) => (
                  <details key={i.title}>
                    <summary>
                      {i.title}
                      <span>+</span>
                    </summary>
                    <p>{i.text}</p>
                  </details>
                ))}
              </div>
            </section>
          );
        if (b.type === 'form')
          return (
            <section key={b.id} className="section wrap contact-grid">
              <div>
                <p className="eyebrow">{b.eyebrow}</p>
                <h1>{b.title}</h1>
                <p className="lead">{b.text}</p>
                <div className="contact-proof">
                  <div className="brand brand-wordmark">
                    <span className="brand-mark" aria-hidden="true">
                      ◆
                    </span>
                    <strong>Education payments platform</strong>
                  </div>
                  <h2>Built around your institute.</h2>
                  <p>Schools, colleges, universities, coaching centres and skilling providers.</p>
                  <SmartLink href="/products/">Explore platform capabilities</SmartLink>
                </div>
              </div>
              <LeadForm />
            </section>
          );
        if (b.type === 'calculator')
          return (
            <section key={b.id} className="section wrap calculator-section">
              <div className="section-heading">
                <p className="eyebrow">{b.eyebrow}</p>
                <h1>{b.title}</h1>
                <p>{b.text}</p>
              </div>
              <Calculator />
            </section>
          );
        return (
          <section key={b.id} className="section wrap narrow rich-text">
            <h2>{b.title}</h2>
            {b.text
              .split('\n\n')
              .filter(Boolean)
              .map((p, n) => (
                <p key={n}>{p}</p>
              ))}
            {link}
          </section>
        );
      })}
    </>
  );
}
