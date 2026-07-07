import type { ReactNode } from "react";

import { MainContainer } from "@/components/shell/MainContainer";
import { Sidebar } from "@/components/shell/Sidebar";
import { SidebarProvider } from "@/components/shell/SidebarContext";
import { provisionAndGetActor } from "@/lib/actor";
import { getSessionUser, isInternalEmail } from "@/lib/auth";

/** Shell das páginas autenticadas: sidebar + conteúdo. /login e /auth ficam fora. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await provisionAndGetActor(); // garante o app_user do usuário logado
  const sessionUser = await getSessionUser();
  const user = sessionUser?.email
    ? { email: sessionUser.email, internal: isInternalEmail(sessionUser.email) }
    : null;

  return (
    <SidebarProvider>
      <Sidebar user={user} />
      <MainContainer>{children}</MainContainer>
    </SidebarProvider>
  );
}
