import { SmartLink } from './links';

export function Footer({ name = 'YourCompany' }: { name?: string }) {
  return (
    <footer className="site-footer">
      <div className="footer-grid wrap">
        <div>
          <div className="brand brand-wordmark footer-brand" aria-label={name}>
            <span className="brand-mark" aria-hidden="true">
              ◆
            </span>
            <strong>{name}</strong>
          </div>
          <p>
            Education fee operations.
            <br />
            Clearer collections for institutes and families.
          </p>
          <p className="small">
            Independent product implementation with original branding and content controls.
          </p>
          <SmartLink href="/contact-us/">Talk to our team</SmartLink>
        </div>
        <div>
          <h2>Explore</h2>
          {[
            ['Home', '/'],
            ['Products', '/products/'],
            ['Blog', '/blog/'],
            ['Case studies', '/case-studies/'],
            ['About us', '/about-us/'],
            ['Contact', '/contact-us/'],
            ['Careers', '/careers/'],
          ].map(([a, b]) => (
            <SmartLink key={a} href={b!}>
              {a}
            </SmartLink>
          ))}
        </div>
        <div>
          <h2>Platform</h2>
          {[
            ['Cost calculator', '/tools/hidden-cost-calculator/'],
            ['Support', '/support/'],
            ['Partner with us', '/partner/'],
            ['Accessibility', '/accessibility/'],
            ['Search', '/search/'],
          ].map(([a, b]) => (
            <SmartLink key={a} href={b!}>
              {a}
            </SmartLink>
          ))}
        </div>
        <div>
          <h2>Your choices</h2>
          <SmartLink href="/privacy-policy/">Privacy notice</SmartLink>
          <SmartLink href="/terms-and-conditions/">Terms</SmartLink>
          <SmartLink href="/cookie-preferences/">Cookie preferences</SmartLink>
          <SmartLink href="/admin/">Owner console</SmartLink>
          <p className="small">
            Production claims, logos, customer stories and provider integrations must be owned,
            licensed and verified before activation.
          </p>
        </div>
      </div>
      <div className="footer-bottom wrap">
        <span>{name} · Website platform</span>
        <span>Owner-operated · consent-aware · production-gated</span>
      </div>
    </footer>
  );
}
