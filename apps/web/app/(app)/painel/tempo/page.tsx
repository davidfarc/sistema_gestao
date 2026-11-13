import { notFound } from "next/navigation";

import { PainelTabs } from "@/components/painel/PainelTabs";
import { provisionAndGetActor } from "@/lib/actor";
import { loadPanelBoards } from "@/lib/reports/boardPanel";
import { fmtHours } from "@/lib/time/format";
import { isoDay, loadTimeRows, sumBy, type TimeRow } from "@/lib/time/report";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tempo por tarefa (só para quem tem `time:read`): quem está trabalhando em
 * quê agora, horas por pessoa e por pipeline no período, os cards que mais
 * consumiram tempo e a planilha para baixar.
 */
export default async function TempoPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const actor = await provisionAndGetActor();
  if (!actor?.permissions.has("time:read")) notFound();

  const [sp, panels] = await Promise.all([searchParams, loadPanelBoards()]);
  const today = isoDay(new Date());
  const weekAgo = isoDay(new Date(Date.now() - 6 * 86_400_000));
  const from = DAY.test(sp.de ?? "") ? sp.de! : weekAgo;
  const to = DAY.test(sp.ate ?? "") ? sp.ate! : today;

  let rows: TimeRow[] | null = null;
  try {
    rows = from <= to ? await loadTimeRows(from, to) : [];
  } catch {
    rows = null;
  }
  const running = rows?.filter((r) => r.endedAt === null) ?? [];
  const total = rows?.reduce((s, r) => s + r.seconds, 0) ?? 0;
  const byPerson = rows ? sumBy(rows, (r) => r.userName) : [];
  const byBoard = rows ? sumBy(rows, (r) => r.boardName) : [];
  const byCard = rows ? sumBy(rows, (r) => r.cardId).slice(0, 15) : [];
  const max = (xs: [string, { seconds: number }][]) => Math.max(1, ...xs.map(([, v]) => v.seconds));
  const qs = `de=${from}&ate=${to}`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-2xl">Painéis</h1>
      <PainelTabs current="tempo" showTime panels={panels} />

      <form className="mt-5 flex flex-wrap items-end gap-3" method="get">
        <label className="grid gap-1 text-sm text-neutral-700">
          De
          <input type="date" name="de" defaultValue={from} className="rounded-lg border border-neutral-300 bg-white px-3 py-2" />
        </label>
        <label className="grid gap-1 text-sm text-neutral-700">
          Até
          <input type="date" name="ate" defaultValue={to} className="rounded-lg border border-neutral-300 bg-white px-3 py-2" />
        </label>
        <button type="submit" className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high">
          Ver período
        </button>
        <span className="ml-auto flex flex-wrap gap-2">
          <a href={`/api/relatorios/tempo?${qs}&modo=detalhado`} className="inline-flex min-h-10 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            Baixar planilha detalhada
          </a>
          <a href={`/api/relatorios/tempo?${qs}&modo=resumo`} className="inline-flex min-h-10 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            Baixar resumo por card
          </a>
        </span>
      </form>
      <p className="mt-2 text-sm text-neutral-600">
        Tempo com o cronômetro ligado nos cards. Mede o tempo das tarefas; não é registro de jornada.
      </p>

      {rows === null ? (
        <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Não foi possível carregar. Se esta tela acabou de ser publicada, falta aplicar a atualização do
          banco (migration 0041).
        </p>
      ) : (
        <div className="mt-6 grid gap-5">
          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="text-base font-semibold text-neutral-800">Equipe agora</h2>
            {running.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">Ninguém com cronômetro ligado neste momento.</p>
            ) : (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {running.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="font-medium text-neutral-800">{r.userName}</span>
                      <span className="block truncate text-neutral-700">
                        #{r.cardNumber} {r.cardTitle} · {r.boardName}
                      </span>
                      <span className="text-xs text-neutral-600">
                        desde {new Date(r.startedAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Bars title="Horas por pessoa" items={byPerson} max={max(byPerson)} empty="Nenhum tempo registrado no período." />
            <Bars title="Horas por pipeline" items={byBoard} max={max(byBoard)} empty="Nenhum tempo registrado no período." />
          </div>

          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-neutral-800">Cards que mais consumiram tempo</h2>
              <span className="text-sm text-neutral-600">
                Total no período: <strong className="font-mono tabular-nums">{fmtHours(total)}</strong>
              </span>
            </div>
            {byCard.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">Nenhum tempo registrado no período.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-neutral-600">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Card</th>
                      <th className="py-2 pr-3 font-medium">Pipeline</th>
                      <th className="py-2 pr-3 font-medium">Etapa</th>
                      <th className="py-2 pr-3 font-medium">Pessoas</th>
                      <th className="py-2 text-right font-medium">Horas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {byCard.map(([id, g]) => {
                      const r = g.rows[0]!;
                      return (
                        <tr key={id}>
                          <td className="py-2 pr-3">
                            <a href={`/card/${id}`} className="hover:underline">
                              <span className="text-neutral-600">#{r.cardNumber}</span> {r.cardTitle}
                            </a>
                          </td>
                          <td className="py-2 pr-3 text-neutral-700">{r.boardName}</td>
                          <td className="py-2 pr-3 text-neutral-700">{r.stageName}{r.cardDone ? " ✓" : ""}</td>
                          <td className="py-2 pr-3 text-neutral-700">{[...new Set(g.rows.map((x) => x.userName))].join(", ")}</td>
                          <td className="py-2 text-right font-mono tabular-nums">{fmtHours(g.seconds)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Bars({
  title,
  items,
  max,
  empty,
}: {
  title: string;
  items: [string, { seconds: number }][];
  max: number;
  empty: string;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="text-base font-semibold text-neutral-800">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">{empty}</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {items.map(([name, v]) => (
            <li key={name} className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-2 text-sm">
              <span className="truncate text-neutral-700" title={name}>{name}</span>
              <span className="h-2 rounded-full bg-neutral-100" aria-hidden="true">
                <span className="block h-2 rounded-full bg-primary/70" style={{ width: `${(v.seconds / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono tabular-nums text-neutral-800">{fmtHours(v.seconds)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
