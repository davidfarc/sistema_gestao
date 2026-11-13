import { provisionAndGetActor } from "@/lib/actor";
import { isoDay, loadTimeRows, sumBy } from "@/lib/time/report";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function cell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
const hours = (s: number) => (s / 3600).toFixed(2).replace(".", ",");
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })
    : "em andamento";

/**
 * Planilha (CSV) de tempo por tarefa, por período. `modo=detalhado`: uma linha
 * por período trabalhado. `modo=resumo`: uma linha por card. Separador ";" e
 * vírgula decimal, para abrir direto no Excel em português.
 */
export async function GET(request: Request) {
  const actor = await provisionAndGetActor();
  // Sem a permissão, responde como inexistente (SPEC §2.3).
  if (!actor?.permissions.has("time:read")) return new Response("Não encontrado", { status: 404 });

  const url = new URL(request.url);
  const today = isoDay(new Date());
  const from = DAY.test(url.searchParams.get("de") ?? "") ? url.searchParams.get("de")! : today;
  const to = DAY.test(url.searchParams.get("ate") ?? "") ? url.searchParams.get("ate")! : today;
  const mode = url.searchParams.get("modo") === "resumo" ? "resumo" : "detalhado";
  if (from > to) return new Response("Período inválido", { status: 400 });

  const rows = await loadTimeRows(from, to);
  let lines: string[][];
  if (mode === "detalhado") {
    lines = [
      ["Pessoa", "Pipeline", "Card", "Título", "Etapa atual", "Início", "Fim", "Horas no período", "Corrigido"],
      ...rows.map((r) => [
        r.userName,
        r.boardName,
        `#${r.cardNumber}`,
        r.cardTitle,
        r.stageName,
        when(r.startedAt),
        when(r.endedAt),
        hours(r.seconds),
        r.edited ? "sim" : "não",
      ]),
    ];
  } else {
    lines = [
      ["Pipeline", "Card", "Título", "Etapa atual", "Concluído", "Pessoas", "Períodos", "Horas no período"],
      ...sumBy(rows, (r) => r.cardId).map(([, g]) => {
        const r = g.rows[0]!;
        return [
          r.boardName,
          `#${r.cardNumber}`,
          r.cardTitle,
          r.stageName,
          r.cardDone ? "sim" : "não",
          [...new Set(g.rows.map((x) => x.userName))].join(", "),
          String(g.rows.length),
          hours(g.seconds),
        ];
      }),
    ];
  }
  const csv = "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tempo-${mode}-${from}-a-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
