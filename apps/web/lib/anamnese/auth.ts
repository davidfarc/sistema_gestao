import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "./db";
import { ActionError } from "./errors";

export { ActionError };

// Login único: quem entra é a sessão Google do sistema de gestão (Supabase
// Auth). O perfil na central (Administrador / Psicóloga / Atendimento e
// Coordenação) vem da tabela anamnese."User", ligada pelo e-mail. Sem cadastro
// ali, a pessoa não acessa "Novos alunos" (vê a tela de acesso negado).

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
  const session = await getSessionUser();
  const email = session?.email?.toLowerCase();
  if (!email) return null;
  const user = await prisma.user.findUnique({
    where: { email },
    include: { psychologist: true },
  });
  if (!user || !user.active || user.deletedAt) return null;
  if (user.role === "PSYCHOLOGIST" && (!user.psychologist || !user.psychologist.active || user.psychologist.deletedAt)) {
    return null;
  }
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
