'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="wrap narrow section">
      <h1>This page is temporarily unavailable.</h1>
      <p>
        The content service could not be reached. An unavailable form never means your enquiry was
        accepted.
      </p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
      <Link className="button outline" href="/">
        Home
      </Link>
    </main>
  );
}
