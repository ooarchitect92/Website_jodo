'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SmartLink } from './links';
export function Header({
  navigation,
  name = 'YourCompany',
}: {
  navigation: { label: string; href: string }[];
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setOpen(false);
    ref.current?.querySelectorAll('details').forEach((d) => {
      d.open = false;
    });
  }, [pathname]);
  return (
    <header className="site-header" ref={ref}>
      <div className="header-inner">
        <Link className="brand brand-wordmark" href="/" aria-label={name + ' home'}>
          <span className="brand-mark" aria-hidden="true">◆</span>
          <strong>{name}</strong>
        </Link>
        <button
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="main-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Close ✕' : 'Menu ☰'}
        </button>
        <nav
          id="main-navigation"
          aria-label="Main navigation"
          className={open ? 'navigation is-open' : 'navigation'}
        >
          {navigation.map((n) =>
            n.label === 'Products' ? (
              <details className="nav-dropdown" key={n.href}>
                <summary>
                  Products <span>⌄</span>
                </summary>
                <div>
                  <SmartLink href="/products/">For educational institutes</SmartLink>
                  <SmartLink href="/products/#flex">AutoCollect · Recurring collections</SmartLink>
                  <SmartLink href="/products/#cred">Advance · Monthly payments</SmartLink>
                  <SmartLink href="/products/#pay">Checkout · Payment methods</SmartLink>
                  <SmartLink href="/contact-us/">For businesses</SmartLink>
                </div>
              </details>
            ) : (
              <SmartLink key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
                {n.label}
              </SmartLink>
            ),
          )}
          <SmartLink href="/login/" className="button outline login-link">
            Login
          </SmartLink>
          <SmartLink href="/contact-us/" className="button primary">
            Book a demo
          </SmartLink>
        </nav>
      </div>
    </header>
  );
}
