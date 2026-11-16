import type { Metadata, Viewport } from "next";
import { Figtree, IBM_Plex_Mono, Literata } from "next/font/google";
import type { ReactNode } from "react";

import { DialogA11y } from "@/components/shell/DialogA11y";

import "./globals.css";

// Visual da Produção Pedagógica (aprovado em 12/11): Literata nos títulos,
// Figtree no texto, IBM Plex Mono em números e cronômetros.
const literata = Literata({
  variable: "--font-headline",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

const figtree = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sistema de Gestão Eccoprime",
  description: "Sistema de gestão da Eccoprime: quadros, conversas, painéis e os módulos da escola e da editora.",
  // Sistema interno: fora de qualquer buscador (ver também next.config.ts e app/robots.ts).
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true, nosnippet: true },
  },
  // Instalável no celular (o manifesto vem de app/manifest.ts).
  appleWebApp: { capable: true, title: "Eccoprime", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#001e40",
  // Deixa o app instalado ocupar a tela toda; as bordas seguras (entalhe, barra
  // de gestos) são respeitadas com env(safe-area-inset-*) no CSS.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${literata.variable} ${figtree.variable} ${plexMono.variable}`}>
      <body>
        {children}
        <DialogA11y />
      </body>
    </html>
  );
}
