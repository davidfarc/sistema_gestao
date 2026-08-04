"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";

// Modal genérico com form. onSubmit pode lançar Error para exibir mensagem e
// manter o modal aberto (validação). Fecha em sucesso, ESC ou clique fora.
export default function Modal({
  open,
  title,
  onClose,
  onSubmit,
  children,
  submitLabel = "Salvar",
  submitTone = "primary",
  size = "md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => Promise<void> | void;
  children: ReactNode;
  submitLabel?: string;
  submitTone?: "primary" | "danger";
  size?: "md" | "lg";
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSaving(false);
      setErr(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handle = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await onSubmit();
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={clsx(
          "bg-surface-lowest rounded-2xl shadow-premium-hover w-full max-h-[90vh] overflow-y-auto",
          size === "lg" ? "max-w-2xl" : "max-w-md"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handle}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-medium">
            <h3 className="font-headline font-bold text-primary">{title}</h3>
            <button type="button" onClick={onClose} aria-label="Fechar" className="text-secondary hover:text-primary">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            {children}
            {err && <p className="text-danger text-sm bg-danger/10 rounded-md px-3 py-2">{err}</p>}
          </div>
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-medium">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-secondary hover:text-primary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className={clsx(
                "px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60",
                submitTone === "danger" ? "bg-danger" : "bg-primary"
              )}
            >
              {saving ? "Salvando…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export const fieldLabel = "block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5";
export const fieldInput =
  "w-full bg-surface-low border border-surface-medium text-primary rounded-lg px-3 py-2 text-sm";
