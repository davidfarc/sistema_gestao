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
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { addField, deleteField, toggleFieldOnCard, updateField } from "@/lib/board/actions";
import type { FieldDef, FieldType, FieldValueRaw, MemberOption } from "@/lib/board/types";
import { useBoardId } from "./BoardContext";

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
  const [editing, setEditing] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setEditing(false);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setEditing(false);
  }

  // Popover num portal com posição fixed → escapa do overflow da tabela.
  function Popover({ children }: { children: ReactNode }) {
    if (!open || !anchor) return null;
    return createPortal(
      <>
        <div className="fixed inset-0 z-[60]" onClick={close} />
        <div className="fixed z-[61]" style={{ top: anchor.top, right: anchor.right }}>
          {children}
        </div>
      </>,
      document.body,
    );
  }

  return (
    <span className="inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        className="rounded px-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
        aria-label="Opções da propriedade"
      >
        ⋯
      </button>

      <Popover>
        {editing ? (
          <PropertyForm
            initial={{
              name: field.name,
              type: field.type,
              optionsText: field.options.map((o) => o.label).join(", "),
              colors: field.options.map((o) => o.color),
            }}
            submitLabel="Salvar"
            onClose={close}
            onSubmit={async (name, type, options) => {
              await updateField(field.id, name, type, options);
              close();
              onChanged();
            }}
          />
        ) : (
          <div className="w-44 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="block w-full px-3 py-1.5 text-left text-neutral-700 hover:bg-neutral-50"
            >
              Editar propriedade
            </button>
            <button
              type="button"
              onClick={async () => {
                close();
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
                close();
                await deleteField(field.id);
                onChanged();
              }}
              className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
            >
              Remover propriedade
            </button>
          </div>
        )}
      </Popover>
    </span>
  );
}

/** Formulário compartilhado por AddProperty e EditProperty (nome, tipo, opções). */
function PropertyForm({
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  initial?: { name: string; type: FieldType; optionsText: string; colors?: string[] };
  submitLabel: string;
  onClose: () => void;
  onSubmit: (
    name: string,
    type: FieldType,
    options?: { label: string; color: string }[],
  ) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<FieldType>(initial?.type ?? "text");
  const [optionsText, setOptionsText] = useState(initial?.optionsText ?? "");
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
          .map((label, i) => ({
            label,
            color: initial?.colors?.[i] ?? OPTION_COLORS[i % OPTION_COLORS.length]!,
          }))
      : undefined;
    try {
      await onSubmit(name, type, options);
    } finally {
      setPending(false);
    }
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
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function AddProperty({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const boardId = useBoardId();
  return (
    <PropertyForm
      submitLabel="Criar"
      onClose={onClose}
      onSubmit={async (name, type, options) => {
        await addField(boardId, name, type, options);
        onAdded();
      }}
    />
  );
}
