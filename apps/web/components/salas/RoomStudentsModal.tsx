"use client";

import Modal from "@/components/salas/Modal";
import { sameId } from "@/lib/salas/logic";
import type { Day, Room, Student } from "@/lib/salas/types";

// "Ver Alunos" da turma — portado do v2.7 (viewRoomDetails): todos os alunos
// matriculados na sala, com Manhã / Tarde / Almoço para o dia selecionado.
// Só leitura.

export default function RoomStudentsModal({
  room,
  students,
  day,
  onClose,
}: {
  room: Room | null;
  students: Student[];
  day: Day;
  onClose: () => void;
}) {
  if (!room) return null;

  const all = students
    .filter((s) => sameId(s.roomId, room.id))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR"));
  // Quem conta na turma; os que saíram aparecem riscados no fim, fora dos números.
  const list = all.filter((s) => !s.left);
  const gone = all.filter((s) => s.left);

  const rows = list.map((s) => ({
    s,
    manha: (s.schedule?.morning ?? []).includes(day),
    tarde: (s.schedule?.afternoon ?? []).includes(day),
    almoco: (s.lunchDays ?? []).includes(day),
  }));
  const total = (k: "manha" | "tarde" | "almoco") => rows.filter((r) => r[k]).length;
  const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);

  return (
    <Modal
      open
      title={`Alunos: ${room.name}`}
      onClose={onClose}
      onSubmit={() => undefined}
      submitLabel="Fechar"
      hideCancel
      size="lg"
    >
      <p className="text-sm text-secondary">
        {list.length} alunos{gone.length > 0 ? ` (${gone.length} fora da turma, não contados)` : ""} · Exibindo horários para <strong className="text-primary">{dayLabel}</strong>
      </p>
      {list.length > 0 && (
        <p className="text-sm text-secondary">
          ☀️ Manhã: <strong className="text-primary">{total("manha")}</strong> · 🌤️ Tarde:{" "}
          <strong className="text-primary">{total("tarde")}</strong> · 🍴 Almoçam:{" "}
          <strong className="text-primary">{total("almoco")}</strong> · Não almoçam:{" "}
          <strong className="text-primary">{list.length - total("almoco")}</strong>
        </p>
      )}
      <div className="max-h-[400px] overflow-y-auto border border-surface-medium rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-surface-low sticky top-0">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">Nome do Aluno</th>
              <th className="text-center font-semibold px-3 py-2.5">Manhã</th>
              <th className="text-center font-semibold px-3 py-2.5">Tarde</th>
              <th className="text-center font-semibold px-3 py-2.5">Almoço</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map(({ s, manha, tarde, almoco }) => (
                <tr key={String(s.id)} className="border-t border-surface-medium">
                  <td className="px-4 py-2 font-semibold text-primary">{s.name}</td>
                  <td className="px-3 py-2 text-center">{manha ? "☀️" : "-"}</td>
                  <td className="px-3 py-2 text-center">{tarde ? "🌤️" : "-"}</td>
                  <td className="px-3 py-2 text-center">{almoco ? "🍴" : "-"}</td>
                </tr>
              ))
            ) : gone.length > 0 ? null : (
              <tr>
                <td colSpan={4} className="text-center text-secondary px-4 py-8">
                  Nenhum aluno matriculado nesta sala.
                </td>
              </tr>
            )}
            {gone.map((s) => (
              <tr key={String(s.id)} className="border-t border-surface-medium opacity-60">
                <td className="px-4 py-2 text-secondary">
                  <span className="line-through">{s.name}</span>
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-danger">Fora da turma</span>
                </td>
                <td colSpan={3} className="px-3 py-2 text-center text-xs text-secondary">
                  não conta
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
