import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { provisionAndGetActor } from "@/lib/actor";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "./db";
import { ActionError } from "./errors";

export { ActionError };

// Acesso a "Novos alunos" segue o gerenciador de papéis do sistema:
//   `novos:manage`                 → Administrador da central
//   cadastro em Psicólogas (ativo) → Psicóloga (vê a própria agenda)
//   `novos:access`                 → Atendimento / Coordenação
// O registro em anamnese."User" é mantido automaticamente (por e-mail) só
// para a auditoria e os vínculos da central; quem decide o acesso é o papel.

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  psychologistId: string | null;
  canViewOthers: boolean;
};

/** Usuário da central para a sessão atual, revalidado no banco a cada requisição. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const [actor, session] = await Promise.all([provisionAndGetActor(), getSessionUser()]);
  const email = session?.email?.toLowerCase();
  if (!actor || !email) return null;

  const existing = await prisma.user.findUnique({ where: { email }, include: { psychologist: true } });
  if (existing && (!existing.active || existing.deletedAt)) return null;
  const psy = existing?.psychologist;
  const isPsychologist = Boolean(psy && psy.active && !psy.deletedAt);

  const role: Role | null = actor.permissions.has("novos:manage")
    ? "ADMIN"
    : isPsychologist
      ? "PSYCHOLOGIST"
      : actor.permissions.has("novos:access")
        ? "COORDINATION"
        : null;
  if (!role) return null;

  const meta = session?.user_metadata ?? {};
  const name = (meta.full_name as string) || (meta.name as string) || existing?.name || email.split("@")[0]!;
  const user = !existing
    ? await prisma.user.create({ data: { email, name, role }, include: { psychologist: true } })
    : existing.role !== role
      ? await prisma.user.update({ where: { id: existing.id }, data: { role }, include: { psychologist: true } })
      : existing;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    psychologistId: user.psychologist?.id ?? null,
    canViewOthers: user.psychologist?.canViewOthers ?? false,
  };
});

export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/novos-alunos");
  if (roles && !roles.includes(user.role)) redirect("/novos-alunos?negado=1");
  return user;
}

/** Para Server Actions: lança em vez de redirecionar. */
export async function requireUserForAction(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Você não tem acesso à central de Novos alunos.");
  if (roles && !roles.includes(user.role)) throw new ActionError("Você não tem permissão para esta ação.");
  return user;
}
