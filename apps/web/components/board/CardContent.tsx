"use client";

import { ArrowRightLeft } from "lucide-react";
import { useState, type ReactNode } from "react";

import { setFieldValue, updateCard } from "@/lib/board/actions";
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
    grid: "lg:grid-cols-[7fr_3fr]",
    comments: "lg:col-start-1 lg:row-start-2",
    aside: "lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0",
    sticky: "lg:sticky lg:top-8",
  },
  xl: {
    grid: "xl:grid-cols-[7fr_3fr]",
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
}: {
  data: CardPageData;
  myUserId?: string | null;
  onChanged: () => void;
  split?: keyof typeof SPLIT;
  /** Celular: rodapé fixo onde o campo de comentário é desenhado (ver Comments). */
  composerSlot?: HTMLElement | null;
  /** O card foi enviado para outro pipeline: quem hospeda decide para onde ir. */
  onTransferred?: (result: TransferResult) => void;
}) {
  const [title, setTitle] = useState(data.title);
  const [description, setDescription] = useState(data.description ?? "");
  const [values, setValues] = useState(data.values);
  const [transferring, setTransferring] = useState(false);
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
            <Checklists cardId={data.id} checklists={d.checklists} onChanged={onChanged} />
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
          {/* Logo antes dos comentários, no celular e no computador. */}
          {onTransferred && (
            <div className="mb-6 border-b border-neutral-100 pb-6">
              <button
                type="button"
                onClick={() => setTransferring(true)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-neutral-300 px-3 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Enviar para outro pipeline
              </button>
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
