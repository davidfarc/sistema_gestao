"use client";

import { RefreshCw, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { useSalasData } from "@/lib/salas/SalasContext";
import { useBuscaAtivaAlerts } from "@/lib/salas/useBuscaAtivaAlerts";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import type { BuscaAtivaAlert } from "@/lib/salas/types";

const protocol = [
  {
    tier: "03 DIAS: MENSAGEM",
    desc: "Enviar mensagem via app/WhatsApp para a família.",
    cls: "bg-warning/5 border-l-warning text-warning",
  },
  {
    tier: "05 DIAS: LIGAÇÃO",
    desc: "Ligação telefônica + envio de atividades pedagógicas.",
    cls: "bg-[#fff7ed] border-l-[#f97316] text-[#9a3412]",
  },
  {
    tier: "07 DIAS: PROFESSOR",
    desc: "Contato direto do professor regente com os pais.",
    cls: "bg-danger/5 border-l-danger text-danger",
  },
];

const levelBadge: Record<BuscaAtivaAlert["level"], { label: string; cls: string; dot: string }> = {
  red: { label: "CRÍTICO", cls: "bg-danger/10 text-danger", dot: "bg-danger" },
  orange: { label: "ALERTA", cls: "bg-warning/10 text-warning", dot: "bg-warning" },
  green: { label: "ATENÇÃO", cls: "bg-success/10 text-success", dot: "bg-success" },
};

function StepCheck({
  studentId,
  step,
  done,
  enabled,
  write,
}: {
  studentId: string | number;
  step: "step3" | "step5" | "step7";
  done: boolean;
  enabled: boolean;
  write: (path: string, value: unknown) => Promise<void>;
}) {
  return (
    <input
      type="checkbox"
      checked={done}
      disabled={!enabled}
      onChange={(e) => write(`buscaAtivaLogs/${String(studentId)}/${step}`, e.target.checked)}
      className={clsx(
        "w-5 h-5 rounded cursor-pointer accent-[var(--color-success)]",
        !enabled && "opacity-30 cursor-not-allowed"
      )}
    />
  );
}

export default function BuscaAtivaPage() {
  const { data } = useSalasData();
  const write = useSalasWrite();
  const { alerts, loading } = useBuscaAtivaAlerts();
  const logs = data?.buscaAtivaLogs ?? {};

  return (
    <div className="space-y-6">
      <div className="bg-surface-lowest border border-black/5 rounded-2xl p-6 shadow-premium-soft">
        <h3 className="font-headline font-bold text-primary text-lg">Monitoramento de Evasão Escolar</h3>
        <p className="text-secondary text-sm mt-1 leading-relaxed">
          Painel que identifica alunos com faltas sequenciais injustificadas, cruzando dados do ActiveSoft.
        </p>
        <div className="grid sm:grid-cols-3 gap-4 mt-5">
          {protocol.map((p) => (
            <div key={p.tier} className={clsx("rounded-xl border-l-4 p-4", p.cls)}>
              <strong className="block text-sm">{p.tier}</strong>
              <span className="text-xs opacity-80">{p.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface-lowest border border-black/5 rounded-2xl overflow-hidden shadow-premium-soft">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-low text-secondary text-xs uppercase tracking-wide">
                <th className="text-left font-semibold px-4 py-3">Aluno</th>
                <th className="text-center font-semibold px-4 py-3">Sequência</th>
                <th className="text-center font-semibold px-4 py-3">Risco</th>
                <th className="text-center font-semibold px-4 py-3">Ações concluídas</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-secondary">
                    <RefreshCw className="w-5 h-5 animate-spin inline" aria-hidden="true" /> Carregando alertas…
                  </td>
                </tr>
              ) : alerts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-secondary">
                    <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" aria-hidden="true" />
                    <strong className="text-primary">Tudo em ordem!</strong>
                    <br />
                    Nenhum aluno com faltas críticas detectado.
                  </td>
                </tr>
              ) : (
                alerts.map((a) => {
                  const badge = levelBadge[a.level] ?? levelBadge.green;
                  const sLogs = logs[String(a.id)] ?? {};
                  return (
                    <tr key={String(a.id)} className="border-t border-surface-medium">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className={clsx("w-2.5 h-2.5 rounded-full shrink-0", badge.dot)} />
                          <div className="flex flex-col">
                            <strong className="text-primary">{a.name}</strong>
                            {a.lastDate && (
                              <span className="text-[11px] text-secondary">
                                Última falta: {new Date(a.lastDate).toLocaleDateString("pt-BR")}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-lg font-headline font-bold text-primary">{a.days} dias</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={clsx("px-3 py-1 rounded-md text-xs font-bold", badge.cls)}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-6">
                          <div className="flex flex-col items-center gap-1">
                            <StepCheck studentId={a.id} step="step3" done={!!sLogs.step3} enabled write={write} />
                            <span className="text-[10px] font-bold text-secondary">MSG (3d)</span>
                          </div>
                          <div className="flex flex-col items-center gap-1">
                            <StepCheck studentId={a.id} step="step5" done={!!sLogs.step5} enabled={a.days >= 5} write={write} />
                            <span className="text-[10px] font-bold text-secondary">LIG (5d)</span>
                          </div>
                          <div className="flex flex-col items-center gap-1">
                            <StepCheck studentId={a.id} step="step7" done={!!sLogs.step7} enabled={a.days >= 7} write={write} />
                            <span className="text-[10px] font-bold text-secondary">PROF (7d)</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
