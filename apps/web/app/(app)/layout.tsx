import type { ReactNode } from "react";

import { MainContainer } from "@/components/shell/MainContainer";
import { Sidebar } from "@/components/shell/Sidebar";
import { SidebarProvider } from "@/components/shell/SidebarContext";
import { getSessionUser, isInternalEmail } from "@/lib/auth";

/** Shell das páginas autenticadas: sidebar + conteúdo. /login e /auth ficam fora. */
export default async function AppLayout({ children }: { children: ReactNode }) {
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
