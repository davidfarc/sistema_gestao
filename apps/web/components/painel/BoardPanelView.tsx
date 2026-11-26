import Link from "next/link";
import type { ReactNode } from "react";

import { PainelTabs } from "@/components/painel/PainelTabs";
import type { BoardPanel, PanelStage, StackRow, ValueRow } from "@/lib/reports/boardPanel";
import { fmtHours } from "@/lib/time/format";

const IN_PROGRESS = ["#12703f", "#0891b2", "#7c3aed"];

/** Cor de cada etapa nos gráficos: pela categoria (emenda em âmbar). */
function stageColors(stages: PanelStage[]): Map<string, string> {
  let n = 0;
  return new Map(
    stages.map((s) => {
      const color = s.countsRework
        ? "#b45309"
        : s.category === "done"
          ? "#047857"
          : s.category === "review"
            ? "#64748b"
            : s.category === "backlog"
              ? "#a3a3a3"
              : IN_PROGRESS[n++ % IN_PROGRESS.length]!;
      return [s.id, color];
    }),
  );
}

/** Tela do painel próprio de um pipeline (os dados vêm prontos da página). */
export function BoardPanelView({
  panel,
  panels,
  canSeeTime,
}: {
  panel: BoardPanel;
  panels: { id: string; name: string }[];
  canSeeTime: boolean;
}) {
  const colors = stageColors(panel.stages);
  const overdueCount = panel.overdue.length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-2xl">Relatórios</h1>
      <PainelTabs current={panel.id} showTime={canSeeTime} panels={panels} />

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-secondary">Situação de {panel.name} agora.</p>
        <Link href={`/board?board=${panel.id}`} className="text-sm font-medium text-primary hover:underline">
          Abrir quadro
        </Link>
      </div>

      <section aria-label="Cards por etapa" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {panel.stages.map((s) => (
          <Kpi key={s.id} label={s.name} value={s.cards} color={colors.get(s.id)} />
        ))}
        <Kpi label="Atrasados" value={overdueCount} color={overdueCount ? "#ba1a1a" : undefined} />
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Box title="Cards por responsável">
          <Stacked rows={panel.byAssignee} stages={panel.stages} colors={colors} />
        </Box>
        {panel.breakdowns.map((b) => (
          <Box key={b.fieldId} title={`Cards por ${b.fieldName.toLowerCase()}`}>
            <Stacked rows={b.rows} stages={panel.stages} colors={colors} />
          </Box>
        ))}
        {panel.breakdowns.map(
          (b) =>
            b.rework && (
              <Box
                key={`rw-${b.fieldId}`}
                title={`Emendas por ${b.fieldName.toLowerCase()}`}
                note="Soma das devoluções. Muitas emendas num tipo pedem revisão do briefing."
              >
                <Values rows={b.rework} color="#b45309" format={(v) => String(v)} />
              </Box>
            ),
        )}
        {panel.breakdowns.map(
          (b) =>
            b.avgHours && (
              <Box
                key={`h-${b.fieldId}`}
                title={`Horas médias por ${b.fieldName.toLowerCase()}`}
                note="Média do tempo cronometrado nos cards concluídos. Base para planejar prazos."
              >
                <Values rows={b.avgHours} color="#12703f" format={(v) => `${v.toFixed(1).replace(".", ",")}h`} />
              </Box>
            ),
        )}
        {panel.hoursToday && (
          <Box title="Horas registradas hoje" note="Tempo com cronômetro ligado neste pipeline. Não é registro de jornada.">
            {panel.hoursToday.length ? (
              <Values rows={panel.hoursToday} color="#12703f" format={(v) => fmtHours(v * 3600)} />
            ) : (
              <p className="text-sm text-neutral-500">Ninguém registrou tempo hoje.</p>
            )}
          </Box>
        )}
        <Box title="Da criação à conclusão">
          {panel.avgDaysToDone === null ? (
            <p className="text-sm text-neutral-500">Nenhum card concluído ainda.</p>
          ) : (
            <>
              <p className="font-headline text-3xl text-neutral-900">
                {Math.round(panel.avgDaysToDone)} {Math.round(panel.avgDaysToDone) === 1 ? "dia" : "dias"}
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                Média dos {panel.doneCount} {panel.doneCount === 1 ? "card concluído" : "cards concluídos"}.
              </p>
              {panel.doneWithoutRework !== null && (
                <>
                  <p className="mt-4 font-headline text-3xl text-neutral-900">{panel.doneWithoutRework}%</p>
                  <p className="mt-1 text-sm text-neutral-600">Concluídos sem nenhuma emenda.</p>
                </>
              )}
            </>
          )}
        </Box>
      </div>

      <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-600">
            Atrasados agora
          </h2>
          <Link href={`/board?board=${panel.id}`} className="text-sm font-medium text-primary hover:underline">
            Ver no quadro
          </Link>
        </div>
        {panel.overdue.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">Nenhum card atrasado.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {panel.overdue.map((c) => (
              <li key={c.id} className="grid gap-x-4 text-sm sm:grid-cols-[10rem_1fr]">
                <span className="text-neutral-500">
                  Prazo {new Date(`${c.dueDate}T12:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ·{" "}
                  {c.days} {c.days === 1 ? "dia" : "dias"}
                </span>
                <span className="min-w-0">
                  <Link href={`/board?board=${panel.id}&card=${c.id}`} className="font-semibold text-neutral-900 hover:underline">
                    #{c.number} {c.title}
                  </Link>
                  {c.assignee && <span className="text-neutral-600"> · {c.assignee}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="font-headline text-3xl tabular-nums" style={{ color: value > 0 && color ? color : undefined }}>
        {value}
      </p>
      <p className="mt-1 text-xs text-neutral-600">{label}</p>
    </div>
  );
}

function Box({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-600">{title}</h2>
      {children}
      {note && <p className="mt-3 text-xs text-neutral-500">{note}</p>}
    </section>
  );
}

/** Barras empilhadas por etapa, com legenda. */
function Stacked({
  rows,
  stages,
  colors,
}: {
  rows: StackRow[];
  stages: PanelStage[];
  colors: Map<string, string>;
}) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">Sem cards.</p>;
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2 text-sm">
            <span className="break-words text-neutral-700">
              {r.label}
            </span>
            <span
              className="flex h-2 overflow-hidden rounded-full bg-neutral-100"
              role="img"
              aria-label={stages
                .filter((s) => r.byStage[s.id])
                .map((s) => `${s.name}: ${r.byStage[s.id]}`)
                .join(", ")}
            >
              {stages.map((s) =>
                r.byStage[s.id] ? (
                  <span
                    key={s.id}
                    className="h-full"
                    style={{ width: `${(r.byStage[s.id]! / max) * 100}%`, background: colors.get(s.id) }}
                  />
                ) : null,
              )}
            </span>
            <span className="num text-right font-semibold text-neutral-800">{r.total}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600" aria-hidden="true">
        {stages.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: colors.get(s.id) }} />
            {s.name}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Barras simples (um valor por linha); null aparece como "—". */
function Values({
  rows,
  color,
  format,
}: {
  rows: ValueRow[];
  color: string;
  format: (v: number) => string;
}) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm">
          <span className="break-words text-neutral-700">
            {r.label}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
            <span className="block h-full rounded-full" style={{ width: `${((r.value ?? 0) / max) * 100}%`, background: color }} />
          </span>
          <span className="num text-right font-semibold text-neutral-800">{r.value === null ? "—" : format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
