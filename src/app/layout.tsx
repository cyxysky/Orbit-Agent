import type { Metadata } from 'next';
import Script from 'next/script';
import { WorkspaceBrandProvider } from '@/brand/WorkspaceBrandProvider';
import { product } from '@/brand/product';
import { InterfaceMotion } from '@/components/InterfaceMotion';
import { FilePreviewProvider } from '@/components/FilePreviewProvider';
import { NavigationLoading } from '@/components/NavigationLoading';
import { WorkspaceAccessProvider } from '@/components/WorkspaceAccessProvider';
import { readWorkspacePageContext } from '@/lib/backend-page-data';
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
  const { settingsMenuVisible } = await readWorkspacePageContext();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Script id="theme-bootstrap" strategy="beforeInteractive">{themeBootScript}</Script>
        <ThemeProvider>
          <I18nProvider>
            <WorkspaceBrandProvider>
              <WorkspaceAccessProvider settingsMenuVisible={settingsMenuVisible}>
              <FilePreviewProvider>
                <InterfaceMotion />
                {children}
                <NavigationLoading />
              </FilePreviewProvider>
              </WorkspaceAccessProvider>
            </WorkspaceBrandProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
