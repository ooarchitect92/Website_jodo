import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { ConsentProvider } from '@/components/consent';
import { Chat } from '@/components/chat';
import { site } from '@/lib/published';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const config = await site();
  return (
    <ConsentProvider>
      <div style={{ '--blue': config.settings.brand.primary } as React.CSSProperties}>
        <Header navigation={config.settings.navigation} name={config.settings.brand.name} />
        <div className="demo-strip">
          Independent recreation · No live payments or Jodo account access{' '}
          <a href="/terms-and-conditions/">About this demo</a>
        </div>
        <main id="main">{children}</main>
        <Footer />
        <Chat />
      </div>
    </ConsentProvider>
  );
}
