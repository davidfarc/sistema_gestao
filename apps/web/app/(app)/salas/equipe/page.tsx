"use client";

import { useMemo, useState } from "react";
import { RefreshCw, AlertCircle, Search, CalendarClock, CalendarX, CalendarCheck, Trash2, Plus, Pencil, Tags, Upload } from "lucide-react";
import clsx from "clsx";
import { useSalasData } from "@/lib/salas/SalasContext";
import { isAdultAbsentToday, sameId, todayISO, translateType } from "@/lib/salas/logic";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import Modal, { fieldInput, fieldLabel } from "@/components/salas/Modal";
import AdultFormModal from "@/components/salas/AdultFormModal";
import StaffTypesModal from "@/components/salas/StaffTypesModal";
import { ImportAdultsModal } from "@/components/salas/ImportModal";
import type { Absence, Adult, Vila } from "@/lib/salas/types";

export default function EquipePage() {
  const { data, loading, error } = useSalasData();
  const write = useSalasWrite();
  const [name, setName] = useState("");
  const [vila, setVila] = useState<"" | Vila>("");
  const [type, setType] = useState("");
  const [absenceAdult, setAbsenceAdult] = useState<Adult | null>(null);
  const [reason, setReason] = useState("Atestado");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Adult | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (a: Adult) => {
    setEditing(a);
    setFormOpen(true);
  };

  const types = data?.staffTypes ?? [];

  const writeAbsences = async (adult: Adult, absences: Absence[]) => {
    const idx = (data?.adults ?? []).findIndex((a) => sameId(a.id, adult.id));
    if (idx < 0) return;
    await write(`adults/${idx}/absences`, absences);
  };

  const toggleAbsence = async (a: Adult) => {
    const today = todayISO();
    if (isAdultAbsentToday(a, today)) {
      if (!confirm(`Remover a falta de ${a.name} registrada hoje?`)) return;
      await writeAbsences(a, (a.absences ?? []).filter((abs) => abs.date !== today));
    } else {
      setReason("Atestado");
      setAbsenceAdult(a);
    }
  };

  const confirmAbsence = async () => {
    if (!absenceAdult) return;
    const today = todayISO();
    const next = [
      ...(absenceAdult.absences ?? []).filter((abs) => abs.date !== today),
      { date: today, reason: reason.trim() || "Não informado" },
    ];
    await writeAbsences(absenceAdult, next);
  };

  const removeAdult = async (a: Adult) => {
    if (!confirm(`Excluir ${a.name} da equipe?`)) return;
    await write(
      "adults",
      (data?.adults ?? []).filter((x) => !sameId(x.id, a.id))
    );
  };

  const filtered = useMemo(() => {
    const adults = data?.adults ?? [];
    return adults.filter((a) => {
      const matchName =
        !name || a.name.toLowerCase().includes(name.toLowerCase()) || String(a.id).includes(name);
      const matchType = !type || a.type === type;
      const matchVila = !vila || a.segmento === vila;
      return matchName && matchType && matchVila;
    });
  }, [data?.adults, name, type, vila]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-secondary py-24">
        <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span>Carregando equipe…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto mt-24 bg-danger/5 border border-danger/20 rounded-2xl p-6 text-center">
        <AlertCircle className="w-6 h-6 text-danger mx-auto mb-2" aria-hidden="true" />
        <p className="text-danger font-semibold">Não foi possível carregar a equipe</p>
        <p className="text-secondary text-sm mt-1">{error ?? "Sem resposta do banco."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">
            Filtrar colaborador
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" aria-hidden="true" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome ou ID…"
              className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="w-40">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">Vila</label>
          <select
            value={vila}
            onChange={(e) => setVila(e.target.value as "" | Vila)}
            className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            <option value="vila1">Vila 1</option>
            <option value="vila2">Vila 2</option>
          </select>
        </div>
        <div className="w-48">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">Cargo</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="bg-surface-medium text-secondary px-4 py-2 rounded-lg text-sm font-bold">
          Encontrados: {filtered.length}
        </div>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-1.5 bg-surface-lowest border border-surface-medium text-secondary hover:text-primary px-3.5 py-2 rounded-lg text-sm font-semibold"
        >
          <Upload className="w-4 h-4" aria-hidden="true" /> Importar
        </button>
        <button
          type="button"
          onClick={() => setTypesOpen(true)}
          className="inline-flex items-center gap-1.5 bg-surface-lowest border border-surface-medium text-secondary hover:text-primary px-3.5 py-2 rounded-lg text-sm font-semibold"
        >
          <Tags className="w-4 h-4" aria-hidden="true" /> Cargos
        </button>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1.5 bg-primary text-white px-3.5 py-2 rounded-lg text-sm font-bold hover:bg-primary-high transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Novo Colaborador
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-secondary italic">
          Nenhum colaborador encontrado com estes filtros.
        </div>
      ) : (
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
          {filtered.map((a) => {
            const absent = isAdultAbsentToday(a);
            const reasonToday = absent
              ? (a.absences ?? []).find((abs) => abs.date === todayISO())?.reason
              : null;
            return (
              <div
                key={String(a.id)}
                className={clsx(
                  "bg-surface-lowest border border-black/5 border-l-4 rounded-2xl p-5 shadow-premium-soft",
                  absent ? "border-l-danger bg-danger/5" : "border-l-primary"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-headline font-bold text-primary truncate">{a.name}</div>
                    <div className="text-sm text-secondary">
                      {translateType(types, a.type)} · ID {String(a.id)}
                    </div>
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 px-2 py-0.5 rounded-md text-[11px] font-bold",
                      a.segmento === "vila2" ? "bg-info/10 text-info" : "bg-success/10 text-success"
                    )}
                  >
                    {a.segmento === "vila2" ? "Vila 2" : "Vila 1"}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-1.5 text-sm text-secondary">
                  <CalendarClock className="w-4 h-4" aria-hidden="true" />
                  {(a.assignments ?? []).length} período(s) de alocação
                </div>

                {absent && (
                  <div className="mt-3 bg-danger/10 text-danger rounded-md px-3 py-2 text-xs font-bold">
                    AUSENTE HOJE · Motivo: {reasonToday || "Não informado"}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => toggleAbsence(a)}
                    className={clsx(
                      "inline-flex items-center gap-1.5 text-xs font-semibold",
                      absent ? "text-success hover:opacity-80" : "text-secondary hover:text-danger"
                    )}
                  >
                    {absent ? (
                      <>
                        <CalendarCheck className="w-3.5 h-3.5" aria-hidden="true" /> Remover falta de hoje
                      </>
                    ) : (
                      <>
                        <CalendarX className="w-3.5 h-3.5" aria-hidden="true" /> Marcar falta hoje
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(a)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:text-primary"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAdult(a)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-secondary/70 hover:text-danger"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Excluir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!absenceAdult}
        title={`Marcar falta — ${absenceAdult?.name ?? ""}`}
        onClose={() => setAbsenceAdult(null)}
        onSubmit={confirmAbsence}
        submitLabel="Registrar falta"
      >
        <div>
          <label className={fieldLabel}>Motivo da falta (hoje)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus className={fieldInput} />
        </div>
      </Modal>

      <AdultFormModal
        open={formOpen}
        adult={editing}
        adults={data.adults}
        rooms={data.rooms}
        staffTypes={types}
        onClose={() => setFormOpen(false)}
      />

      <StaffTypesModal
        open={typesOpen}
        staffTypes={types}
        adults={data.adults}
        onClose={() => setTypesOpen(false)}
      />

      <ImportAdultsModal
        open={importOpen}
        adults={data.adults}
        staffTypes={types}
        onClose={() => setImportOpen(false)}
      />
    </div>
  );
}
