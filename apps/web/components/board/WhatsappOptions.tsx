"use client";

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
  const [enabled, setEnabled] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function change(next: BoardWhatsapp) {
    setEnabled(next.enabled);
    setInstructions(next.instructions);
    onChange(next, true);
  }

  useEffect(() => {
    let alive = true;
    loadBoardWhatsapp(boardId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setEnabled(res.value.enabled);
          setInstructions(res.value.instructions);
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
            <input type="checkbox" checked={enabled} onChange={(e) => change({ enabled: e.target.checked, instructions })} />
            Atender este pipeline pelo WhatsApp
          </label>
          <label className="grid gap-1 text-sm text-neutral-700">
            O que o agente precisa saber
            <textarea
              value={instructions}
              onChange={(e) => change({ enabled, instructions: e.target.value })}
              rows={6}
              maxLength={6000}
              placeholder={"Ex.: Pedidos de conserto e manutenção do prédio. Salas de aula: 1 a 20 (térreo) e 21 a 40 (1º andar). Peça sempre o número da sala que está na placa da porta."}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <span className="text-xs text-neutral-500">
              Descreva que tipo de pedido cabe aqui e os lugares (salas, blocos). Não coloque dados de alunos.
            </span>
          </label>
        </>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-red-700")}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
