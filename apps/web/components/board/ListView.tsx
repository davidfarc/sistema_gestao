"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  loadAllFieldValues,
  loadFields,
  loadMembers,
  moveCard,
  setCardResponsible,
  setFieldValue,
  updateCard,
} from "@/lib/board/actions";
import type {
  CardView,
  FieldDef,
  FieldValueRaw,
  MemberOption,
  StageView,
} from "@/lib/board/types";
import { useBoardId } from "./BoardContext";
import { AddProperty, FieldEditor, FieldMenu } from "./fieldControls";

export function ListView({
  cards,
  stages,
  onOpenCard,
  canConfigure,
}: {
  cards: CardView[];
  stages: StageView[];
  onOpenCard: (id: string) => void;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const boardId = useBoardId();
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<string, FieldValueRaw>>({});
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [adding, setAdding] = useState(false);

  const stageName = useMemo(() => {
    const m = new Map(stages.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [stages]);

  async function reload() {
    const [fs, vs, ms] = await Promise.all([loadFields(boardId), loadAllFieldValues(), loadMembers()]);
    setFields(fs);
    setMembers(ms);
    setValues(Object.fromEntries(vs.map((v) => [`${v.cardId}|${v.value.fieldId}`, v.value])));
  }

  useEffect(() => {
    reload();
  }, []);

  async function saveVal(
    cardId: string,
    fieldId: string,
    value: string | number | boolean | null,
    patch: Partial<FieldValueRaw>,
  ) {
    const key = `${cardId}|${fieldId}`;
    setValues((prev) => ({
      ...prev,
      [key]: { fieldId, text: null, number: null, date: null, bool: null, memberId: null, ...prev[key], ...patch },
    }));
    await setFieldValue(cardId, fieldId, value);
    router.refresh(); // reflete chips na face do card (visão Kanban)
  }

  async function saveTitle(cardId: string, title: string, current: string) {
    if (title.trim() && title.trim() !== current) {
      await updateCard({ id: cardId, title });
      router.refresh();
    }
  }
  async function changeStage(cardId: string, stageId: string) {
    const res = await moveCard(cardId, stageId);
    if (!res.ok) alert(res.reason);
    router.refresh();
  }
  async function changeResponsible(cardId: string, userId: string) {
    await setCardResponsible(cardId, userId || null);
    router.refresh();
  }

  const cellInput =
    "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-neutral-200 focus:border-neutral-400";

  return (
    <div>
      {canConfigure && (
        <div className="mb-3">
          {adding ? (
            <AddProperty
              onClose={() => setAdding(false)}
              onAdded={async () => {
                setAdding(false);
                await reload();
                router.refresh();
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-sm font-medium text-primary hover:underline"
            >
              + Propriedade
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Título</th>
              <th className="px-3 py-2 font-medium">Etapa</th>
              <th className="px-3 py-2 font-medium">Responsável</th>
              {fields.map((f) => (
                <th key={f.id} className="min-w-36 whitespace-nowrap px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-1">
                    {f.name}
                    {canConfigure && <FieldMenu field={f} onChanged={reload} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {cards.map((card) => (
              <tr key={card.id} className="hover:bg-neutral-50">
                <td
                  className="cursor-pointer whitespace-nowrap px-3 py-2 font-medium text-neutral-500"
                  onClick={() => onOpenCard(card.id)}
                  title="Abrir card"
                >
                  #{card.number}
                </td>
                <td className="min-w-40 px-3 py-1.5">
                  <input
                    defaultValue={card.title}
                    onBlur={(e) => saveTitle(card.id, e.target.value, card.title)}
                    className={cellInput + " text-neutral-800"}
                  />
                </td>
                <td className="min-w-32 px-3 py-1.5">
                  <select
                    value={card.stageId}
                    onChange={(e) => changeStage(card.id, e.target.value)}
                    className={cellInput + " pr-6 text-neutral-600"}
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="min-w-36 px-3 py-1.5">
                  <select
                    value={card.assignee?.id ?? ""}
                    onChange={(e) => changeResponsible(card.id, e.target.value)}
                    className={cellInput + " pr-6 text-neutral-600"}
                  >
                    <option value="">—</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </td>
                {fields.map((f) => (
                  <td key={f.id} className="min-w-36 px-3 py-1.5">
                    <FieldEditor
                      field={f}
                      value={values[`${card.id}|${f.id}`]}
                      members={members}
                      onSave={(v, p) => saveVal(card.id, f.id, v, p)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
