"use server";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";

export interface GuardianView {
  slot: number;
  name: string;
  relation: string;
  phone: string;
}

/** Responsáveis de um aluno (migration 0063), para a ficha na Gestão de Vila. */
export async function loadStudentGuardians(studentId: string): Promise<GuardianView[]> {
  const actor = await requireActor("salas:manage");
  if (!/^[0-9A-Za-z_-]{1,40}$/.test(studentId)) return [];
  const { data, error } = await createAdminClient()
    .from("student_guardian" as never)
    .select("slot, name, relation, phone")
    .eq("organization_id", actor.organizationId as string)
    .eq("student_key", studentId)
    .order("slot");
  if (error) return [];
  return ((data ?? []) as unknown as GuardianView[]).filter((g) => g.name);
}
