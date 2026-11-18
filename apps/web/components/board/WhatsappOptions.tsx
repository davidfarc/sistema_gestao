"use client";

import { useEffect, useState } from "react";

import { loadBoardWhatsapp, setBoardWhatsapp } from "@/lib/board/whatsapp";

/** Seção "Atendimento pelo WhatsApp" das opções do pipeline. */
export function WhatsappOptions({ boardId, boardName }: { boardId: string; boardName: string }) {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await setBoardWhatsapp(boardId, { enabled, instructions });
      setMsg(res.ok ? { ok: true, text: "Atendimento salvo." } : { ok: false, text: res.error });
    } catch {
      setMsg({ ok: false, text: "Não foi possível salvar. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

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
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Atender este pipeline pelo WhatsApp
          </label>
          <label className="grid gap-1 text-sm text-neutral-700">
            O que o agente precisa saber
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={6}
              maxLength={6000}
              placeholder={"Ex.: Pedidos de conserto e manutenção do prédio. Salas de aula: 1 a 20 (térreo) e 21 a 40 (1º andar). Peça sempre o número da sala que está na placa da porta."}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <span className="text-xs text-neutral-500">
              Descreva que tipo de pedido cabe aqui e os lugares (salas, blocos). Não coloque dados de alunos.
            </span>
          </label>
          <div>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="min-h-10 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 disabled:opacity-50"
            >
              {busy ? "Salvando…" : "Salvar atendimento"}
            </button>
          </div>
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
