import type { MetadataRoute } from "next";

/**
 * Manifesto do aplicativo (PWA): é o que permite "Instalar" / "Adicionar à
 * Tela de Início" no celular e abrir o sistema sem a barra do navegador.
 * Servido em /manifest.webmanifest (liberado sem login no middleware).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sistema de Gestão Eccoprime",
    short_name: "Eccoprime",
    description: "Quadros, conversas e avisos da equipe Eccoprime.",
    lang: "pt-BR",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#092c23",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Quadros", url: "/board" },
      { name: "Conversas", url: "/canais" },
      { name: "Avisos", url: "/avisos" },
    ],
  };
}
