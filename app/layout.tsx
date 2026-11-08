import type { Metadata } from 'next';
import { Figtree, Fraunces } from 'next/font/google';
import './globals.css';

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
  weight: ['400', '500', '600', '700'],
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  weight: ['500', '600', '700'],
});

const TITLE = 'KinoScope — Entiende cualquier vídeo';
const DESCRIPTION =
  'Sube un vídeo y hazle preguntas: la IA te explica escenas, planos, luz y sonido de forma sencilla.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${figtree.variable} ${fraunces.variable} dark`}>
      <body
        suppressHydrationWarning
        className="bg-[#0e0f13] text-zinc-100 font-sans antialiased selection:bg-amber-400/30 selection:text-amber-100"
      >
        {children}
      </body>
    </html>
  );
}
