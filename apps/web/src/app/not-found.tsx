import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main" className="wrap narrow section empty-state">
      <p className="eyebrow">404 · Page not found</p>
      <h1>Let’s get you back on track.</h1>
      <p>This page is unavailable or has not been published.</p>
      <Link className="button primary" href="/">
        Back to home
      </Link>
    </main>
  );
}
