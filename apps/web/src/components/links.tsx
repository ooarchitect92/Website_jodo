import Link from 'next/link';
import { ReactNode } from 'react';
export function SmartLink({
  href,
  children,
  className,
  ...rest
}: {
  href: string;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
  'data-action-id'?: string;
}) {
  return href.startsWith('https://') ? (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
      <span className="external-mark" aria-label=" (opens external website)">
        ↗
      </span>
    </a>
  ) : (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}
