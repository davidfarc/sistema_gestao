"use client";

import { Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  loadFieldValuesByBoard,
  loadFields,
  loadMembers,
  moveCard,
  setCardRequester,
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
import { canEditField } from "@/lib/board/types";
import { matchesFilter } from "@/lib/board/filters";
import { computeDemand } from "@/lib/demandas/eval";
import { loadPrioritizedCardIds } from "@/lib/demandas/queue";
import { useBoardId, useCreationForm, useMyUserId, useThresholds } from "./BoardContext";
import { CreateFormConfig } from "./CreateFormConfig";
import { EMPTY_FILTERS, ListToolbar, SortHeader, type ListFilters, type SortKey } from "./ListToolbar";
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
  const creationForm = useCreationForm();
  const myUserId = useMyUserId();
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<string, FieldValueRaw>>({});
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [prioritized, setPrioritized] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "number",
    dir: "asc",
  });
  const thresholds = useThresholds();

  const stageName = useMemo(() => {
    const m = new Map(stages.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [stages]);

  async function reload() {
    const [fs, vs, ms, prio] = await Promise.all([
      loadFields(boardId),
      loadFieldValuesByBoard(boardId),
      loadMembers(),
      loadPrioritizedCardIds(boardId),
    ]);
    setFields(fs);
    setMembers(ms);
    setValues(Object.fromEntries(vs.map((v) => [`${v.cardId}|${v.value.fieldId}`, v.value])));
    setPrioritized(new Set(prio));
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
  async function changeRequester(cardId: string, userId: string) {
    await setCardRequester(cardId, userId || null);
    router.refresh();
  }

  const cellInput =
    "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-neutral-200 focus:border-neutral-400";

  // RICE/priorização pertencem ao pipeline de demandas — marcado pelo formulário
  // de criação, não por adivinhar nome de campo.
  const isDemandas = creationForm === "custom:demandas";

  /**
   * Dados de demanda por card (RICE, tipo, urgência…), calculados no cliente —
   * computeDemand é puro. Vazio em pipelines que não são de demandas.
   */
  const demandOf = useMemo(() => {
    const out = new Map<string, ReturnType<typeof computeDemand>>();
    if (!isDemandas || fields.length === 0) return out;
    for (const c of cards) {
      const vals = fields
        .map((f) => values[`${c.id}|${f.id}`])
        .filter((v): v is FieldValueRaw => v !== undefined);
      out.set(c.id, computeDemand(fields, vals, thresholds));
    }
    return out;
  }, [cards, fields, values, isDemandas, thresholds]);

  const visible = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    const fieldById = new Map(fields.map((f) => [f.id, f]));
    const rows = cards.filter((c) => {
      if (q && !c.title.toLowerCase().includes(q) && !String(c.number).includes(q)) return false;
      // Todos os filtros de propriedade precisam passar (E lógico, como no Notion).
      for (const pf of filters.props) {
        const field = fieldById.get(pf.fieldId);
        if (!field) continue;
        if (!matchesFilter(field, values[`${c.id}|${pf.fieldId}`], pf)) return false;
      }
      return true;
    });

    const dir = sort.dir === "asc" ? 1 : -1;
    const nullsLast = (v: number | null | undefined) => (v == null ? Number.NEGATIVE_INFINITY : v);
    return [...rows].sort((a, b) => {
      const da = demandOf.get(a.id);
      const dbb = demandOf.get(b.id);
      switch (sort.key) {
        case "title":
          return a.title.localeCompare(b.title, "pt-BR") * dir;
        case "stage":
          return stageName(a.stageId).localeCompare(stageName(b.stageId), "pt-BR") * dir;
        case "responsavel":
          return (a.assignee?.name ?? "").localeCompare(b.assignee?.name ?? "", "pt-BR") * dir;
        case "solicitante":
          return (a.requester?.name ?? "").localeCompare(b.requester?.name ?? "", "pt-BR") * dir;
        case "rice":
          return (nullsLast(da?.rice) - nullsLast(dbb?.rice)) * dir;
        case "orcamento":
          return (nullsLast(da?.fields.orcamento) - nullsLast(dbb?.fields.orcamento)) * dir;
        default:
          return (a.number - b.number) * dir;
      }
    });
  }, [cards, demandOf, fields, filters, sort, stageName, values]);

  /** Clique no cabeçalho: mesma coluna inverte a direção; outra começa asc. */
  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

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
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="text-sm font-medium text-primary hover:underline"
              >
                + Propriedade
              </button>
              <button
                type="button"
                onClick={() => setConfiguring(true)}
                title="Configurar formulário de criação"
                className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800"
              >
                <Settings2 className="h-4 w-4" /> Formulário
              </button>
            </div>
          )}
        </div>
      )}

      {configuring && (
        <CreateFormConfig
          fields={fields}
          onChanged={reload}
          onClose={() => setConfiguring(false)}
        />
      )}

      <ListToolbar
        filters={filters}
        onChange={setFilters}
        fields={fields}
        members={members}
        total={cards.length}
        shown={visible.length}
      />

      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <SortHeader label="#" sortKey="number" current={sort.key} dir={sort.dir} onSort={toggleSort} />
              <SortHeader label="Título" sortKey="title" current={sort.key} dir={sort.dir} onSort={toggleSort} />
              <SortHeader label="Etapa" sortKey="stage" current={sort.key} dir={sort.dir} onSort={toggleSort} />
              <SortHeader
                label="Solicitante"
                sortKey="solicitante"
                current={sort.key}
                dir={sort.dir}
                onSort={toggleSort}
              />
              <SortHeader
                label="Responsável"
                sortKey="responsavel"
                current={sort.key}
                dir={sort.dir}
                onSort={toggleSort}
              />
              {isDemandas && (
                <SortHeader label="RICE" sortKey="rice" current={sort.key} dir={sort.dir} onSort={toggleSort} />
              )}
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
            {visible.length === 0 && (
              <tr>
                <td colSpan={fields.length + (isDemandas ? 6 : 5)} className="px-3 py-6 text-center text-sm text-neutral-400">
                  Nenhum card corresponde aos filtros.
                </td>
              </tr>
            )}
            {visible.map((card) => (
              <tr key={card.id} className="hover:bg-neutral-50">
                <td
                  className="cursor-pointer whitespace-nowrap px-3 py-2 font-medium text-neutral-500"
                  onClick={() => onOpenCard(card.id)}
                  title="Abrir card"
                >
                  #{card.number}
                  {prioritized.has(card.id) && (
                    <span className="ml-1 text-emerald-600" title="Priorizada">
                      ★
                    </span>
                  )}
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
                    value={card.requester?.id ?? ""}
                    onChange={(e) => changeRequester(card.id, e.target.value)}
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
                {isDemandas && (
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-neutral-700">
                    {demandOf.get(card.id)?.rice?.toFixed(1) ?? (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                )}
                {fields.map((f) => (
                  <td key={f.id} className="min-w-36 px-3 py-1.5">
                    <FieldEditor
                      field={f}
                      value={values[`${card.id}|${f.id}`]}
                      members={members}
                      onSave={(v, p) => saveVal(card.id, f.id, v, p)}
                      readOnly={!canEditField(f, myUserId)}
                      compact
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
