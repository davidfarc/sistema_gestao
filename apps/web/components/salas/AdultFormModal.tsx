"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import clsx from "clsx";
import Modal, { fieldInput, fieldLabel } from "./Modal";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import { DAYS, sameId, sortRooms } from "@/lib/salas/logic";
import type { Adult, Assignment, Day, Room, StaffType, Vila } from "@/lib/salas/types";

const DAY_SHORT: Record<Day, string> = {
  segunda: "S",
  terca: "T",
  quarta: "Q",
  quinta: "Q",
  sexta: "S",
};

// Alocação em edição no form (roomId sempre string aqui — no submit vira `roomId` do RTDB).
interface Draft {
  roomId: string;
  start: string;
  end: string;
  days: Set<Day>;
}

const PATIO_ID = "0"; // Convenção do app legado: roomId "0" = Sem sala (pátio)

function normalize(asn: Assignment | undefined): Draft {
  return {
    roomId: String(asn?.roomId ?? PATIO_ID),
    start: asn?.start ?? "07:00",
    end: asn?.end ?? "13:00",
    days: new Set<Day>((asn?.days ?? DAYS) as Day[]),
  };
}

const defaultDraft = (): Draft => ({
  roomId: PATIO_ID,
  start: "13:00",
  end: "18:00",
  days: new Set<Day>(DAYS),
});

function AssignmentRow({
  draft,
  rooms,
  onChange,
  onRemove,
}: {
  draft: Draft;
  rooms: Room[];
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const toggleDay = (d: Day) => {
    const next = new Set(draft.days);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange({ days: next });
  };
  return (
    <div className="bg-surface-low rounded-lg p-3 flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-[180px]">
        <label className="block text-[10px] font-bold text-secondary uppercase mb-1">Sala</label>
        <select
          value={draft.roomId}
          onChange={(e) => onChange({ roomId: e.target.value })}
          className={fieldInput}
        >
          <option value={PATIO_ID}>Sem sala (Pátio)</option>
          {rooms.map((r) => (
            <option key={String(r.id)} value={String(r.id)}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="w-24">
        <label className="block text-[10px] font-bold text-secondary uppercase mb-1">Início</label>
        <input
          type="time"
          value={draft.start}
          onChange={(e) => onChange({ start: e.target.value })}
          className={fieldInput}
        />
      </div>
      <div className="w-24">
        <label className="block text-[10px] font-bold text-secondary uppercase mb-1">Fim</label>
        <input
          type="time"
          value={draft.end}
          onChange={(e) => onChange({ end: e.target.value })}
          className={fieldInput}
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold text-secondary uppercase mb-1">Dias</label>
        <div className="flex gap-1">
          {DAYS.map((d) => (
            <button
              type="button"
              key={d}
              onClick={() => toggleDay(d)}
              title={d}
              className={clsx(
                "w-7 h-7 rounded-md text-[11px] font-bold border transition-colors",
                draft.days.has(d)
                  ? "bg-primary text-white border-primary"
                  : "bg-surface-lowest text-secondary border-surface-medium hover:border-primary"
              )}
            >
              {DAY_SHORT[d]}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        title="Remover alocação"
        className="w-8 h-8 rounded-md text-secondary hover:text-danger hover:bg-danger/10 inline-flex items-center justify-center self-end"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function AdultFormModal({
  open,
  adult,
  adults,
  rooms,
  staffTypes,
  onClose,
}: {
  open: boolean;
  adult: Adult | null;
  adults: Adult[];
  rooms: Room[];
  staffTypes: StaffType[];
  onClose: () => void;
}) {
  const write = useSalasWrite();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [segmento, setSegmento] = useState<Vila>("vila1");
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const sorted = sortRooms(rooms);

  useEffect(() => {
    if (!open) return;
    setId(adult ? String(adult.id) : "");
    setName(adult?.name ?? "");
    setType(adult?.type ?? staffTypes[0]?.id ?? "");
    const seg = (adult?.segmento as string) ?? "vila1";
    setSegmento(seg === "vila2" || seg === "patio_vila2" ? "vila2" : "vila1");
    const list = adult?.assignments ?? [];
    setDrafts(list.length > 0 ? list.map(normalize) : [normalize(undefined)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, adult]);

  const patchDraft = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const removeDraft = (i: number) => setDrafts((prev) => prev.filter((_, idx) => idx !== i));
  const addDraft = () => setDrafts((prev) => [...prev, defaultDraft()]);

  const submit = async () => {
    const nm = name.trim();
    if (!nm) throw new Error("O nome é obrigatório.");
    const finalId = id.trim() || Date.now().toString();
    const dup = adults.some((a) => sameId(a.id, finalId) && !sameId(a.id, adult?.id ?? ""));
    if (dup) throw new Error(`Já existe um colaborador com o ID "${finalId}".`);

    const assignments: Assignment[] = drafts.map((d) => ({
      roomId: d.roomId,
      start: d.start,
      end: d.end,
      days: Array.from(d.days),
    }));

    const payload: Adult = {
      ...(adult ?? {}),
      id: finalId,
      name: nm,
      type,
      segmento,
      assignments,
    };

    const next = adult
      ? adults.map((a) => (sameId(a.id, adult.id) ? payload : a))
      : [...adults, payload];

    await write("adults", next);
  };

  return (
    <Modal
      open={open}
      title={adult ? "Editar Colaborador" : "Cadastrar Colaborador"}
      onClose={onClose}
      onSubmit={submit}
      size="lg"
    >
      <div className="grid grid-cols-[90px_1fr] gap-3">
        <div>
          <label className={fieldLabel}>ID</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!adult}
            placeholder="auto"
            className={clsx(fieldInput, !!adult && "opacity-60")}
          />
        </div>
        <div>
          <label className={fieldLabel}>Nome</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={fieldInput} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabel}>Cargo</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={fieldInput}>
            {staffTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={fieldLabel}>Vila</label>
          <select value={segmento} onChange={(e) => setSegmento(e.target.value as Vila)} className={fieldInput}>
            <option value="vila1">Vila 1</option>
            <option value="vila2">Vila 2</option>
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={fieldLabel}>Alocações (sala + horário + dias)</label>
          <button
            type="button"
            onClick={addDraft}
            className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:text-primary-high"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Adicionar período
          </button>
        </div>
        <div className="space-y-2">
          {drafts.map((d, i) => (
            <AssignmentRow
              key={i}
              draft={d}
              rooms={sorted}
              onChange={(patch) => patchDraft(i, patch)}
              onRemove={() => removeDraft(i)}
            />
          ))}
          {drafts.length === 0 && (
            <p className="text-xs text-secondary italic">
              Nenhum período. Adicione ao menos um para que a equipe apareça nas salas.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
