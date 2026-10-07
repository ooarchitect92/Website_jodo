import { SmartLink } from './links';
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid wrap">
        <div>
          <img
            src="/reference/images/jodo-logo-v2.svg"
            alt="Jodo reference brand"
            width="150"
            height="45"
          />
          <p>
            Education payments.
            <br />A simpler everyday experience.
          </p>
          <p className="small">
            Independent website recreation.
            <br />
            Not Jodo’s live financial service.
          </p>
          <SmartLink href="https://www.jodo.in/contact-us/">
            Contact the official Jodo team
          </SmartLink>
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
          <h2>Useful links</h2>
          {[
            ['Calculator', '/tools/hidden-cost-calculator/'],
            ['Integrations · official', 'https://docs.jodo.in'],
            ['Service status · official', 'https://status.jodo.in'],
            ['Lending partners', '/lending-partners/'],
            ['Grievance information', '/grievance-redressal/'],
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
          <SmartLink href="/privacy-policy/">Demo privacy notice</SmartLink>
          <SmartLink href="/terms-and-conditions/">Demo terms</SmartLink>
          <SmartLink href="/cookie-preferences/">Cookie preferences</SmartLink>
          <SmartLink href="/admin/">Owner console</SmartLink>
          <p className="small">
            Source content and reference assets: jodo.in. Business claims belong to their original
            publisher. Production rights and legal approval are required.
          </p>
        </div>
      </div>
      <div className="footer-bottom wrap">
        <span>Website Jodo · Blueprint v1.3</span>
        <span>Built for an owner-operated experience.</span>
      </div>
    </footer>
  );
}
