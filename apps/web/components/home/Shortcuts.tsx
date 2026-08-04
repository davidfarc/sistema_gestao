"use client";

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  ExternalLink,
  FileText,
  Folder,
  GraduationCap,
  KanbanSquare,
  Link as LinkIcon,
  Palette,
  Pencil,
  Plus,
  Presentation,
  ShoppingCart,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { newCardHref, parseNewCardHref } from "@/lib/board/newCardLink";
import {
  createShortcut,
  deleteShortcut,
  moveShortcut,
  updateShortcut,
} from "@/lib/shortcuts/actions";
import { isExternal, SHORTCUT_ICONS, type ShortcutView } from "@/lib/shortcuts/types";

/**
 * Mapa EXPLÍCITO dos ícones oferecidos. Nada de `import * as Icons`: aquilo
 * derruba o tree-shaking e traz os ~1000 ícones do lucide (a home foi de ~4 kB
 * para 201 kB no build antes desta troca).
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Link: LinkIcon,
  ExternalLink,
  KanbanSquare,
  FileText,
  BookOpen,
  Presentation,
  Palette,
  BarChart3,
  Users,
  ShoppingCart,
  GraduationCap,
  Folder,
};

/** Resolve o ícone pelo nome guardado; cai no genérico se não existir. */
function IconOf({ name, className }: { name: string | null; className?: string }) {
  const Cmp = (name && ICON_MAP[name]) || LinkIcon;
  return <Cmp className={className} />;
}

export function Shortcuts({
  shortcuts,
  boards,
  canManage,
}: {
  shortcuts: ShortcutView[];
  boards: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ShortcutView | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function move(id: string, dir: "up" | "down") {
    setBusy(id);
    await moveShortcut(id, dir);
    setBusy(null);
    router.refresh();
  }

  async function remove(s: ShortcutView) {
    if (!confirm(`Remover o atalho "${s.label}"?`)) return;
    setBusy(s.id);
    await deleteShortcut(s.id);
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary">Atalhos</h2>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            <Plus className="h-3.5 w-3.5" /> Atalho
          </button>
        )}
      </div>

      {shortcuts.length === 0 ? (
        <p className="mt-3 text-sm text-secondary">
          {canManage
            ? "Nenhum atalho ainda. Crie links para um pipeline específico ou para fora (portfólio, playbook…)."
            : "Nenhum atalho cadastrado."}
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((s, i) => {
            const external = isExternal(s.href);
            return (
              <div
                key={s.id}
                className="group relative rounded-xl border border-surface-medium bg-surface-lowest shadow-premium-soft transition hover:shadow-premium-hover"
              >
                <NextLink
                  href={s.href}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noopener noreferrer" : undefined}
                  className="flex items-start gap-3 p-4"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
                    <IconOf name={s.icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-base font-medium text-neutral-800">
                      <span className="truncate">{s.label}</span>
                      {external && <ExternalLink className="h-3 w-3 shrink-0 text-neutral-400" />}
                    </span>
                    {s.description && (
                      <span className="mt-0.5 block text-sm text-secondary">{s.description}</span>
                    )}
                  </span>
                </NextLink>

                {canManage && (
                  <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <IconBtn label="Subir" onClick={() => move(s.id, "up")} disabled={busy === s.id || i === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn
                      label="Descer"
                      onClick={() => move(s.id, "down")}
                      disabled={busy === s.id || i === shortcuts.length - 1}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn label="Editar" onClick={() => setEditing(s)} disabled={busy === s.id}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn label="Remover" onClick={() => remove(s)} disabled={busy === s.id} danger>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ShortcutForm
          initial={editing === "new" ? null : editing}
          boards={boards}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={
        "rounded bg-white/90 p-1 shadow-sm disabled:opacity-30 " +
        (danger ? "text-neutral-400 hover:text-red-600" : "text-neutral-400 hover:text-neutral-700")
      }
    >
      {children}
    </button>
  );
}

/** Destinos possíveis de um atalho. Os dois internos usam o mesmo seletor. */
type Mode = "externo" | "pipeline" | "novo";

const MODES: { key: Mode; label: string }[] = [
  { key: "externo", label: "Link externo" },
  { key: "pipeline", label: "Pipeline" },
  { key: "novo", label: "Novo card" },
];

function ShortcutForm({
  initial,
  boards,
  onClose,
  onSaved,
}: {
  initial: ShortcutView | null;
  boards: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Destinos internos são montados pelo seletor, nunca digitados: UUID escrito à
  // mão não sobrevive a uma cópia do sistema para outra escola.
  // A ordem importa: o link do formulário também começa com "/board?board=".
  const novoBoard = initial ? parseNewCardHref(initial.href) : null;
  const initialBoard =
    !novoBoard && initial?.href.startsWith("/board?board=")
      ? (initial.href.split("board=")[1] ?? "")
      : "";
  const [mode, setMode] = useState<Mode>(
    novoBoard ? "novo" : initialBoard ? "pipeline" : "externo",
  );
  const [boardId, setBoardId] = useState(novoBoard ?? initialBoard);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [href, setHref] = useState(novoBoard || initialBoard ? "" : (initial?.href ?? ""));
  const [icon, setIcon] = useState(initial?.icon ?? "Link");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const destino =
      mode === "externo"
        ? href
        : !boardId
          ? ""
          : mode === "novo"
            ? newCardHref(boardId)
            : `/board?board=${boardId}`;
    const payload = { label, description, href: destino, icon };
    const res = initial
      ? await updateShortcut(initial.id, payload)
      : await createShortcut(payload);
    setBusy(false);
    if (res.ok) onSaved();
    else setError(res.error);
  }

  const input =
    "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-800">
            {initial ? "Editar atalho" : "Novo atalho"}
          </h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 p-4">
          <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 text-sm">
            {MODES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={
                  "flex-1 rounded-md px-3 py-1 font-medium transition-colors " +
                  (mode === key
                    ? "bg-primary text-white"
                    : "text-neutral-500 hover:text-neutral-800")
                }
              >
                {label}
              </button>
            ))}
          </div>

          <label className="grid gap-1">
            <span className="text-xs font-medium text-neutral-600">Nome</span>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Portfólio no Canva"
              className={input}
            />
          </label>

          {mode !== "externo" ? (
            <label className="grid gap-1">
              <span className="text-xs font-medium text-neutral-600">Pipeline</span>
              <select value={boardId} onChange={(e) => setBoardId(e.target.value)} className={input}>
                <option value="">Selecione…</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {mode === "novo" && (
                <span className="text-xs text-neutral-400">
                  Abre direto o formulário de criação deste pipeline — o simples, o genérico
                  ou o especializado, conforme a configuração dele.
                </span>
              )}
            </label>
          ) : (
            <label className="grid gap-1">
              <span className="text-xs font-medium text-neutral-600">Link</span>
              <input
                value={href}
                onChange={(e) => setHref(e.target.value)}
                placeholder="canva.com/… (abre em nova aba)"
                className={input}
              />
            </label>
          )}

          <label className="grid gap-1">
            <span className="text-xs font-medium text-neutral-600">Descrição (opcional)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Material comercial atualizado"
              className={input}
            />
          </label>

          <div className="grid gap-1">
            <span className="text-xs font-medium text-neutral-600">Ícone</span>
            <div className="flex flex-wrap gap-1">
              {SHORTCUT_ICONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setIcon(name)}
                  title={name}
                  className={
                    "rounded-lg border p-2 transition " +
                    (icon === name
                      ? "border-primary bg-primary text-white"
                      : "border-neutral-200 text-neutral-500 hover:border-neutral-300")
                  }
                >
                  <IconOf name={name} className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 p-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
