import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BottomNav } from "@/components/shell/BottomNav";
import { MainContainer } from "@/components/shell/MainContainer";
import { Sidebar } from "@/components/shell/Sidebar";
import { SidebarProvider } from "@/components/shell/SidebarContext";
import { provisionAndGetActor } from "@/lib/actor";
import { getSessionUser, isInternalEmail } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PhonePrompt } from "@/components/profile/PhonePrompt";

/** Shell das páginas autenticadas: sidebar + conteúdo. /login e /auth ficam fora. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await provisionAndGetActor(); // garante o app_user do usuário logado
  // Autenticado no Google mas sem acesso (domínio não autorizado, sem convite,
  // ou acesso revogado). Sem isso a pessoa veria telas vazias sem explicação.
  if (!actor) redirect("/sem-acesso");
  const sessionUser = await getSessionUser();
  const user = sessionUser?.email
    ? {
        email: sessionUser.email,
        name:
          (sessionUser.user_metadata.full_name as string | undefined) ||
          (sessionUser.user_metadata.name as string | undefined) ||
          null,
        internal: isInternalEmail(sessionUser.email),
      }
    : null;

  // Convite para cadastrar o telefone (só equipe interna, e só depois da
  // migration 0044: sem a tabela a consulta dá erro e o convite não aparece).
  let askPhone = false;
  if (actor.isInternal) {
    const { data, error } = await createAdminClient()
      .from("user_phone")
      .select("user_id")
      .eq("user_id", actor.userId as string)
      .maybeSingle();
    askPhone = !error && !data;
  }

  return (
    <SidebarProvider>
      <Sidebar
        user={user}
        access={{
          painel: actor.permissions.has("stage:manage"),
          salas: actor.isInternal && actor.permissions.has("salas:manage"),
          // Psicólogas entram pelo cadastro delas no módulo; para o item
          // aparecer no menu, marca-se a caixa "Novos alunos" em Usuários.
          novos: actor.permissions.has("novos:access") || actor.permissions.has("novos:manage"),
        }}
      />
      <MainContainer>{children}</MainContainer>
      <BottomNav />
      {askPhone && <PhonePrompt />}
    </SidebarProvider>
  );
}
