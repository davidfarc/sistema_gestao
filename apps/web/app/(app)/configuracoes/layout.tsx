import type { ReactNode } from "react";

import { ConfigTabs } from "@/components/configuracoes/ConfigTabs";

/** Shell das telas de configuração: título + abas. Cada página faz seu gate. */
export default function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-secondary">Configurações</p>
      <ConfigTabs />
      {children}
    </main>
  );
}
