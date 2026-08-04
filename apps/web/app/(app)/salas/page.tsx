"use client";

import { useState } from "react";
import { RefreshCw, AlertCircle, Footprints, User, UserX, Plus } from "lucide-react";
import clsx from "clsx";
import { useSalasControls } from "@/lib/salas/SalasContext";
import { useSalasData } from "@/lib/salas/SalasContext";
import {
  adultInVila,
  isAdultAbsentToday,
  isAdultInRoom,
  isAdultPresent,
  isStudentPresent,
  roomInVila,
  sameId,
  sortRooms,
  translateType,
} from "@/lib/salas/logic";
import { useSalasWrite } from "@/lib/salas/SalasContext";
import SalasHeader from "@/components/salas/SalasHeader";
import RoomCard from "@/components/salas/RoomCard";
import RoomFormModal from "@/components/salas/RoomFormModal";
import RoutineSummary from "@/components/salas/RoutineSummary";
import type { Room } from "@/lib/salas/types";

export default function SalasPage() {
  const { vila, day, shift } = useSalasControls();
  const { data, loading, error } = useSalasData();
  const write = useSalasWrite();
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-secondary py-24">
        <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
        <span>Carregando dados da escola…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto mt-24 bg-danger/5 border border-danger/20 rounded-2xl p-6 text-center">
        <AlertCircle className="w-6 h-6 text-danger mx-auto mb-2" aria-hidden="true" />
        <p className="text-danger font-semibold">Não foi possível carregar os dados</p>
        <p className="text-secondary text-sm mt-1">{error ?? "Sem resposta do banco."}</p>
      </div>
    );
  }

  const { rooms, students, adults, staffTypes } = data;
  const allRooms = sortRooms(rooms);

  const openNewRoom = () => {
    setEditingRoom(null);
    setRoomModalOpen(true);
  };
  const openEditRoom = (room: Room) => {
    setEditingRoom(room);
    setRoomModalOpen(true);
  };
  const handleDeleteRoom = async (room: Room) => {
    if (students.some((s) => sameId(s.roomId, room.id))) {
      alert("Esta sala possui alunos matriculados e não pode ser excluída.");
      return;
    }
    if (adults.some((a) => (a.assignments ?? []).some((asn) => sameId(asn.roomId, room.id)))) {
      alert("Esta sala possui equipe alocada e não pode ser excluída.");
      return;
    }
    if (!confirm(`Excluir a sala "${room.name}"?`)) return;
    await write(
      "rooms",
      rooms.filter((r) => !sameId(r.id, room.id))
    );
  };

  const vilaRooms = allRooms.filter((r) => roomInVila(r, vila));
  const vilaRoomIds = new Set(vilaRooms.map((r) => String(r.id).trim()));
  const vilaStudents = students.filter((s) => vilaRoomIds.has(String(s.roomId ?? "").trim()));
  const vilaAdults = adults.filter((a) => adultInVila(a, vila));

  const activeStudents = vilaStudents.filter((s) => isStudentPresent(s, day, shift)).length;
  const onShift = vilaAdults.filter((a) => isAdultPresent(a, day, shift)).length;
  const ratio = onShift > 0 ? (activeStudents / onShift).toFixed(1) : activeStudents.toFixed(1);

  const patio = vilaAdults.filter(
    (a) => isAdultPresent(a, day, shift) && !allRooms.some((r) => isAdultInRoom(a, r.id, day, shift))
  );

  return (
    <div className="space-y-6">
      <SalasHeader
        stats={{ students: activeStudents, totalAdults: vilaAdults.length, onShift, ratio }}
      />

      <RoutineSummary
        vila={vila}
        vilaRooms={vilaRooms}
        students={students}
        dailyRoutine={data.dailyRoutine}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={openNewRoom}
          className="inline-flex items-center gap-1.5 bg-primary text-white px-3.5 py-2 rounded-lg text-sm font-bold hover:bg-primary-high transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Nova Sala
        </button>
      </div>

      <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {vilaRooms.map((room) => (
          <RoomCard
            key={String(room.id)}
            room={room}
            students={students}
            adults={adults}
            staffTypes={staffTypes}
            day={day}
            shift={shift}
            onEdit={openEditRoom}
            onDelete={handleDeleteRoom}
          />
        ))}

        {/* Pátio: equipe presente no turno e sem sala vinculada */}
        <div className="bg-surface-lowest border border-dashed border-surface-high rounded-2xl p-5 opacity-90">
          <div className="flex items-start justify-between gap-3 border-b border-surface-medium pb-3 mb-3">
            <div>
              <h3 className="text-lg font-headline font-bold text-primary flex items-center gap-1.5">
                <Footprints className="w-4 h-4 text-secondary" aria-hidden="true" /> Pátio
              </h3>
              <span className="text-xs text-secondary">Sem sala no turno</span>
            </div>
            <span className="px-2.5 py-1 rounded-xl text-xs font-bold bg-warning/10 text-warning">
              {patio.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {patio.length > 0 ? (
              patio.map((a) => {
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
                    <strong className="text-primary truncate">{a.name}</strong>
                    <span className="bg-primary/5 text-primary px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide">
                      {translateType(staffTypes, a.type)}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-secondary italic mt-1">Nenhum disponível</p>
            )}
          </div>
        </div>
      </div>

      <RoomFormModal
        open={roomModalOpen}
        room={editingRoom}
        rooms={rooms}
        defaultVila={vila}
        onClose={() => setRoomModalOpen(false)}
      />
    </div>
  );
}
