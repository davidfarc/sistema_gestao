import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string | undefined;
  user_metadata: Record<string, unknown>;
};

/**
 * Usuário autenticado ou null, deduplicado por request com `cache()`.
 *
 * `getClaims()` valida a assinatura do token (ES256, chaves públicas do
 * projeto, guardadas em cache) sem ir ao servidor de Auth a cada clique — o
 * `getUser()` fazia uma ida e volta de rede por página. Expirado ou adulterado
 * → null, igual antes.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return {
    id: claims.sub,
    email: claims.email,
    user_metadata: (claims.user_metadata as Record<string, unknown> | undefined) ?? {},
  };
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
