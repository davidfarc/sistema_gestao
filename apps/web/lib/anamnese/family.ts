import type { AppointmentStatus } from "@prisma/client";
import type { Tx } from "./db";

// Cadastro de famílias: o e-mail de quem agenda é a chave da jornada do cliente
// (agendamento → anamnese → cadastro completo → matrícula). Cada agendamento
// cria ou reaproveita a família pelo e-mail e vincula responsável e aluno pelo
// nome, dentro da família. Os campos do Appointment continuam como retrato do
// que foi informado no agendamento.

/** Nome sem espaços nas pontas nem repetidos (a comparação ignora maiúsculas). */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export type FamilyLinkInput = {
  email: string;
  guardianName: string;
  phone: string;
  studentName: string;
  studentClass?: string | null;
};

export type FamilyLink = { familyId: string; guardianId: string; studentId: string };

/** Cria ou reaproveita família, responsável e aluno. Roda dentro da transação do agendamento. */
export async function linkFamily(tx: Tx, input: FamilyLinkInput): Promise<FamilyLink> {
  const email = input.email.trim().toLowerCase();
  const guardianName = normalizeName(input.guardianName);
  const studentName = normalizeName(input.studentName);

  // upsert por campo único vira INSERT … ON CONFLICT no Postgres: dois
  // agendamentos simultâneos do mesmo e-mail não criam duas famílias.
  const family = await tx.family.upsert({
    where: { email },
    create: { email },
    update: { updatedAt: new Date() },
    select: { id: true },
  });

  const guardian =
    (await tx.guardian.findFirst({
      where: { familyId: family.id, name: { equals: guardianName, mode: "insensitive" } },
      select: { id: true, phone: true },
    })) ??
    (await tx.guardian.create({
      data: {
        familyId: family.id,
        name: guardianName,
        phone: input.phone,
        isPrimary: (await tx.guardian.count({ where: { familyId: family.id } })) === 0,
      },
      select: { id: true, phone: true },
    }));
  if (guardian.phone !== input.phone) {
    await tx.guardian.update({ where: { id: guardian.id }, data: { phone: input.phone } });
  }

  const student =
    (await tx.student.findFirst({
      where: { familyId: family.id, name: { equals: studentName, mode: "insensitive" } },
      select: { id: true, studentClass: true },
    })) ??
    (await tx.student.create({
      data: { familyId: family.id, name: studentName, studentClass: input.studentClass || null },
      select: { id: true, studentClass: true },
    }));
  if (input.studentClass && student.studentClass !== input.studentClass) {
    await tx.student.update({ where: { id: student.id }, data: { studentClass: input.studentClass } });
  }

  return { familyId: family.id, guardianId: guardian.id, studentId: student.id };
}

/**
 * Remove o que ficou sem uso depois de uma edição (ex.: e-mail digitado errado e
 * corrigido pela equipe): responsáveis e alunos sem agendamento e sem vínculo
 * com o Activesoft, e a família, se não sobrar nada.
 */
export async function pruneFamily(tx: Tx, familyId: string): Promise<void> {
  await tx.guardian.deleteMany({ where: { familyId, activesoftId: null, appointments: { none: {} } } });
  await tx.student.deleteMany({ where: { familyId, activesoftId: null, enrolledAt: null, appointments: { none: {} } } });
  const left = await tx.family.findUnique({
    where: { id: familyId },
    select: { _count: { select: { appointments: true, guardians: true, students: true } } },
  });
  if (left && left._count.appointments === 0 && left._count.students === 0) {
    await tx.family.delete({ where: { id: familyId } });
  } else if (left && left._count.guardians > 0) {
    await ensurePrimary(tx, familyId);
  }
}

/** Garante exatamente um responsável principal (o mais antigo, se o principal saiu). */
export async function ensurePrimary(tx: Tx, familyId: string): Promise<void> {
  const primary = await tx.guardian.count({ where: { familyId, isPrimary: true } });
  if (primary > 0) return;
  const first = await tx.guardian.findFirst({ where: { familyId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (first) await tx.guardian.update({ where: { id: first.id }, data: { isPrimary: true } });
}

// ─── Etapa da jornada ────────────────────────────────────────────────────────

export type FamilyStage = "MATRICULADA" | "ANAMNESE_REALIZADA" | "AGENDADA" | "SEM_AGENDAMENTO";

export const STAGE_LABEL: Record<FamilyStage, string> = {
  MATRICULADA: "Matriculada",
  ANAMNESE_REALIZADA: "Anamnese realizada",
  AGENDADA: "Anamnese agendada",
  SEM_AGENDAMENTO: "Sem agendamento ativo",
};

/** Etapa calculada a partir dos alunos e agendamentos (nada a manter em sincronia). */
export function familyStage(
  students: { enrolledAt: Date | null }[],
  appointments: { status: AppointmentStatus }[],
): FamilyStage {
  if (students.some((s) => s.enrolledAt)) return "MATRICULADA";
  if (appointments.some((a) => a.status === "COMPLETED")) return "ANAMNESE_REALIZADA";
  // Confirmado e ainda não marcado como realizado (mesmo que a data já tenha passado).
  if (appointments.some((a) => a.status === "CONFIRMED")) return "AGENDADA";
  return "SEM_AGENDAMENTO";
}
