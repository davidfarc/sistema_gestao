import type { MetadataRoute } from "next";

/**
 * Sistema interno: nenhum robô deve varrer nada. Quem garante que o Google não
 * LISTA as páginas é o cabeçalho `X-Robots-Tag: noindex` (next.config.ts) e a
 * meta tag do layout; este arquivo pede, além disso, que nem visitem.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
