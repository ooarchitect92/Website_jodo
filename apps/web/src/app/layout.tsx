import type { Metadata } from 'next';
import '../styles/globals.css';
export const metadata: Metadata = {
  title: { default: 'YourCompany', template: '%s' },
  description: 'Education payments website, owner console and payer portal',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
