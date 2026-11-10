import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/anamnese/auth";
import NovosAlunosTabs, { type TabItem } from "@/components/anamnese/novos-alunos-tabs";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { ADMIN: "Administração", PSYCHOLOGIST: "Psicóloga", COORDINATION: "Atendimento / Coordenação" } as const;

// Seção "Novos alunos" = Central de Agendamento de Anamneses, integrada ao
// sistema. Acesso pelo papel do sistema (Configurações → Papéis) ou, para
// psicólogas, pelo cadastro na aba Psicólogas. Ver lib/anamnese/auth.ts.
export default async function NovosAlunosLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-2xl border border-black/5 bg-surface-low p-8 text-center">
        <Lock className="mx-auto mb-2 h-6 w-6 text-secondary" aria-hidden="true" />
        <p className="font-semibold text-primary">Sem acesso a Novos alunos</p>
        <p className="mt-1 text-sm text-secondary">
          Peça a um Gestor para liberar a permissão <strong>Acessar Novos alunos</strong> no seu papel
          (Configurações → Papéis). Psicólogas são liberadas pelo cadastro em Psicólogas.
        </p>
      </div>
    );
  }

  const admin = user.role === "ADMIN";
  const coord = user.role === "COORDINATION";
  const psy = user.role === "PSYCHOLOGIST";

  const items: TabItem[] = [
    { href: "/novos-alunos", label: "Início", icon: "home" },
    { href: "/novos-alunos/agenda", label: "Agenda", icon: "agenda" },
    { href: "/novos-alunos/agendamentos", label: "Agendamentos", icon: "list" },
    ...(admin || coord ? [{ href: "/novos-alunos/familias", label: "Famílias", icon: "family" } as TabItem] : []),
    ...(admin || psy ? [{ href: "/novos-alunos/disponibilidade", label: "Disponibilidade", icon: "avail" } as TabItem] : []),
    ...(admin || coord ? [{ href: "/novos-alunos/relatorios", label: "Relatórios", icon: "report" } as TabItem] : []),
    ...(admin
      ? ([
          { href: "/novos-alunos/psicologas", label: "Psicólogas", icon: "psy" },
          { href: "/novos-alunos/segmentos", label: "Segmentos", icon: "seg" },
        ] as TabItem[])
      : []),
    ...(admin || psy ? [{ href: "/novos-alunos/google", label: "Google Agenda", icon: "google" } as TabItem] : []),
    ...(admin
      ? ([
          { href: "/novos-alunos/configuracoes", label: "Configurações", icon: "cfg" },
          { href: "/novos-alunos/auditoria", label: "Auditoria", icon: "audit" },
        ] as TabItem[])
      : []),
  ];

  return (
    <div className="p-5 md:p-8">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-headline text-2xl font-bold text-primary">Novos alunos</h1>
        <p className="text-sm text-secondary">
          {user.name} · {ROLE_LABEL[user.role]}
        </p>
      </div>
      <NovosAlunosTabs items={items} />
      <div className="mx-auto mt-6 max-w-6xl space-y-6">{children}</div>
    </div>
  );
}
