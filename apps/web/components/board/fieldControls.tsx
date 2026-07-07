"use client";

import {
  Calendar,
  CheckSquare,
  CircleDot,
  Hash,
  Link as LinkIcon,
  ListChecks,
  Type,
  User,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { addField, deleteField, toggleFieldOnCard } from "@/lib/board/actions";
import type { FieldDef, FieldType, FieldValueRaw, MemberOption } from "@/lib/board/types";

const TYPES: { type: FieldType; label: string; Icon: LucideIcon }[] = [
  { type: "text", label: "Texto", Icon: Type },
  { type: "number", label: "Número", Icon: Hash },
  { type: "status", label: "Status", Icon: CircleDot },
  { type: "select", label: "Seleção", Icon: ListChecks },
  { type: "member", label: "Pessoa", Icon: User },
  { type: "checkbox", label: "Caixa de seleção", Icon: CheckSquare },
  { type: "date", label: "Data", Icon: Calendar },
  { type: "link", label: "Link", Icon: LinkIcon },
];

const OPTION_COLORS = ["#1d4ed8", "#047857", "#b45309", "#ba1a1a", "#7c3aed", "#0891b2"];

export function FieldEditor({
  field,
  value,
  members,
  onSave,
}: {
  field: FieldDef;
  value: FieldValueRaw | undefined;
  members: MemberOption[];
  onSave: (value: string | number | boolean | null, patch: Partial<FieldValueRaw>) => void;
}) {
  const cls =
    "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-neutral-200 focus:border-neutral-400";

  switch (field.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={value?.bool ?? false}
          onChange={(e) => onSave(e.target.checked, { bool: e.target.checked })}
          className="h-4 w-4 rounded border-neutral-300"
        />
      );
    case "number":
      return (
        <input
          type="number"
          defaultValue={value?.number ?? ""}
          onBlur={(e) => onSave(e.target.value, { number: e.target.value === "" ? null : Number(e.target.value) })}
          className={cls}
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={value?.date ?? ""}
          onChange={(e) => onSave(e.target.value, { date: e.target.value || null })}
          className={cls}
        />
      );
    case "select":
    case "status":
      return (
        <select
          value={value?.text ?? ""}
          onChange={(e) => onSave(e.target.value, { text: e.target.value || null })}
          className={cls}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "member":
      return (
        <select
          value={value?.memberId ?? ""}
          onChange={(e) => onSave(e.target.value, { memberId: e.target.value || null })}
          className={cls}
        >
          <option value="">—</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          type="text"
          defaultValue={value?.text ?? ""}
          onBlur={(e) => onSave(e.target.value, { text: e.target.value || null })}
          placeholder={field.type === "link" ? "https://…" : ""}
          className={cls}
        />
      );
  }
}

export function FieldMenu({ field, onChanged }: { field: FieldDef; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded px-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
        aria-label="Opções da propriedade"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg">
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await toggleFieldOnCard(field.id, !field.showOnCardFace);
                onChanged();
              }}
              className="block w-full px-3 py-1.5 text-left text-neutral-700 hover:bg-neutral-50"
            >
              {field.showOnCardFace ? "Ocultar do card" : "Mostrar no card"}
            </button>
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await deleteField(field.id);
                onChanged();
              }}
              className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
            >
              Remover propriedade
            </button>
          </div>
        </>
      )}
    </span>
  );
}

export function AddProperty({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [pending, setPending] = useState(false);

  const needsOptions = type === "select" || type === "status";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    const options = needsOptions
      ? optionsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((label, i) => ({ label, color: OPTION_COLORS[i % OPTION_COLORS.length]! }))
      : undefined;
    await addField(name, type, options);
    setPending(false);
    onAdded();
  }

  return (
    <form onSubmit={submit} className="w-72 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome da propriedade"
        className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500"
      />
      <div className="mt-2 grid grid-cols-4 gap-1">
        {TYPES.map(({ type: t, label, Icon }) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={
              "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] " +
              (type === t
                ? "border-primary bg-white text-primary"
                : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300")
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {needsOptions && (
        <input
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
          placeholder="Opções separadas por vírgula"
          className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-500"
        />
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="text-sm text-neutral-500 hover:text-neutral-800">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-3 py-1 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-60"
        >
          Criar
        </button>
      </div>
    </form>
  );
}
