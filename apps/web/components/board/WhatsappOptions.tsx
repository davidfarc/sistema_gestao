"use client";

import { agentInstructionsText } from "@ecco/core";
import { useEffect, useState } from "react";

import { loadBoardWhatsapp, type BoardWhatsapp } from "@/lib/board/whatsapp";

/**
 * Seção "Atendimento pelo WhatsApp" das opções do pipeline. Não tem botão
 * próprio: avisa o valor atual ao diálogo, que grava tudo no "Salvar".
 */
export function WhatsappOptions({
  boardId,
  boardName,
  onChange,
}: {
  boardId: string;
  boardName: string;
  /** Chamado ao carregar e a cada alteração, com o valor a gravar. */
  onChange: (value: BoardWhatsapp, dirty: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [value, setValue] = useState<BoardWhatsapp>({
    enabled: false,
    instructions: "",
    releaseRequired: false,
    reminderDays: 3,
    driveArchive: false,
  });
  const { enabled, instructions, releaseRequired, reminderDays, driveArchive } = value;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function change(patch: Partial<BoardWhatsapp>) {
    const next = { ...value, ...patch };
    setValue(next);
    onChange(next, true);
  }

  useEffect(() => {
    let alive = true;
    loadBoardWhatsapp(boardId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setValue(res.value);
          setLoaded(true);
        } else setMsg({ ok: false, text: res.error });
      })
      .catch(() => alive && setMsg({ ok: false, text: "Não foi possível carregar." }));
    return () => {
      alive = false;
    };
  }, [boardId]);

  return (
    <div className="grid gap-3 border-t border-neutral-200 p-5">
      <div>
        <h3 className="text-sm font-semibold text-neutral-800">Atendimento pelo WhatsApp</h3>
        <p className="mt-1 text-sm text-neutral-600">
          Quem é da equipe e pode abrir card em <strong>{boardName}</strong> passa a pedir pelo WhatsApp. O
          agente pergunta os campos obrigatórios da criação, confere se o pedido já existe e abre o card na
          primeira etapa.
        </p>
      </div>
      {loaded && (
        <>
          <label className="flex items-center gap-3 text-sm text-neutral-800">
            <input type="checkbox" checked={enabled} onChange={(e) => change({ enabled: e.target.checked })} />
            Atender este pipeline pelo WhatsApp
          </label>
          <label className="grid gap-1 text-sm text-neutral-700">
            O que o agente precisa saber
            <textarea
              value={instructions}
              onChange={(e) => change({ instructions: e.target.value })}
              rows={6}
              maxLength={6000}
              placeholder={"Ex.: Pedidos de conserto e manutenção do prédio. Salas de aula: 1 a 20 (térreo) e 21 a 40 (1º andar). Peça sempre o número da sala que está na placa da porta."}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <span className="text-xs text-neutral-500">
              Descreva que tipo de pedido cabe aqui e os lugares (salas, blocos). Não coloque dados de alunos.
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-neutral-800">
            <input
              type="checkbox"
              checked={releaseRequired}
              onChange={(e) => change({ releaseRequired: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Pedido novo aguarda a liberação da gestão
              <span className="block text-neutral-600">
                O card fica na primeira etapa até o gestor de área deste pipeline, o Gestor ou o Gestor Master
                liberar, pela tela ou respondendo “liberar 142” no WhatsApp. Vale também para cards criados pelo site.
              </span>
            </span>
          </label>
          <label className="grid gap-1 text-sm text-neutral-700">
            Lembrar o responsável depois de quantos dias sem novidade
            <input
              type="number"
              min={0}
              max={60}
              value={reminderDays}
              onChange={(e) => change({ reminderDays: Number(e.target.value) })}
              className="min-h-10 w-24 rounded-lg border border-neutral-300 px-3 text-sm"
            />
            <span className="text-xs text-neutral-500">
              Em dias úteis, das 8h às 18h. Use 0 para não lembrar. A resposta ao lembrete vira comentário no card.
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-neutral-800">
            <input
              type="checkbox"
              checked={driveArchive}
              onChange={(e) => change({ driveArchive: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Guardar as evidências no Google Drive
              <span className="block text-neutral-600">
                Cada pedido aberto pelo WhatsApp ganha uma pasta com as fotos e um TXT com a descrição, organizada
                pelos dois primeiros campos obrigatórios de opções (ex.: Série → Disciplina). O link da pasta
                aparece nos anexos do card. O sistema só grava no Drive; não lê nem apaga.
              </span>
            </span>
          </label>
        </>
      )}
      <details className="rounded-lg border border-neutral-200 text-sm">
        <summary className="cursor-pointer px-3 py-2 font-medium text-neutral-800">
          Ver as instruções gerais do agente
        </summary>
        <div className="border-t border-neutral-200 p-3">
          <p className="mb-2 text-neutral-600">
            É o texto completo que o agente recebe em toda conversa, igual para todos os pipelines. Só leitura: o
            que muda por pipeline é o campo “O que o agente precisa saber”, acima.
          </p>
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 font-sans text-xs text-neutral-800">
            {agentInstructionsText(typeof window === "undefined" ? "" : window.location.host)}
          </pre>
        </div>
      </details>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-red-700")}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
