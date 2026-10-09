import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { ConsentProvider } from '@/components/consent';
import { Chat } from '@/components/chat';
import { site } from '@/lib/published';
export const dynamic = 'force-dynamic';
export default async function Layout({ children }: { children: React.ReactNode }) {
  const config = await site();
  const shell = (
      <div
        style={
          {
            '--blue': config.settings.brand.primary,
            '--brand': config.settings.brand.primary,
          } as React.CSSProperties
        }
      >
        <Header navigation={config.settings.navigation} name={config.settings.brand.name} />
        <div className="demo-strip">
          Reference feature build · Live financial providers stay disabled until configured and
          approved <a href="/terms-and-conditions/">Platform boundaries</a>
        </div>
        <main id="main">{children}</main>
        <Footer name={config.settings.brand.name} />
        {!config.tenantSite && <Chat />}
      </div>
  );
  return config.tenantSite ? shell : <ConsentProvider>{shell}</ConsentProvider>;
}
