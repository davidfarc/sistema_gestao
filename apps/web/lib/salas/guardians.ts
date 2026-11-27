import "server-only";

import { isLeftStatus, loadSigaGuardians, type SigaStudent } from "@/lib/salas/activesoftApi";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Atualiza o cadastro de responsáveis (migration 0063) a partir do ActiveSoft,
 * para os alunos atuais. Quem saiu da escola sai do cadastro. Devolve quantos
 * responsáveis ficaram e quantos alunos não têm nenhum celular.
 */
export async function importGuardians(
  base: string,
  token: string,
  organizationId: string,
  students: SigaStudent[],
): Promise<{ guardians: number; studentsWithoutPhone: number }> {
  const current = students.filter((s) => !isLeftStatus(s.status));
  const byId = new Map(current.map((s) => [s.id, s]));
  const guardians = await loadSigaGuardians(base, token, new Set(byId.keys()));
  const startedAt = new Date().toISOString();
  const rows = guardians.map((g) => ({
    organization_id: organizationId,
    student_key: g.studentId,
    student_name: byId.get(g.studentId)?.name ?? "",
    room: byId.get(g.studentId)?.roomName ?? "",
    slot: g.slot,
    name: g.name,
    relation: g.relation,
    phone: g.phone,
    email: g.email,
    updated_at: startedAt,
  }));
  const db = createAdminClient();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from("student_guardian" as never)
      .upsert(rows.slice(i, i + 500) as never, { onConflict: "organization_id,student_key,slot" });
    if (error) throw new Error(error.message.includes("student_guardian") ? "Falta aplicar a migration 0063." : error.message);
  }
  // O que não veio nesta importação (aluno que saiu, responsável removido) sai.
  await db
    .from("student_guardian" as never)
    .delete()
    .eq("organization_id", organizationId)
    .lt("updated_at", startedAt);

  const withPhone = new Set(guardians.filter((g) => g.phone).map((g) => g.studentId));
  return { guardians: rows.length, studentsWithoutPhone: current.filter((s) => !withPhone.has(s.id)).length };
}
