"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import Modal, { fieldInput, fieldLabel } from "./Modal";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import type { Adult, StaffType } from "@/lib/salas/types";

// Gerenciador de tipos de cargo (staffTypes). IDs curtos, kebab-case.
// Bloqueia exclusão de tipo em uso por algum colaborador.
export default function StaffTypesModal({
  open,
  staffTypes,
  adults,
  onClose,
}: {
  open: boolean;
  staffTypes: StaffType[];
  adults: Adult[];
  onClose: () => void;
}) {
  const write = useSalasWrite();
  const [items, setItems] = useState<StaffType[]>([]);

  useEffect(() => {
    if (open) setItems(staffTypes.map((t) => ({ ...t })));
  }, [open, staffTypes]);

  const patch = (i: number, p: Partial<StaffType>) =>
    setItems((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...p } : t)));

  const remove = (i: number) => {
    const t = items[i];
    if (!t) return;
    if (adults.some((a) => a.type === t.id)) {
      alert(`Não é possível excluir "${t.label || t.id}": existe colaborador com esse cargo.`);
      return;
    }
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  };

  const add = () =>
    setItems((prev) => [
      ...prev,
      { id: `t-${Date.now()}`, label: "", short: "" },
    ]);

  const submit = async () => {
    const cleaned = items.filter((t) => t.label.trim());
    for (const t of cleaned) {
      if (!t.id.trim()) throw new Error(`ID vazio em "${t.label}".`);
    }
    const ids = new Set<string>();
    for (const t of cleaned) {
      if (ids.has(t.id)) throw new Error(`ID duplicado: "${t.id}".`);
      ids.add(t.id);
    }
    await write("staffTypes", cleaned);
  };

  return (
    <Modal open={open} title="Gerenciar Tipos de Cargo" onClose={onClose} onSubmit={submit} size="lg">
      <div className="grid grid-cols-[1fr_1fr_40px] gap-2 text-[10px] font-bold text-secondary uppercase">
        <span>Nome</span>
        <span>Sigla</span>
        <span></span>
      </div>
      <div className="space-y-2">
        {items.map((t, i) => (
          <div key={t.id} className="grid grid-cols-[1fr_1fr_40px] gap-2 items-center">
            <input
              value={t.label}
              onChange={(e) => patch(i, { label: e.target.value })}
              placeholder="Nome completo"
              className={fieldInput}
            />
            <input
              value={t.short ?? ""}
              onChange={(e) => patch(i, { short: e.target.value })}
              placeholder="Sigla"
              className={fieldInput}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remover"
              className="w-8 h-8 rounded-md text-secondary hover:text-danger hover:bg-danger/10 inline-flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-secondary italic">Nenhum tipo cadastrado.</p>
        )}
      </div>
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:text-primary-high"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Novo tipo
      </button>
      <p className={fieldLabel}>Dica: use IDs estáveis (ex.: <code>professor</code>, <code>assistente</code>) — colaboradores existentes ficam ligados por ID.</p>
    </Modal>
  );
}
