"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { setFieldValue, updateCard } from "@/lib/board/actions";
import { canEditField } from "@/lib/board/types";
import type { CardPageData, FieldValueRaw } from "@/lib/board/types";
import { ActivityFeed } from "./ActivityFeed";
import { Attachments } from "./Attachments";
import { Checklists } from "./Checklists";
import { Comments } from "./Comments";
import { FieldEditor } from "./fieldControls";
import { RichDescription } from "./RichDescription";
import { Responsavel } from "./Responsavel";

function emptyValue(fieldId: string): FieldValueRaw {
  return { fieldId, text: null, number: null, date: null, bool: null, memberId: null };
}

export function CardPageView({
  data,
  myUserId = null,
}: {
  data: CardPageData;
  myUserId?: string | null;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [title, setTitle] = useState(data.title);
  const [description, setDescription] = useState(data.description ?? "");
  const [values, setValues] = useState(data.values);

  function saveTitle() {
    const next = title.trim();
    if (!next || next === data.title) return;
    updateCard({ id: data.id, title: next }).then(refresh);
  }

  function saveDescription(html: string) {
    setDescription(html);
    if (html === (data.description ?? "")) return;
    updateCard({ id: data.id, description: html }).then(refresh);
  }

  function saveField(fieldId: string, value: string | number | boolean | null, patch: Partial<FieldValueRaw>) {
    setValues((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? emptyValue(fieldId)), ...patch } }));
    setFieldValue(data.id, fieldId, value);
  }

  const d = data.detail;

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-neutral-500">
        <Link
          href={`/board?board=${data.boardId}`}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-neutral-100"
        >
          <ArrowLeft className="h-4 w-4" /> {data.boardName || "Quadro"}
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="font-medium text-neutral-500">#{data.number}</span>
        {data.stageName && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
            {data.stageName}
          </span>
        )}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-full text-2xl font-semibold text-neutral-800 outline-none"
      />

      <div className="mt-4 grid grid-cols-1 gap-x-8 lg:grid-cols-[7fr_3fr]">
        {/* Conteúdo principal (~70%) */}
        <div className="min-w-0">
          <Section title="Descrição">
            <RichDescription
              value={description}
              onSave={saveDescription}
              placeholder="Adicione uma descrição detalhada… (cole imagens aqui)"
            />
          </Section>

          <Section title="Propriedades">
            {data.fields.length === 0 ? (
              <p className="text-sm text-neutral-400">
                Nenhuma propriedade neste pipeline. Adicione na visão de lista.
              </p>
            ) : (
              <dl className="grid gap-2">
                {data.fields.map((f) => (
                  <div key={f.id} className="grid grid-cols-[10rem_1fr] items-center gap-3">
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
            )}
          </Section>

          <Section title="Pessoas">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-neutral-500">Solicitante</span>
                <Responsavel
                  cardId={data.id}
                  responsibleId={d.requesterId}
                  members={d.members}
                  onChanged={refresh}
                  role="solicitante"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-neutral-500">Responsável</span>
                <Responsavel
                  cardId={data.id}
                  responsibleId={d.responsibleId}
                  members={d.members}
                  onChanged={refresh}
                />
              </label>
            </div>
          </Section>

          <Section title="Checklists">
            <Checklists cardId={data.id} checklists={d.checklists} onChanged={refresh} />
          </Section>

          <Section title="Anexos">
            <Attachments cardId={data.id} attachments={d.attachments} onChanged={refresh} />
          </Section>

          <Section title="Comentários" last>
            <Comments cardId={data.id} comments={d.comments} members={d.members} onChanged={refresh} />
          </Section>
        </div>

        {/* Atividade — coluna lateral (~30%) */}
        <aside className="mt-6 min-w-0 border-t border-neutral-100 pt-4 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="lg:sticky lg:top-8">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
              Atividade
            </p>
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <ActivityFeed activity={d.activity} />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
  last,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section className={last ? "pt-6" : "border-b border-neutral-100 py-6 first:pt-0"}>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">{title}</p>
      {children}
    </section>
  );
}
