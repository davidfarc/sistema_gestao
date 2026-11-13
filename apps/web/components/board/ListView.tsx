"use client";

import { Download, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  loadListData,
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
import { memberView } from "@/lib/board/avatar";
import { resolveChip } from "@/lib/board/chips";
import { matchesFilter } from "@/lib/board/filters";
import { computeDemand } from "@/lib/demandas/eval";
import { useBoardId, useCreationForm, useMyUserId, useThresholds } from "./BoardContext";
import { CreateFormConfig } from "./CreateFormConfig";
import { EMPTY_FILTERS, ListToolbar, SortHeader, type ListFilters, type SortKey } from "./ListToolbar";
import { AddProperty, FieldEditor, FieldMenu } from "./fieldControls";

/** Prazo vencido e card fora de etapa concluída (comparação por dia, sem fuso). */
function overdueOf(card: CardView, doneStages: Set<string>): boolean {
  if (!card.dueDate || doneStages.has(card.stageId)) return false;
  return card.dueDate.slice(0, 10) < new Date().toLocaleDateString("en-CA");
}

export function ListView({
  cards,
  stages,
  onOpenCard,
  onMove,
  onPatchCard,
  canConfigure,
}: {
  cards: CardView[];
  stages: StageView[];
  onOpenCard: (id: string) => void;
  /** Troca de etapa (vai para o fim da coluna); o quadro cuida do otimismo e do erro. */
  onMove: (cardId: string, stageId: string) => void;
  /** Reflete uma edição na lista de cards da tela, sem recarregar o quadro. */
  onPatchCard: (cardId: string, patch: Partial<CardView>) => void;
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
  // Filtros rápidos da Lista nova: resumo clicável, responsável e etapa.
  const [quick, setQuick] = useState<{ stageId: string; assigneeId: string; overdue: boolean }>({
    stageId: "",
    assigneeId: "",
    overdue: false,
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "number",
    dir: "asc",
  });
  const thresholds = useThresholds();

  const doneStages = useMemo(() => new Set(stages.filter((s) => s.category === "done").map((s) => s.id)), [stages]);
  const isOverdue = (c: CardView) => overdueOf(c, doneStages);
  const stageName = useMemo(() => {
    const m = new Map(stages.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [stages]);

  async function reload() {
    const data = await loadListData(boardId);
    setFields(data.fields);
    setMembers(data.members);
    setValues(
      Object.fromEntries(data.values.map((v) => [`${v.cardId}|${v.value.fieldId}`, v.value])),
    );
    setPrioritized(new Set(data.prioritizedCardIds));
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
    const next: FieldValueRaw = {
      fieldId,
      text: null,
      number: null,
      date: null,
      bool: null,
      memberId: null,
      ...values[key],
      ...patch,
    };
    setValues((prev) => ({ ...prev, [key]: next }));
    // Etiquetas da face do card (visão Kanban), recalculadas aqui mesmo.
    const nameOf = (id: string) => members.find((m) => m.id === id)?.name;
    onPatchCard(cardId, {
      fields: fields
        .filter((f) => f.showOnCardFace)
        .map((f) => resolveChip(f, f.id === fieldId ? next : values[`${cardId}|${f.id}`], nameOf))
        .filter((c) => c !== null),
    });
    try {
      await setFieldValue(cardId, fieldId, value);
    } catch {
      router.refresh();
      reload();
    }
  }

  const personOf = (userId: string) =>
    userId ? memberView(userId, members.find((m) => m.id === userId)?.name ?? "?") : null;

  // Cada edição muda a tela na hora e grava em seguida; se a gravação falhar,
  // recarrega do servidor para voltar ao valor real.
  async function saveTitle(cardId: string, title: string, current: string) {
    const next = title.trim();
    if (!next || next === current) return;
    onPatchCard(cardId, { title: next });
    await updateCard({ id: cardId, title: next }).catch(() => router.refresh());
  }
  async function changeResponsible(cardId: string, userId: string) {
    onPatchCard(cardId, { assignee: personOf(userId) });
    await setCardResponsible(cardId, userId || null).catch(() => router.refresh());
  }
  async function changeRequester(cardId: string, userId: string) {
    onPatchCard(cardId, { requester: personOf(userId) });
    await setCardRequester(cardId, userId || null).catch(() => router.refresh());
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
      if (quick.stageId && c.stageId !== quick.stageId) return false;
      if (quick.assigneeId === "-" ? !!c.assignee : quick.assigneeId && c.assignee?.id !== quick.assigneeId) return false;
      if (quick.overdue && !isOverdue(c)) return false;
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
        case "prazo":
          return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") * dir;
        case "orcamento":
          return (nullsLast(da?.fields.orcamento) - nullsLast(dbb?.fields.orcamento)) * dir;
        default:
          return (a.number - b.number) * dir;
      }
    });
  }, [cards, demandOf, fields, filters, sort, stageName, values, quick, doneStages]);

  // Pessoas que aparecem como responsáveis nos cards (para o filtro rápido).
  const assignees = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards) if (c.assignee) m.set(c.assignee.id, c.assignee.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [cards]);

  /** Planilha (CSV) com as linhas e colunas que estão na tela. */
  function downloadCsv() {
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["#", "Título", "Etapa", "Solicitante", "Responsável", "Prazo", ...(isDemandas ? ["RICE"] : []), ...fields.map((f) => f.name)];
    const nameOf = (id: string) => members.find((m) => m.id === id)?.name;
    const rows = visible.map((c) => [
      c.number,
      c.title,
      stageName(c.stageId),
      c.requester?.name ?? "",
      c.assignee?.name ?? "",
      c.dueDate ? new Date(c.dueDate.slice(0, 10) + "T12:00").toLocaleDateString("pt-BR") : "",
      ...(isDemandas ? [demandOf.get(c.id)?.rice?.toFixed(1).replace(".", ",") ?? ""] : []),
      ...fields.map((f) => {
        const chip = resolveChip(f, values[`${c.id}|${f.id}`], nameOf);
        return chip ? (f.type === "checkbox" ? "sim" : chip.display) : "";
      }),
    ]);
    const csv = "\ufeff" + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `lista-${new Date().toLocaleDateString("en-CA")}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  const overdueCount = cards.filter(isOverdue).length;

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

      {/* Resumo clicável: um número por etapa e os atrasados. Clicar filtra a lista. */}
      <section aria-label="Resumo" className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        {stages.map((s) => {
          const n = cards.filter((c) => c.stageId === s.id).length;
          const on = quick.stageId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              onClick={() => setQuick((q) => ({ ...q, stageId: on ? "" : s.id }))}
              className={
                "flex flex-col gap-0.5 rounded-lg border bg-white px-3.5 py-3 text-left transition-colors hover:border-primary " +
                (on ? "border-primary ring-1 ring-primary" : "border-neutral-200")
              }
            >
              <strong className="font-headline num text-[1.8rem] font-semibold leading-none text-neutral-800">{n}</strong>
              <span className="truncate text-[12.5px] font-semibold text-neutral-600">{s.name}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={quick.overdue}
          onClick={() => setQuick((q) => ({ ...q, overdue: !q.overdue }))}
          className={
            "flex flex-col gap-0.5 rounded-lg border bg-white px-3.5 py-3 text-left transition-colors hover:border-primary " +
            (quick.overdue ? "border-primary ring-1 ring-primary" : "border-neutral-200")
          }
        >
          <strong className={"font-headline num text-[1.8rem] font-semibold leading-none " + (overdueCount ? "text-danger" : "text-neutral-800")}>
            {overdueCount}
          </strong>
          <span className="text-[12.5px] font-semibold text-neutral-600">Atrasados</span>
        </button>
      </section>

      {/* Filtros rápidos lado a lado; o filtro por propriedade continua na barra abaixo. */}
      <div className="mb-3 grid gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
        <label className="grid gap-1 text-[13px] font-semibold text-neutral-600">
          Responsável
          <select
            value={quick.assigneeId}
            onChange={(e) => setQuick((q) => ({ ...q, assigneeId: e.target.value }))}
            className="rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-[15px] font-normal text-neutral-800"
          >
            <option value="">Toda a equipe</option>
            <option value="-">Sem responsável</option>
            {assignees.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[13px] font-semibold text-neutral-600">
          Etapa
          <select
            value={quick.stageId}
            onChange={(e) => setQuick((q) => ({ ...q, stageId: e.target.value }))}
            className="rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-[15px] font-normal text-neutral-800"
          >
            <option value="">Todas</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[13px] font-semibold text-neutral-600">
          Prazo
          <select
            value={quick.overdue ? "atrasado" : ""}
            onChange={(e) => setQuick((q) => ({ ...q, overdue: e.target.value === "atrasado" }))}
            className="rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-[15px] font-normal text-neutral-800"
          >
            <option value="">Todos</option>
            <option value="atrasado">Só atrasados</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          {(quick.stageId || quick.assigneeId || quick.overdue) && (
            <button
              type="button"
              onClick={() => setQuick({ stageId: "", assigneeId: "", overdue: false })}
              className="min-h-10 rounded-lg px-2 text-[13px] font-semibold text-primary hover:underline"
            >
              Limpar filtros
            </button>
          )}
          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-[13px] font-semibold text-neutral-800 hover:border-primary"
          >
            <Download className="h-4 w-4" aria-hidden="true" /> Baixar planilha
          </button>
        </div>
      </div>

      <ListToolbar
        filters={filters}
        onChange={setFilters}
        fields={fields}
        members={members}
        total={cards.length}
        shown={visible.length}
      />

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="tabela-cab border-b border-neutral-200">
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
              <SortHeader label="Prazo" sortKey="prazo" current={sort.key} dir={sort.dir} onSort={toggleSort} />
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
          <tbody className="divide-y divide-neutral-200">
            {visible.length === 0 && (
              <tr>
                <td colSpan={fields.length + (isDemandas ? 7 : 6)} className="px-3 py-6 text-center text-sm text-neutral-600">
                  Nenhum card corresponde aos filtros.
                </td>
              </tr>
            )}
            {visible.map((card) => (
              <tr key={card.id} className="hover:bg-neutral-100/70">
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
                    // `key`: se o título mudar por fora (outra pessoa), o campo acompanha.
                    key={card.title}
                    defaultValue={card.title}
                    onBlur={(e) => saveTitle(card.id, e.target.value, card.title)}
                    className={cellInput + " text-neutral-800"}
                  />
                </td>
                <td className="min-w-32 px-3 py-1.5">
                  <select
                    value={card.stageId}
                    onChange={(e) => onMove(card.id, e.target.value)}
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
                <td
                  className={
                    "num whitespace-nowrap px-3 py-2 " + (isOverdue(card) ? "font-bold text-danger" : "text-neutral-700")
                  }
                >
                  {card.dueDate
                    ? new Date(card.dueDate.slice(0, 10) + "T12:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
                    : "—"}
                  {isOverdue(card) && <span className="ml-1 text-xs">atrasado</span>}
                </td>
                {isDemandas && (
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-neutral-700">
                    {demandOf.get(card.id)?.rice?.toFixed(1) ?? (
                      <span className="text-neutral-500">—</span>
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
