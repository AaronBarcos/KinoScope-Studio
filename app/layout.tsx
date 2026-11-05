import type {Metadata} from 'next';
import {Outfit, Plus_Jakarta_Sans, JetBrains_Mono} from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  weight: ['500', '600', '700'],
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'KinoScope Studio — Análisis Cinematográfico con Gemini 4 Argon',
  description:
    'Plataforma de análisis cinematográfico profundo mediante la File API de Gemini (hasta 2GB) y el modelo gemini-4-argon para consultas sobre películas completas o escenas acotadas por código de tiempo.',
  openGraph: {
    title: 'KinoScope Studio — Análisis Cinematográfico con Gemini 4 Argon',
    description:
      'Plataforma de análisis cinematográfico profundo mediante la File API de Gemini (hasta 2GB) y el modelo gemini-4-argon para consultas sobre películas completas o escenas acotadas por código de tiempo.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'KinoScope Studio — Análisis Cinematográfico con Gemini 4 Argon',
    description:
      'Plataforma de análisis cinematográfico profundo mediante la File API de Gemini (hasta 2GB) y el modelo gemini-4-argon para consultas sobre películas completas o escenas acotadas por código de tiempo.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html
      lang="es"
      className={`${outfit.variable} ${jakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <body
        suppressHydrationWarning
        className="bg-slate-950 text-slate-100 font-sans antialiased selection:bg-amber-500/30 selection:text-amber-200"
      >
        {children}
      </body>
    </html>
  );
}
