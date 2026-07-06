import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/** Usuário autenticado (validado no servidor) ou null. */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Classificação interno/externo pelo domínio do e-mail (PLANO.md): interno =
 * domínio da organização. Não confiar só no `hd` do Google — checar aqui.
 */
export function isInternalEmail(email: string | undefined | null): boolean {
  const domain = process.env.INTERNAL_EMAIL_DOMAIN?.toLowerCase();
  if (!domain || !email) return false;
  return email.toLowerCase().endsWith("@" + domain);
}

// TODO(auth): montar o Actor completo do @ecco/core (organizationId +
// permissions resolvidas dos papéis) quando as migrations estiverem aplicadas
// e a tabela app_user/role existir. Por ora só sessão + classificação.
