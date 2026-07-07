import type { User } from "@supabase/supabase-js";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Usuário autenticado (validado no servidor) ou null. Deduplicado por request
 * com `cache()` — o `auth.getUser()` é uma chamada de rede; sem isso ele roda
 * várias vezes por carregamento (layout + página + sidebar).
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Classificação interno/externo pelo domínio do e-mail (PLANO.md): interno =
 * domínio da organização. Não confiar só no `hd` do Google — checar aqui.
 */
export function isInternalEmail(email: string | undefined | null): boolean {
  const domains = (process.env.INTERNAL_EMAIL_DOMAIN ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (!email || domains.length === 0) return false;
  const emailDomain = email.toLowerCase().split("@")[1] ?? "";
  return domains.includes(emailDomain);
}

// TODO(auth): montar o Actor completo do @ecco/core (organizationId +
// permissions resolvidas dos papéis) quando as migrations estiverem aplicadas
// e a tabela app_user/role existir. Por ora só sessão + classificação.
