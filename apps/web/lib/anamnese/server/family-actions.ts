"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/anamnese/db";
import { ActionError, requireUserForAction } from "@/lib/anamnese/auth";
import { audit } from "@/lib/anamnese/audit";
import { bool, run, str, type ActionState } from "@/lib/anamnese/action";
import { ensurePrimary, normalizeName } from "@/lib/anamnese/family";
import { emailSchema, idSchema, nameSchema, optionalClassSchema, phoneSchema } from "@/lib/anamnese/validation";

// Cadastro de famílias (aba "Famílias" de Novos alunos). Só a equipe
// (Administração e Atendimento/Coordenação) edita; psicólogas não veem a aba.
const STAFF = ["ADMIN", "COORDINATION"] as const;

const refresh = () => revalidatePath("/novos-alunos/familias");

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.string().trim().transform((v) => v || null).pipe(schema.nullable());

const guardianSchema = z.object({
  name: nameSchema("responsável").transform(normalizeName),
  phone: optional(phoneSchema),
  email: optional(emailSchema),
  relationship: optional(z.string().max(40, "Use no máximo 40 caracteres")),
});

async function loadFamily(fd: FormData) {
  const family = await prisma.family.findUnique({ where: { id: idSchema.parse(str(fd, "familyId")) }, select: { id: true, email: true } });
  if (!family) throw new ActionError("Família não encontrada.");
  return family;
}

/** Cria (sem guardianId) ou edita um responsável. */
export async function saveGuardianAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction([...STAFF]);
    const family = await loadFamily(fd);
    const d = guardianSchema.parse({
      name: str(fd, "name"), phone: str(fd, "phone"), email: str(fd, "email"), relationship: str(fd, "relationship"),
    });
    const guardianId = str(fd, "guardianId");
    const makePrimary = bool(fd, "isPrimary");

    const saved = await prisma.$transaction(async (tx) => {
      const dup = await tx.guardian.findFirst({
        where: { familyId: family.id, name: { equals: d.name, mode: "insensitive" }, ...(guardianId ? { NOT: { id: guardianId } } : {}) },
        select: { id: true },
      });
      if (dup) throw new ActionError("Já existe um responsável com esse nome nesta família.");

      if (makePrimary) await tx.guardian.updateMany({ where: { familyId: family.id }, data: { isPrimary: false } });
      const g = guardianId
        ? await tx.guardian.update({ where: { id: guardianId, familyId: family.id }, data: { ...d, ...(makePrimary ? { isPrimary: true } : {}) } })
        : await tx.guardian.create({ data: { familyId: family.id, ...d, isPrimary: makePrimary } });
      await ensurePrimary(tx, family.id);
      return g;
    });

    await audit({ userId: me.id, action: guardianId ? "GUARDIAN_UPDATED" : "GUARDIAN_CREATED", entityType: "Family", entityId: family.id, details: { guardianId: saved.id } });
    refresh();
    return { ok: true, message: guardianId ? "Responsável atualizado." : "Responsável adicionado à família." };
  });
}

/** Remove um responsável que não fez nenhum agendamento (os demais ficam como histórico). */
export async function deleteGuardianAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction([...STAFF]);
    const family = await loadFamily(fd);
    const guardianId = idSchema.parse(str(fd, "guardianId"));
    await prisma.$transaction(async (tx) => {
      const g = await tx.guardian.findFirst({
        where: { id: guardianId, familyId: family.id },
        select: { activesoftId: true, _count: { select: { appointments: true } } },
      });
      if (!g) throw new ActionError("Responsável não encontrado.");
      if (g._count.appointments > 0) throw new ActionError("Este responsável fez agendamentos e não pode ser removido.");
      if (g.activesoftId) throw new ActionError("Este responsável já está no Activesoft e não pode ser removido.");
      await tx.guardian.delete({ where: { id: guardianId } });
      await ensurePrimary(tx, family.id);
    });
    await audit({ userId: me.id, action: "GUARDIAN_DELETED", entityType: "Family", entityId: family.id, details: { guardianId } });
    refresh();
    return { ok: true, message: "Responsável removido." };
  });
}

const studentSchema = z.object({
  name: nameSchema("aluno").transform(normalizeName),
  studentClass: optionalClassSchema,
  birthDate: z
    .string()
    .trim()
    .transform((v) => v || null)
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida").nullable())
    .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null))
    .refine((d) => !d || (d < new Date() && d.getUTCFullYear() > 1990), "Data de nascimento inválida"),
});

export async function saveStudentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction([...STAFF]);
    const family = await loadFamily(fd);
    const studentId = idSchema.parse(str(fd, "studentId"));
    const d = studentSchema.parse({ name: str(fd, "name"), studentClass: str(fd, "studentClass"), birthDate: str(fd, "birthDate") });
    const dup = await prisma.student.findFirst({
      where: { familyId: family.id, name: { equals: d.name, mode: "insensitive" }, NOT: { id: studentId } },
      select: { id: true },
    });
    if (dup) throw new ActionError("Já existe um aluno com esse nome nesta família.");
    await prisma.student.update({ where: { id: studentId, familyId: family.id }, data: d });
    await audit({ userId: me.id, action: "STUDENT_UPDATED", entityType: "Family", entityId: family.id, details: { studentId } });
    refresh();
    return { ok: true, message: "Aluno atualizado." };
  });
}

export async function saveFamilyNotesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction([...STAFF]);
    const family = await loadFamily(fd);
    const notes = str(fd, "notes").slice(0, 2000) || null;
    await prisma.family.update({ where: { id: family.id }, data: { notes } });
    await audit({ userId: me.id, action: "FAMILY_NOTES_UPDATED", entityType: "Family", entityId: family.id });
    refresh();
    return { ok: true, message: "Observações salvas." };
  });
}
