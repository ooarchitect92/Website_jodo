import raw from './seed-content.json';
import { pageSchema, PublicPage } from './contracts';
export const seedPages = raw.map((p) => ({ ...p, body: pageSchema.parse(p.body) }));
export const previewPages: PublicPage[] = seedPages.map((p, i) => ({
  id: `preview-${i}`,
  slug: p.slug,
  kind: p.kind as PublicPage['kind'],
  body: p.body,
  revision: 'reference-preview-v1',
  modifiedAt: '2026-10-07T00:00:00.000Z',
}));
export const defaultNavigation = [
  { label: 'Home', href: '/' },
  { label: 'Products', href: '/products/' },
  { label: 'Tools', href: '/tools/hidden-cost-calculator/' },
  { label: 'Blog', href: '/blog/' },
  { label: 'Case Studies', href: '/case-studies/' },
  { label: 'About Us', href: '/about-us/' },
];
export const formDefinition = {
  revision: 'demo-v1',
  title: 'Request a demo',
  notice:
    'I understand that this is a demonstration form and agree to submit these details to the operator of this installation.',
  success: 'Your enquiry was saved. The installation owner can now review it.',
};
