"use client";

import clsx from "clsx";
import { User, UserX, Pencil, Trash2 } from "lucide-react";
import {
  isAdultAbsentToday,
  isAdultInRoom,
  isStudentPresent,
  ratioBadge,
  sameId,
  translateType,
} from "@/lib/salas/logic";
import type { Adult, Day, Room, Shift, StaffType, Student } from "@/lib/salas/types";

const badgeClasses: Record<"success" | "warning" | "danger", string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

export default function RoomCard({
  room,
  students,
  adults,
  staffTypes,
  day,
  shift,
  onEdit,
  onDelete,
}: {
  room: Room;
  students: Student[];
  adults: Adult[];
  staffTypes: StaffType[];
  day: Day;
  shift: Shift;
  onEdit?: (room: Room) => void;
  onDelete?: (room: Room) => void;
}) {
  const roomStudents = students.filter(
    (s) => sameId(s.roomId, room.id) && isStudentPresent(s, day, shift)
  );
  const roomAdults = adults.filter((a) => isAdultInRoom(a, room.id, day, shift));
  const ratio = roomAdults.length > 0 ? roomStudents.length / roomAdults.length : roomStudents.length;
  const tone = ratioBadge(ratio);

  return (
    <div className="bg-surface-lowest border border-black/5 rounded-2xl p-5 shadow-premium-soft transition-shadow hover:shadow-premium-hover">
      <div className="flex items-start justify-between gap-3 border-b border-surface-medium pb-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-lg font-headline font-bold text-primary flex items-center gap-1.5 truncate">
            {onEdit ? (
              <button
                type="button"
                onClick={() => onEdit(room)}
                title="Editar sala"
                className="flex items-center gap-1.5 truncate hover:text-primary-high"
              >
                <span className="truncate">{room.name}</span>
                <Pencil className="w-3.5 h-3.5 text-secondary/50 shrink-0" aria-hidden="true" />
              </button>
            ) : (
              room.name
            )}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-secondary">{roomStudents.length} alunos</span>
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(room)}
                title="Excluir sala"
                className="text-secondary/70 hover:text-danger inline-flex items-center gap-1 text-[11px]"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" /> Excluir
              </button>
            )}
          </div>
        </div>
        <span className={clsx("px-2.5 py-1 rounded-xl text-xs font-bold shrink-0", badgeClasses[tone])}>
          {ratio.toFixed(1)}:1
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {roomAdults.length > 0 ? (
          roomAdults.map((a) => {
            const asn = (a.assignments || []).find((x) => sameId(x.roomId, room.id));
            const absent = isAdultAbsentToday(a);
            return (
              <div
                key={String(a.id)}
                className={clsx("flex items-center gap-2.5 text-sm", absent && "opacity-60")}
              >
                {absent ? (
                  <UserX className="w-4 h-4 text-danger shrink-0" aria-hidden="true" />
                ) : (
                  <User className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                )}
                <div className="flex flex-col gap-0.5 min-w-0">
                  <strong className="text-primary truncate">
                    {a.name}
                    {absent && <span className="font-normal text-danger"> (Ausente)</span>}
                  </strong>
                  <div className="flex items-center gap-2">
                    <span className="bg-primary/5 text-primary px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide">
                      {translateType(staffTypes, a.type)}
                    </span>
                    <span className="text-[11px] text-secondary">
                      {asn?.start ?? "00:00"} - {asn?.end ?? "00:00"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-secondary italic mt-1">Sem cobertura no turno</p>
        )}
      </div>
    </div>
  );
}
