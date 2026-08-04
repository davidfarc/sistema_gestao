"use client";

import { useMemo, useState } from "react";
import { RefreshCw, AlertCircle, Printer, Download } from "lucide-react";
import clsx from "clsx";
import { useSalasData } from "@/lib/salas/SalasContext";
import { formatBR, todayISO, translateType } from "@/lib/salas/logic";
import type { Absence } from "@/lib/salas/types";

type Tab = "routine" | "absences";

interface RoutineRow {
  date: string;
  studentName: string;
  isExtra: boolean;
  note: string;
}
interface AbsenceRow {
  name: string;
  type: string;
  total: number;
  details: Absence[];
}

function downloadCSV(filename: string, rows: Record<string, string | number>[]) {
  const first = rows[0];
  if (!first) return;
  const headers = Object.keys(first);
  const escape = (v: string | number | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    headers.join(";"),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(";")),
  ].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RelatoriosPage() {
  const { data, loading, error } = useSalasData();
  const [tab, setTab] = useState<Tab>("routine");
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());

  const studentName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data?.students ?? []) map.set(String(s.id).trim(), s.name);
    return (id: string) => map.get(id.trim());
  }, [data?.students]);

  const routineRows = useMemo<RoutineRow[]>(() => {
    const daily = data?.dailyRoutine ?? {};
    const dates = Object.keys(daily).filter((d) => d >= start && d <= end).sort();
    const rows: RoutineRow[] = [];
    for (const date of dates) {
      const r = daily[date];
      if (!r) continue;
      const sNotes = r.studentNotes ?? {};
      const extra = (r.extraTime ?? []).map((x) => String(x).trim());
      const ids = new Set<string>([...Object.keys(sNotes).map((k) => k.trim()), ...extra]);
      for (const sid of ids) {
        rows.push({
          date,
          studentName: studentName(sid) ?? `ID: ${sid}`,
          isExtra: extra.includes(sid),
          note: sNotes[sid] || "-",
        });
      }
    }
    return rows.reverse();
  }, [data?.dailyRoutine, start, end, studentName]);

  const absenceRows = useMemo<AbsenceRow[]>(() => {
    const rows: AbsenceRow[] = [];
    for (const a of data?.adults ?? []) {
      const inRange = (a.absences ?? []).filter((abs) => abs.date && abs.date >= start && abs.date <= end);
      if (inRange.length > 0) {
        rows.push({
          name: a.name,
          type: translateType(data?.staffTypes ?? [], a.type),
          total: inRange.length,
          details: [...inRange].sort((x, y) => (y.date || "").localeCompare(x.date || "")),
        });
      }
    }
    return rows;
  }, [data?.adults, data?.staffTypes, start, end]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-secondary py-24">
        <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span>Carregando relatórios…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto mt-24 bg-danger/5 border border-danger/20 rounded-2xl p-6 text-center">
        <AlertCircle className="w-6 h-6 text-danger mx-auto mb-2" aria-hidden="true" />
        <p className="text-danger font-semibold">Não foi possível carregar os relatórios</p>
        <p className="text-secondary text-sm mt-1">{error ?? "Sem resposta do banco."}</p>
      </div>
    );
  }

  const exportCSV = () => {
    if (tab === "routine") {
      downloadCSV(
        `Relatorio_Rotina_${start}_a_${end}.csv`,
        routineRows.map((r) => ({
          DATA: formatBR(r.date),
          ALUNO: r.studentName,
          "+ TIME": r.isExtra ? "SIM" : "NÃO",
          OBSERVACAO: r.note,
        }))
      );
    } else {
      downloadCSV(
        `Faltas_Equipe_${start}_a_${end}.csv`,
        absenceRows.map((r) => ({
          COLABORADOR: r.name,
          CARGO: r.type,
          TOTAL_FALTAS: r.total,
          DATAS_MOTIVOS: r.details.map((d) => `${d.date ? formatBR(d.date) : "-"}: ${d.reason ?? "-"}`).join(" | "),
        }))
      );
    }
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={clsx(
        "px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
        tab === id ? "border-primary text-primary" : "border-transparent text-secondary hover:text-primary"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex gap-2 border-b border-surface-medium">
        {tabBtn("routine", "Rotina dos Alunos")}
        {tabBtn("absences", "Faltas da Equipe")}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">Data inicial</label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="w-44">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">Data final</label>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-surface-lowest border border-surface-medium text-primary rounded-lg px-4 py-2 text-sm font-semibold hover:bg-surface-low"
          >
            <Printer className="w-4 h-4" aria-hidden="true" /> Imprimir
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 bg-primary text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-primary-high"
          >
            <Download className="w-4 h-4" aria-hidden="true" /> Exportar CSV
          </button>
        </div>
      </div>

      <div className="bg-surface-lowest border border-black/5 rounded-2xl overflow-hidden shadow-premium-soft">
        <div className="overflow-x-auto">
          {tab === "routine" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-low text-secondary text-xs uppercase tracking-wide">
                  <th className="text-left font-semibold px-4 py-3 w-32">Data</th>
                  <th className="text-left font-semibold px-4 py-3">Aluno</th>
                  <th className="text-center font-semibold px-4 py-3 w-24">+ Time</th>
                  <th className="text-left font-semibold px-4 py-3">Observação do dia</th>
                </tr>
              </thead>
              <tbody>
                {routineRows.map((r, i) => (
                  <tr key={`${r.date}-${i}`} className="border-t border-surface-medium">
                    <td className="px-4 py-3 text-secondary">{formatBR(r.date)}</td>
                    <td className="px-4 py-3 font-semibold text-primary">{r.studentName}</td>
                    <td className="px-4 py-3 text-center">
                      {r.isExtra ? (
                        <span className="bg-warning/15 text-warning px-2 py-0.5 rounded-md text-xs font-bold">SIM</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-secondary italic">{r.note !== "-" ? `"${r.note}"` : "-"}</td>
                  </tr>
                ))}
                {routineRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-secondary italic">
                      Nenhum registro encontrado no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-low text-secondary text-xs uppercase tracking-wide">
                  <th className="text-left font-semibold px-4 py-3">Colaborador</th>
                  <th className="text-left font-semibold px-4 py-3 w-32">Cargo</th>
                  <th className="text-center font-semibold px-4 py-3 w-20">Total</th>
                  <th className="text-left font-semibold px-4 py-3">Datas e motivos</th>
                </tr>
              </thead>
              <tbody>
                {absenceRows.map((r, i) => (
                  <tr key={`${r.name}-${i}`} className="border-t border-surface-medium align-top">
                    <td className="px-4 py-3 font-semibold text-primary">{r.name}</td>
                    <td className="px-4 py-3 text-secondary">{r.type}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-danger/10 text-danger px-2 py-0.5 rounded-md text-xs font-bold">{r.total}</span>
                    </td>
                    <td className="px-4 py-3 text-secondary">
                      <div className="flex flex-col gap-1">
                        {r.details.map((d, j) => (
                          <span key={j}>
                            • <strong className="text-primary">{d.date ? formatBR(d.date) : "-"}</strong>: {d.reason ?? "-"}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {absenceRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-secondary italic">
                      Nenhuma falta registrada para a equipe no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
