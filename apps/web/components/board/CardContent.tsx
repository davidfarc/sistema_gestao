"use client";

import { Archive, ArrowRightLeft, Pencil } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { setCardArchived, setFieldValue, updateCard } from "@/lib/board/actions";
import { canEditField } from "@/lib/board/types";
import type { CardPageData, FieldValueRaw } from "@/lib/board/types";
import { ActivityFeed } from "./ActivityFeed";
import { Attachments } from "./Attachments";
import { Checklists } from "./Checklists";
import { Comments } from "./Comments";
import { DemandPanel } from "./DemandPanel";
import { FieldEditor } from "./fieldControls";
import { RichDescription } from "./RichDescription";
import { Responsavel } from "./Responsavel";
import { TransferDialog, type TransferResult } from "./TransferDialog";

function emptyValue(fieldId: string): FieldValueRaw {
  return { fieldId, text: null, number: null, date: null, bool: null, memberId: null };
}

// A partir de que largura de TELA a atividade vai para a lateral. No painel do
// quadro o conteúdo é mais estreito que a tela, então a troca acontece depois.
const SPLIT = {
  lg: {
    grid: "lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]",
    comments: "lg:col-start-1 lg:row-start-2",
    aside: "lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0",
    sticky: "lg:sticky lg:top-8",
  },
  xl: {
    grid: "xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]",
    comments: "xl:col-start-1 xl:row-start-2",
    aside: "xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:mt-0 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0",
    sticky: "xl:sticky xl:top-4",
  },
} as const;

/**
 * Conteúdo do card: título, demanda, descrição, propriedades, pessoas,
 * checklists, anexos, comentários e atividade. É O MESMO componente na página
 * `/card/[id]` e no painel aberto por cima do quadro (`?card=<id>`): quem
 * muda só é a moldura em volta.
 *
 * `onChanged` é chamado depois de cada gravação para quem hospeda recarregar
 * os dados (a página dá refresh; o painel busca o card de novo).
 */
export function CardContent({
  data,
  myUserId = null,
  onChanged,
  split = "lg",
  composerSlot = null,
  onTransferred,
  onArchivedChange,
}: {
  data: CardPageData;
  myUserId?: string | null;
  onChanged: () => void;
  split?: keyof typeof SPLIT;
  /** Celular: rodapé fixo onde o campo de comentário é desenhado (ver Comments). */
  composerSlot?: HTMLElement | null;
  /** O card foi enviado para outro pipeline: quem hospeda decide para onde ir. */
  onTransferred?: (result: TransferResult) => void;
  /** O card foi arquivado ou reativado: quem hospeda decide o que fazer com a tela. */
  onArchivedChange?: (archived: boolean) => void;
}) {
  const [title, setTitle] = useState(data.title);
  const [description, setDescription] = useState(data.description ?? "");
  const [values, setValues] = useState(data.values);
  const [dueDate, setDueDate] = useState(data.dueDate ? data.dueDate.slice(0, 10) : "");
  const [rework, setRework] = useState(String(data.reworkCount ?? 0));
  const [editingDue, setEditingDue] = useState(false);
  const [editingRework, setEditingRework] = useState(false);
  const saveBtn =
    "min-h-10 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-high";
  // O número muda por fora (contagem automática ao mover o card): o campo acompanha.
  useEffect(() => setRework(String(data.reworkCount ?? 0)), [data.reworkCount]);
  useEffect(() => setDueDate(data.dueDate ? data.dueDate.slice(0, 10) : ""), [data.dueDate]);
  const [transferring, setTransferring] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const actionBtn =
    "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-neutral-300 px-3 text-sm text-neutral-700 hover:bg-neutral-50";

  async function archive(archived: boolean) {
    setArchiving(true);
    setArchiveError(null);
    try {
      const res = await setCardArchived(data.id, archived);
      if (!res.ok) {
        setArchiveError(res.error);
        return;
      }
      setConfirmArchive(false);
      onArchivedChange?.(archived);
    } catch {
      setArchiveError("Não foi possível gravar. Tente de novo.");
    } finally {
      setArchiving(false);
    }
  }
  const css = SPLIT[split];

  function saveTitle() {
    const next = title.trim();
    if (!next) {
      setTitle(data.title);
      return;
    }
    if (next === data.title) return;
    updateCard({ id: data.id, title: next }).then(onChanged);
  }

  function saveDueDate(day: string) {
    setDueDate(day);
    if (day === (data.dueDate ? data.dueDate.slice(0, 10) : "")) return;
    updateCard({ id: data.id, dueDate: day || null }).then(onChanged);
  }

  function saveRework(raw: string) {
    const next = Math.floor(Number(raw));
    if (raw.trim() === "" || !Number.isFinite(next) || next < 0 || next > 999) {
      setRework(String(data.reworkCount ?? 0));
      return;
    }
    setRework(String(next));
    if (next === (data.reworkCount ?? 0)) return;
    updateCard({ id: data.id, reworkCount: next }).then(onChanged);
  }

  function saveDescription(html: string) {
    setDescription(html);
    if (html === (data.description ?? "")) return;
    updateCard({ id: data.id, description: html }).then(onChanged);
  }

  function saveField(
    fieldId: string,
    value: string | number | boolean | null,
    patch: Partial<FieldValueRaw>,
  ) {
    setValues((prev) => ({
      ...prev,
      [fieldId]: { ...(prev[fieldId] ?? emptyValue(fieldId)), ...patch },
    }));
    setFieldValue(data.id, fieldId, value).then(onChanged);
  }

  const d = data.detail;

  return (
    <>
      {data.archivedAt && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <span className="flex-1">
            Este card está <strong>arquivado</strong> desde{" "}
            {new Date(data.archivedAt).toLocaleDateString("pt-BR")}. Ele não aparece no quadro nem
            nos relatórios.
          </span>
          {onArchivedChange && (
            <button
              type="button"
              onClick={() => archive(false)}
              disabled={archiving}
              className="min-h-9 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
            >
              {archiving ? "Reativando…" : "Reativar card"}
            </button>
          )}
          {archiveError && <span className="w-full text-red-700">{archiveError}</span>}
        </div>
      )}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label="Título do card"
        className="w-full text-xl font-semibold text-neutral-800 outline-none sm:text-2xl"
      />

      {transferring && onTransferred && (
        <TransferDialog
          cardId={data.id}
          cardLabel={`#${data.number} ${title}`}
          onClose={() => setTransferring(false)}
          onTransferred={(result) => {
            setTransferring(false);
            onTransferred(result);
          }}
        />
      )}

      <div className={`mt-4 grid grid-cols-1 gap-x-8 ${css.grid}`}>
        <div className="min-w-0">
          {/* Só aparece nos cards de demanda (o próprio painel decide). */}
          <div className="mb-6 overflow-hidden rounded-lg empty:hidden">
            <DemandPanel cardId={data.id} />
          </div>

          <Section title="Descrição">
            <RichDescription
              value={description}
              onSave={saveDescription}
              placeholder="Adicione uma descrição detalhada… (cole imagens aqui)"
            />
          </Section>

          {data.fields.length > 0 && (
            <Section title="Propriedades">
              <dl className="grid gap-2">
                {data.fields.map((f) => (
                  <div
                    key={f.id}
                    className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3"
                  >
                    <dt className="truncate text-sm text-neutral-500">{f.name}</dt>
                    <dd>
                      <FieldEditor
                        field={f}
                        value={values[f.id]}
                        members={d.members}
                        onSave={(value, patch) => saveField(f.id, value, patch)}
                        readOnly={!canEditField(f, myUserId)}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          <Section title="Prazo">
            {editingDue ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  autoFocus
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-label="Prazo do card"
                  className="min-h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-800 outline-none focus:border-neutral-500"
                />
                <button type="button" onClick={() => { setEditingDue(false); saveDueDate(dueDate); }} className={saveBtn}>
                  Salvar
                </button>
                {data.dueDate && (
                  <button type="button" onClick={() => { setEditingDue(false); saveDueDate(""); }} className={actionBtn}>
                    Remover prazo
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setEditingDue(false); setDueDate(data.dueDate ? data.dueDate.slice(0, 10) : ""); }}
                  className={actionBtn}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="num text-sm text-neutral-800">
                  {dueDate ? new Date(`${dueDate}T12:00`).toLocaleDateString("pt-BR") : "Sem prazo"}
                </span>
                {data.canManage && (
                  <button type="button" onClick={() => setEditingDue(true)} className={actionBtn}>
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Editar prazo
                  </button>
                )}
              </div>
            )}
          </Section>

          {data.reworkCount !== null && (
            <Section title="Emendas">
              {editingRework ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={999}
                    step={1}
                    inputMode="numeric"
                    autoFocus
                    value={rework}
                    onChange={(e) => setRework(e.target.value)}
                    aria-label="Número de emendas"
                    className="num min-h-10 w-24 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-800 outline-none focus:border-neutral-500"
                  />
                  <button type="button" onClick={() => { setEditingRework(false); saveRework(rework); }} className={saveBtn}>
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingRework(false); setRework(String(data.reworkCount ?? 0)); }}
                    className={actionBtn}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="num text-sm font-semibold text-neutral-800">{rework}</span>
                  {data.canManage && (
                    <button type="button" onClick={() => setEditingRework(true)} className={actionBtn}>
                      <Pencil className="h-4 w-4" aria-hidden="true" /> Editar emendas
                    </button>
                  )}
                </div>
              )}
            </Section>
          )}

          <Section title="Pessoas">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-neutral-500">Solicitante</span>
                <Responsavel
                  cardId={data.id}
                  responsibleId={d.requesterId}
                  members={d.members}
                  onChanged={onChanged}
                  role="solicitante"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-neutral-500">Responsável</span>
                <Responsavel
                  cardId={data.id}
                  responsibleId={d.responsibleId}
                  members={d.members}
                  onChanged={onChanged}
                />
              </label>
            </div>
          </Section>

          <Section title="Checklists">
            <Checklists cardId={data.id} boardId={data.boardId} checklists={d.checklists} onChanged={onChanged} />
          </Section>

          <Section title="Anexos" last>
            <Attachments cardId={data.id} attachments={d.attachments} onChanged={onChanged} />
          </Section>

        </div>

        <aside className={`mt-6 min-w-0 border-t border-neutral-100 pt-4 ${css.aside}`}>
          <div className={css.sticky}>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Atividade
            </p>
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <ActivityFeed activity={d.activity} />
            </div>
          </div>
        </aside>

        {/* Comentários: no celular vêm por último (depois da atividade), junto
            do campo fixo no rodapé; em tela larga ficam sob o conteúdo. */}
        <div className={`order-last mt-6 min-w-0 border-t border-neutral-100 pt-6 ${css.comments}`}>
          {/* Ações do card, logo antes dos comentários (celular e computador). */}
          {(onTransferred || onArchivedChange) && !data.archivedAt && (
            <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-neutral-100 pb-6">
              {onTransferred && (
                <button type="button" onClick={() => setTransferring(true)} className={actionBtn}>
                  <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Enviar para outro pipeline
                </button>
              )}
              {onArchivedChange &&
                (confirmArchive ? (
                  <>
                    <span className="text-sm text-neutral-700">Tirar este card do quadro?</span>
                    <button
                      type="button"
                      onClick={() => archive(true)}
                      disabled={archiving}
                      className="min-h-10 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
                    >
                      {archiving ? "Arquivando…" : "Sim, arquivar"}
                    </button>
                    <button type="button" onClick={() => setConfirmArchive(false)} className={actionBtn}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmArchive(true)} className={actionBtn}>
                    <Archive className="h-4 w-4" aria-hidden="true" /> Arquivar card
                  </button>
                ))}
              {archiveError && (
                <p role="alert" className="w-full text-sm text-red-700">
                  {archiveError}
                </p>
              )}
            </div>
          )}
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Comentários
          </p>
          <Comments
            cardId={data.id}
            comments={d.comments}
            members={d.members}
            onChanged={onChanged}
            composerSlot={composerSlot}
          />
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  children,
  last,
}: {
  title: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section className={last ? "pt-6 first:pt-0" : "border-b border-neutral-100 py-6 first:pt-0"}>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">{title}</p>
      {children}
    </section>
  );
}
