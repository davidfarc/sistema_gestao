"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { setFieldValue, updateCard } from "@/lib/board/actions";
import type { CardPageData, FieldValueRaw } from "@/lib/board/types";
import { ActivityFeed } from "./ActivityFeed";
import { Attachments } from "./Attachments";
import { Checklists } from "./Checklists";
import { Comments } from "./Comments";
import { FieldEditor } from "./fieldControls";
import { Responsavel } from "./Responsavel";

function emptyValue(fieldId: string): FieldValueRaw {
  return { fieldId, text: null, number: null, date: null, bool: null, memberId: null };
}

export function CardPageView({ data }: { data: CardPageData }) {
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

  function saveDescription() {
    if (description === (data.description ?? "")) return;
    updateCard({ id: data.id, description }).then(refresh);
  }

  function saveField(fieldId: string, value: string | number | boolean | null, patch: Partial<FieldValueRaw>) {
    setValues((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? emptyValue(fieldId)), ...patch } }));
    setFieldValue(data.id, fieldId, value);
  }

  const d = data.detail;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
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

      <Section title="Descrição">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          rows={4}
          placeholder="Adicione uma descrição detalhada…"
          className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 outline-none focus:border-neutral-400"
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
                  />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Responsável">
        <Responsavel
          cardId={data.id}
          stageId={data.stageId}
          stageName={data.stageName}
          assignments={d.assignments}
          members={d.members}
          onChanged={refresh}
        />
      </Section>

      <Section title="Checklists">
        <Checklists cardId={data.id} checklists={d.checklists} onChanged={refresh} />
      </Section>

      <Section title="Anexos">
        <Attachments cardId={data.id} attachments={d.attachments} onChanged={refresh} />
      </Section>

      <Section title="Atividade">
        <ActivityFeed activity={d.activity} />
      </Section>

      <Section title="Comentários" last>
        <Comments cardId={data.id} comments={d.comments} members={d.members} onChanged={refresh} />
      </Section>
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
    <section className={last ? "pt-6" : "border-b border-neutral-100 py-6"}>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">{title}</p>
      {children}
    </section>
  );
}
