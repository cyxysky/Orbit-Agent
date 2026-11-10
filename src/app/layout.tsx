import type { Metadata } from 'next';
import Script from 'next/script';
import { WorkspaceBrandProvider } from '@/brand/WorkspaceBrandProvider';
import { product } from '@/brand/product';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ThemeProvider } from '@/theme/ThemeProvider';
import './styles/foundation.css';
import './styles/file-preview.css';
import './styles/settlement-surfaces.css';
import './styles/domains/settlement-settings.css';
import './styles/domains/settlement-resources.css';

export const metadata: Metadata = {
  title: product.name,
  description: product.description,
};

const themeBootScript = `
try {
  var mode = window.localStorage.getItem('webpilotqa.themeMode') === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.setProperty('color-scheme', mode);
} catch {}
`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Script id="theme-bootstrap" strategy="beforeInteractive">{themeBootScript}</Script>
        <ThemeProvider>
          <I18nProvider>
            <WorkspaceBrandProvider>
              {children}
            </WorkspaceBrandProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
