"use client";

import { useEffect, useState } from "react";

import { loadBoardSurvey, type BoardSurvey, type BoardSurveyChoices } from "@/lib/board/survey";

/**
 * Seção "Pesquisa de satisfação" das opções do pipeline (pipeline de Reuniões).
 * Não tem botão próprio: avisa o valor ao diálogo, que grava tudo no "Salvar".
 */
export function SurveyOptions({
  boardId,
  onChange,
}: {
  boardId: string;
  onChange: (value: BoardSurvey) => void;
}) {
  const [value, setValue] = useState<BoardSurvey | null>(null);
  const [choices, setChoices] = useState<BoardSurveyChoices | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadBoardSurvey(boardId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) {
          setValue(res.value);
          setChoices(res.choices);
        } else setMsg(res.error);
      })
      .catch(() => alive && setMsg("Não foi possível carregar."));
    return () => {
      alive = false;
    };
  }, [boardId]);

  function change(patch: Partial<BoardSurvey>) {
    if (!value) return;
    const next = { ...value, ...patch };
    setValue(next);
    onChange(next);
  }

  const select = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
  const stagePick = (label: string, key: "triggerStageId" | "waitingStageId" | "doneStageId", hint: string) => (
    <label className="grid gap-1 text-sm text-neutral-700">
      {label}
      <select value={value?.[key] ?? ""} onChange={(e) => change({ [key]: e.target.value })} className={select}>
        <option value="">Escolha a etapa</option>
        {choices?.stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <span className="text-xs text-neutral-500">{hint}</span>
    </label>
  );

  const fieldPick = (label: string, key: "studentFieldId" | "classFieldId", withSelect: boolean) => (
    <label className="grid gap-1 text-sm text-neutral-700">
      {label}
      <select value={value?.[key] ?? ""} onChange={(e) => change({ [key]: e.target.value })} className={select}>
        <option value="">Nenhuma</option>
        {choices?.fields
          .filter((f) => withSelect || f.type !== "select")
          .map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <div className="grid gap-3 border-t border-neutral-200 p-5">
      <div>
        <h3 className="text-sm font-semibold text-neutral-800">Pesquisa de satisfação</h3>
        <p className="mt-1 text-sm text-neutral-600">
          Para o pipeline de reuniões. Quando o card chega na etapa escolhida, quem confirma recebe pelo WhatsApp o
          telefone do participante. Depois da confirmação, o participante recebe o link da pesquisa e o card anda
          sozinho até a resposta chegar.
        </p>
      </div>
      {msg && <p className="text-sm text-amber-800">{msg}</p>}
      {value && choices && (
        <>
          <label className="flex items-center gap-3 text-sm text-neutral-800">
            <input type="checkbox" checked={value.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
            Enviar pesquisa de satisfação depois da reunião
          </label>
          {value.enabled && (
            <>
              {stagePick("Etapa que dispara", "triggerStageId", "Ex.: Realizada. Ao entrar nela, a confirmação do telefone é pedida.")}
              {stagePick("Etapa enquanto espera a resposta", "waitingStageId", "Ex.: Aguardando feedback. O card vai para ela quando a pesquisa sai.")}
              {stagePick("Etapa quando a resposta chega", "doneStageId", "Ex.: Feedback recebido.")}
              <label className="grid gap-1 text-sm text-neutral-700">
                Propriedade com o telefone do participante
                <select value={value.phoneFieldId} onChange={(e) => change({ phoneFieldId: e.target.value })} className={select}>
                  <option value="">Escolha a propriedade</option>
                  {choices.fields.filter((f) => f.type !== "select").map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm text-neutral-700">
                Propriedade com o nome do participante (opcional)
                <select value={value.nameFieldId} onChange={(e) => change({ nameFieldId: e.target.value })} className={select}>
                  <option value="">Usar o título do card</option>
                  {choices.fields.filter((f) => f.type !== "select").map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              {fieldPick("Propriedade com o nome do aluno (opcional)", "studentFieldId", false)}
              {fieldPick("Propriedade com a turma (opcional)", "classFieldId", true)}
              <fieldset className="grid gap-1 text-sm text-neutral-700">
                <legend className="mb-1">Quem confirma o telefone</legend>
                <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-neutral-200 p-2">
                  {choices.people.map((p) => (
                    <label key={p.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={value.confirmerIds.includes(p.id)}
                        onChange={(e) =>
                          change({
                            confirmerIds: e.target.checked
                              ? [...value.confirmerIds, p.id]
                              : value.confirmerIds.filter((x) => x !== p.id),
                          })
                        }
                      />
                      <span>{p.name}</span>
                      {!p.hasPhone && <span className="text-xs text-amber-700">(sem WhatsApp cadastrado)</span>}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </>
      )}
    </div>
  );
}
