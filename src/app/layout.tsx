import type { Metadata } from 'next';
import './globals.css';
import { Inter, JetBrains_Mono, Orbitron } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://epoch.edycu.dev'),
  title: 'Epoch — TEE-secured Dead-Man\'s Switch',
  description: 'Verifiable, privacy-blind inheritance and continuity orchestration inside hardware-isolated enclaves.',
  keywords: ['tee', 'dead-mans-switch', 'privacy', 'intel-tdx', 'succession-planning', 'atomic-execution'],
  authors: [{ name: 'Epoch Core Team' }],
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'Epoch',
    statusBarStyle: 'black-translucent',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  openGraph: {
    title: 'Epoch — TEE-secured Dead-Man\'s Switch',
    description: 'Verifiable, privacy-blind inheritance and continuity orchestration inside hardware-isolated enclaves.',
    url: 'https://epoch.edycu.dev',
    siteName: 'Epoch',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Epoch — TEE-secured Dead-Man\'s Switch',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Epoch — TEE-secured Dead-Man\'s Switch',
    description: 'Verifiable, privacy-blind inheritance and continuity orchestration inside hardware-isolated enclaves.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${orbitron.variable}`} suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-[#0a0b0d] text-slate-100 overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}

