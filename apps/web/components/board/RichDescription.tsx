"use client";

import dynamic from "next/dynamic";

/**
 * Carrega o editor só quando o card é aberto (`ssr: false` + import dinâmico).
 * Assim o Tiptap não entra no bundle do quadro nem da lista.
 */
export const RichDescription = dynamic(
  () => import("./RichDescriptionEditor").then((m) => m.RichDescriptionEditor),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-24 animate-pulse rounded-lg border border-neutral-200 bg-neutral-50" />
    ),
  },
);
