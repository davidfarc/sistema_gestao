"use client";

import { useMemo, useState } from "react";
import { RefreshCw, AlertCircle, Search, Plus, Pencil, Trash2, Upload, RefreshCcw } from "lucide-react";
import { useSalasData } from "@/lib/salas/SalasContext";
import { sameId } from "@/lib/salas/logic";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import StudentFormModal from "@/components/salas/StudentFormModal";
import { ImportStudentsModal } from "@/components/salas/ImportModal";
import { applyActivesoftSync, type ActivesoftStudent } from "@/lib/salas/activesoft";
import type { Room, Student, Vila } from "@/lib/salas/types";

function studentVila(room: Room | undefined): Vila {
  return room?.segmento === "vila2" ? "vila2" : "vila1";
}

function periodo(s: Student): string {
  const m = (s.schedule?.morning ?? []).length > 0 ? "M" : "";
  const t = (s.schedule?.afternoon ?? []).length > 0 ? "T" : "";
  return m + t || "-";
}

export default function AlunosPage() {
  const { data, loading, error } = useSalasData();
  const write = useSalasWrite();
  const [name, setName] = useState("");
  const [vila, setVila] = useState<"" | Vila>("");
  const [turma, setTurma] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const rooms = data?.rooms ?? [];
  const roomOf = useMemo(() => {
    const map = new Map<string, Room>();
    for (const r of rooms) map.set(String(r.id).trim(), r);
    return (roomId: Student["roomId"]) => map.get(String(roomId ?? "").trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms]);

  const filtered = useMemo(() => {
    const students = data?.students ?? [];
    return students.filter((s) => {
      const room = roomOf(s.roomId);
      const matchName =
        !name ||
        s.name.toLowerCase().includes(name.toLowerCase()) ||
        String(s.id).includes(name);
      const matchTurma = !turma || (!!room && (room.name || "").toLowerCase().includes(turma.toLowerCase()));
      const matchVila = !vila || studentVila(room) === vila;
      return matchName && matchTurma && matchVila;
    });
  }, [data?.students, name, turma, vila, roomOf]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-secondary py-24">
        <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span>Carregando alunos…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto mt-24 bg-danger/5 border border-danger/20 rounded-2xl p-6 text-center">
        <AlertCircle className="w-6 h-6 text-danger mx-auto mb-2" aria-hidden="true" />
        <p className="text-danger font-semibold">Não foi possível carregar os alunos</p>
        <p className="text-secondary text-sm mt-1">{error ?? "Sem resposta do banco."}</p>
      </div>
    );
  }

  const students = data.students;
  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (s: Student) => {
    setEditing(s);
    setModalOpen(true);
  };
  const handleDelete = async (s: Student) => {
    if (!confirm(`Excluir o aluno "${s.name}"?`)) return;
    await write(
      "students",
      students.filter((x) => !sameId(x.id, s.id))
    );
  };

  const syncActivesoft = async () => {
    if (!confirm("Buscar alunos do ActiveSoft e atualizar o cadastro?")) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/salas/activesoft/sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const incoming: ActivesoftStudent[] = body.students ?? [];
      if (incoming.length === 0) {
        alert("ActiveSoft respondeu, mas não veio nenhum aluno.");
        return;
      }
      const result = applyActivesoftSync(incoming, students, rooms);
      if (result.newRoomsCount > 0) await write("rooms", result.rooms);
      await write("students", result.students);
      alert(
        `Sincronização OK:\n- Novos alunos: ${result.countNew}\n- Atualizados: ${result.countUpdated}\n- Novas salas: ${result.newRoomsCount}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Erro na sincronização: ${msg}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">
            Buscar aluno (nome ou ID)
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" aria-hidden="true" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Maria Eduarda…"
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
          <label className="block text-xs font-bold text-secondary uppercase tracking-wide mb-1.5">Turma</label>
          <input
            value={turma}
            onChange={(e) => setTurma(e.target.value)}
            placeholder="Ex: Kids 1…"
            className="w-full bg-surface-lowest border border-surface-medium text-primary rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="bg-surface-medium text-secondary px-4 py-2 rounded-lg text-sm font-bold">
          Encontrados: {filtered.length}
        </div>
        <button
          type="button"
          onClick={syncActivesoft}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 bg-surface-lowest border border-surface-medium text-secondary hover:text-primary px-3.5 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          title="Sincronizar alunos com ActiveSoft (server-side)"
        >
          <RefreshCcw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
          {syncing ? "Sincronizando…" : "ActiveSoft"}
        </button>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-1.5 bg-surface-lowest border border-surface-medium text-secondary hover:text-primary px-3.5 py-2 rounded-lg text-sm font-semibold"
        >
          <Upload className="w-4 h-4" aria-hidden="true" /> Importar
        </button>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1.5 bg-primary text-white px-3.5 py-2 rounded-lg text-sm font-bold hover:bg-primary-high transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Novo Aluno
        </button>
      </div>

      <div className="bg-surface-lowest border border-black/5 rounded-2xl overflow-hidden shadow-premium-soft">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-low text-secondary text-xs uppercase tracking-wide">
                <th className="text-left font-semibold px-4 py-3">ID</th>
                <th className="text-left font-semibold px-4 py-3">Nome</th>
                <th className="text-left font-semibold px-4 py-3">Idade</th>
                <th className="text-left font-semibold px-4 py-3">Sala</th>
                <th className="text-left font-semibold px-4 py-3">Período</th>
                <th className="text-left font-semibold px-4 py-3">Almoço</th>
                <th className="text-right font-semibold px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const room = roomOf(s.roomId);
                const sala = sameId(s.roomId, 0) ? "Pátio" : room ? room.name : "N/A";
                return (
                  <tr key={String(s.id)} className="border-t border-surface-medium hover:bg-surface-low/60">
                    <td className="px-4 py-3">
                      <span className="bg-surface-medium text-secondary text-[11px] px-2 py-0.5 rounded-md">{String(s.id)}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-primary">{s.name}</td>
                    <td className="px-4 py-3 text-secondary">{s.age || 0} anos</td>
                    <td className="px-4 py-3 text-secondary">{sala}</td>
                    <td className="px-4 py-3 text-secondary">{periodo(s)}</td>
                    <td className="px-4 py-3 text-secondary">{(s.lunchDays ?? []).length > 0 ? "✓" : "-"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          title="Editar"
                          className="text-secondary hover:text-primary inline-flex items-center gap-1 text-xs font-semibold"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(s)}
                          title="Excluir"
                          className="text-secondary/70 hover:text-danger inline-flex items-center gap-1 text-xs font-semibold"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-secondary italic">
                    Nenhum aluno encontrado com estes filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <StudentFormModal
        open={modalOpen}
        student={editing}
        students={students}
        rooms={rooms}
        onClose={() => setModalOpen(false)}
      />

      <ImportStudentsModal
        open={importOpen}
        students={students}
        rooms={rooms}
        onClose={() => setImportOpen(false)}
      />
    </div>
  );
}
