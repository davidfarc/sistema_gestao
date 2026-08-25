"use client";

import { slaStatus } from "@ecco/core";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deprioritizeCard, movePriority, prioritizeCard } from "@/lib/demandas/queue";
import type { QueueData, QueueItem } from "@/lib/demandas/queueTypes";

const TIPO_COLOR: Record<string, string> = {
  Run: "bg-emerald-600",
  Keep: "bg-amber-500",
  Grow: "bg-blue-600",
  Transform: "bg-violet-600",
};

const URGENCIA_COLOR: Record<string, string> = {
  "muito alta": "text-rose-600",
  alta: "text-rose-600",
  normal: "text-blue-600",
  baixa: "text-neutral-500",
  "muito baixa": "text-neutral-400",
};

const RISCO_COLOR: Record<string, string> = {
  "muito alto": "text-rose-600",
  alto: "text-rose-600",
  moderado: "text-amber-600",
  baixo: "text-emerald-600",
  "muito baixo": "text-emerald-600",
};

function colorFor(map: Record<string, string>, label: string | null): string {
  if (!label) return "text-neutral-400";
  const k = label.toLowerCase();
  const hit = Object.keys(map).find((key) => k.startsWith(key));
  return hit ? map[hit]! : "text-neutral-600";
}

function brl(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function PriorityQueue({
  data,
  canPrioritize,
}: {
  data: QueueData;
  canPrioritize: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(
    cardId: string,
    fn: () => Promise<{ ok: true; warning?: string } | { ok: false; error: string }>,
  ) {
    setBusy(cardId);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) setError(res.error);
    else {
      setNotice(res.warning ?? null);
      router.refresh();
    }
  }

  const prioritized = data.items.filter((i) => i.prioritized);
  // Só chega aqui quem está no checkpoint ou já foi priorizado (ver
  // loadPriorityQueue) — não existe mais a seção "demais demandas".
  const awaiting = data.items.filter((i) => !i.prioritized && i.awaitingPrioritization);

  return (
    <div className="grid gap-8">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {notice && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>
      )}

      <Section
        title="Aguardando priorização"
        count={awaiting.length}
        hint="Estas demandas estão travadas: só seguem no pipeline depois de priorizadas."
      >
        {awaiting.map((item) => (
          <Card
            key={item.cardId}
            item={item}
            busy={busy === item.cardId}
            canPrioritize={canPrioritize}
            onPrioritize={() => run(item.cardId, () => prioritizeCard(item.cardId))}
          />
        ))}
      </Section>

      {prioritized.length > 0 && (
        <Section title="Priorizadas" count={prioritized.length} hint="Ordem definida pelo comitê.">
          {prioritized.map((item, i) => (
            <Card
              key={item.cardId}
              item={item}
              rank={i + 1}
              busy={busy === item.cardId}
              canPrioritize={canPrioritize}
              onUp={i > 0 ? () => run(item.cardId, () => movePriority(item.cardId, "up")) : undefined}
              onDown={
                i < prioritized.length - 1
                  ? () => run(item.cardId, () => movePriority(item.cardId, "down"))
                  : undefined
              }
              onDeprioritize={() => run(item.cardId, () => deprioritizeCard(item.cardId))}
            />
          ))}
        </Section>
      )}

    </div>
  );
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">{title}</h2>
        <span className="text-xs text-neutral-400">{count}</span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-400">{hint}</p>
      {count === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">Nada por aqui.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      )}
    </section>
  );
}

/** Prazo por urgência: dias restantes/atrasados + barra de consumo. */
function SlaBar({ urgencia, createdAt }: { urgencia: string | null; createdAt: string }) {
  const sla = slaStatus(urgencia, createdAt);
  const cor = sla.late
    ? "bg-rose-500"
    : sla.progress > 0.7
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between text-[10px]">
        <span className="uppercase text-neutral-400">Prazo ({sla.limitDays}d úteis)</span>
        <span className={clsx("font-semibold", sla.late ? "text-rose-600" : "text-neutral-600")}>
          {sla.late
            ? `${Math.abs(sla.remainingDays)} ${Math.abs(sla.remainingDays) === 1 ? "dia" : "dias"} atrasado`
            : `${sla.remainingDays} ${sla.remainingDays === 1 ? "dia restante" : "dias restantes"}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className={clsx("h-full rounded-full transition-all", cor)}
          style={{ width: `${Math.round(sla.progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

function Card({
  item,
  rank,
  busy,
  canPrioritize,
  onPrioritize,
  onDeprioritize,
  onUp,
  onDown,
}: {
  item: QueueItem;
  rank?: number;
  busy: boolean;
  canPrioritize: boolean;
  onPrioritize?: () => void;
  onDeprioritize?: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-surface-medium bg-surface-lowest p-4 shadow-premium-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.tipo && (
            <span
              className={clsx(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white",
                TIPO_COLOR[item.tipo] ?? "bg-neutral-500",
              )}
            >
              {item.tipo}
            </span>
          )}
          {item.area && (
            <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
              {item.area}
            </span>
          )}
        </div>
        <div className="text-right leading-none">
          <div className="text-xl font-bold text-neutral-800">
            {item.rice != null ? item.rice.toFixed(1) : "—"}
          </div>
          <div className="text-[9px] uppercase tracking-wide text-neutral-400">RICE</div>
        </div>
      </div>

      <Link
        href={`/card/${item.cardId}`}
        className="mt-2 line-clamp-2 text-sm font-semibold text-neutral-800 hover:text-primary"
      >
        {rank != null && <span className="mr-1 text-neutral-400">#{rank}</span>}
        {item.title}
      </Link>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div>
          <dt className="uppercase text-neutral-400">Etapa</dt>
          <dd className="font-medium text-neutral-700">{item.stageName}</dd>
        </div>
        <div>
          <dt className="uppercase text-neutral-400">Investimento</dt>
          <dd className="font-medium text-neutral-700">{brl(item.orcamento)}</dd>
        </div>
        <div>
          <dt className="uppercase text-neutral-400">Urgência</dt>
          <dd className={clsx("font-medium", colorFor(URGENCIA_COLOR, item.urgencia))}>
            {item.urgencia ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-neutral-400">Risco</dt>
          <dd className={clsx("font-medium", colorFor(RISCO_COLOR, item.risco))}>
            {item.risco ?? "—"}
          </dd>
        </div>
      </dl>

      <SlaBar urgencia={item.urgencia} createdAt={item.createdAt} />

      <div className="mt-3 flex items-center gap-2 border-t border-neutral-100 pt-3 text-[11px] text-neutral-500">
        <span className="truncate">{item.responsavel ?? "Não atribuído"}</span>
      </div>

      {item.prioritized ? (
        <div className="mt-2 flex items-center gap-1">
          <span className="mr-auto inline-flex items-center gap-1 text-[11px] text-emerald-700">
            <Check className="h-3.5 w-3.5" /> por {item.prioritized.by}
          </span>
          {canPrioritize && (
            <>
              <button
                type="button"
                onClick={onUp}
                disabled={busy || !onUp}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                aria-label="Subir na fila"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDown}
                disabled={busy || !onDown}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                aria-label="Descer na fila"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDeprioritize}
                disabled={busy}
                className="rounded px-1.5 py-1 text-[11px] text-neutral-400 hover:text-red-600 disabled:opacity-50"
              >
                Remover
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-2">
          {item.riceComplete ? (
            canPrioritize && (
              <button
                type="button"
                onClick={onPrioritize}
                disabled={busy}
                className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-high disabled:opacity-60"
              >
                {busy ? "Priorizando…" : "Priorizar"}
              </button>
            )
          ) : (
            <Link
              href={`/card/${item.cardId}`}
              className="flex items-center justify-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              RICE incompleto — preencher <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
