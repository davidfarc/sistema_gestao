import { AlertTriangle, CheckCircle2, Clock, Hourglass, Layers, User } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { StageCategory } from "@/lib/board/types";
import { PainelTabs } from "@/components/painel/PainelTabs";
import { provisionAndGetActor } from "@/lib/actor";
import { loadPipelineOverview, STALLED_DAYS, type PipelineOverview } from "@/lib/reports/overview";

export const dynamic = "force-dynamic";

const DOT: Record<StageCategory, string> = {
  backlog: "bg-neutral-400",
  in_progress: "bg-sky-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
};

/**
 * Painel: a situação de cada pipeline numa tela só, pensado para o gestor
 * olhar no celular sem abrir quadro por quadro. Cada pessoa vê só os pipelines
 * que enxerga (o banco aplica o mesmo escopo do quadro).
 */
export default async function PainelPage() {
  const [pipelines, actor] = await Promise.all([loadPipelineOverview(), provisionAndGetActor()]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-2xl">Painéis</h1>
      <PainelTabs current="geral" showTime={actor?.permissions.has("time:read") ?? false} />
      <p className="mt-3 text-sm text-secondary">
        Situação dos pipelines agora. “Parado” = há mais de {STALLED_DAYS} dias na mesma etapa.
      </p>

      {pipelines === null ? (
        <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Não foi possível carregar o painel. Se ele acabou de ser publicado, falta aplicar a
          atualização do banco (migration 0036). Avise a gestão do sistema.
        </p>
      ) : pipelines.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-600">
          Você ainda não participa de nenhum pipeline.
        </p>
      ) : (
        <>
          <Totals pipelines={pipelines} />
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {pipelines.map((p) => (
              <PipelineCard key={p.id} pipeline={p} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function Totals({ pipelines }: { pipelines: PipelineOverview[] }) {
  const sum = (pick: (p: PipelineOverview) => number) => pipelines.reduce((n, p) => n + pick(p), 0);
  return (
    <section aria-label="Totais" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat icon={<Layers className="h-4 w-4" />} label="Em aberto" value={sum((p) => p.open)} />
      <Stat
        icon={<AlertTriangle className="h-4 w-4" />}
        label="Atrasados"
        value={sum((p) => p.overdue)}
        tone="danger"
      />
      <Stat
        icon={<Hourglass className="h-4 w-4" />}
        label="Parados"
        value={sum((p) => p.stalled)}
        tone="warning"
      />
      <Stat
        icon={<CheckCircle2 className="h-4 w-4" />}
        label="Concluídos em 7 dias"
        value={sum((p) => p.completedWeek)}
        tone="success"
      />
      <Stat icon={<User className="h-4 w-4" />} label="Meus cards" value={sum((p) => p.mine)} />
    </section>
  );
}

const TONE = {
  neutral: "text-neutral-800",
  danger: "text-red-700",
  warning: "text-amber-800",
  success: "text-emerald-700",
} as const;

function Stat({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: keyof typeof TONE;
}) {
  // Zero não é alerta: a cor só aparece quando há o que olhar.
  const color = value > 0 ? TONE[tone] : "text-neutral-800";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="flex items-center gap-1.5 text-xs text-neutral-600">
        <span aria-hidden="true">{icon}</span>
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function PipelineCard({ pipeline: p }: { pipeline: PipelineOverview }) {
  const max = Math.max(1, ...p.stages.map((s) => s.cards));
  return (
    <section
      aria-label={p.name}
      className="rounded-xl border border-neutral-200 bg-white p-4 shadow-premium-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-base font-semibold text-neutral-800">{p.name}</h2>
        <Link
          href={`/board?board=${p.id}`}
          className="-my-2 inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-primary hover:underline"
        >
          Abrir quadro
        </Link>
      </div>

      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Fact label="em aberto" value={p.open} />
        <Fact label="atrasados" value={p.overdue} className="text-red-700" icon={<Clock className="h-3.5 w-3.5" />} />
        <Fact label="parados" value={p.stalled} className="text-amber-800" />
        <Fact label="concluídos em 7 dias" value={p.completedWeek} className="text-emerald-700" />
        <Fact label="criados em 7 dias" value={p.createdWeek} />
        <Fact label="meus" value={p.mine} />
      </dl>

      {p.stages.length > 0 && (
        <ul className="mt-4 grid gap-2" aria-label="Cards por etapa">
          {p.stages.map((s) => {
            const over = s.wipLimit != null && s.cards > s.wipLimit;
            return (
              <li key={s.id} className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 text-neutral-700">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.category]}`} aria-hidden="true" />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="h-2 rounded-full bg-neutral-100" aria-hidden="true">
                  <span
                    className={`block h-2 rounded-full ${over ? "bg-red-500" : "bg-primary/70"}`}
                    style={{ width: `${(s.cards / max) * 100}%` }}
                  />
                </span>
                <span
                  className={`text-right tabular-nums ${over ? "font-semibold text-red-700" : "text-neutral-700"}`}
                  title={over ? "Acima do limite da etapa" : undefined}
                >
                  {s.wipLimit != null ? `${s.cards}/${s.wipLimit}` : s.cards}
                  {over && <span className="sr-only"> (acima do limite)</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Fact({
  label,
  value,
  className = "",
  icon,
}: {
  label: string;
  value: number;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={`flex items-baseline gap-1 ${value > 0 ? className : ""} ${value > 0 ? "" : "text-neutral-500"}`}>
      {icon && value > 0 && (
        <span className="self-center" aria-hidden="true">
          {icon}
        </span>
      )}
      <dd className="font-semibold tabular-nums">{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}
