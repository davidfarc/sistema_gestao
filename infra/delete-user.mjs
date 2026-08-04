/**
 * Exclui definitivamente um usuário, pelo e-mail.
 *
 *   node --env-file=apps/web/.env.local infra/delete-user.mjs <email>
 *
 * Remove a conta de autenticação; `app_user` e `user_role` saem em cascata
 * (FK on delete cascade). Recusa a exclusão se houver histórico apontando para
 * a pessoa — card, comentário, atribuição, aprovação. Nesses casos o certo é
 * REVOGAR o acesso (Configurações > Usuários), que preserva a autoria; excluir
 * apagaria o vínculo de quem pediu ou aprovou o quê.
 */
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Uso: node --env-file=apps/web/.env.local infra/delete-user.mjs <email>");
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: user } = await db
  .from("app_user")
  .select("id, email, name")
  .eq("email", email)
  .maybeSingle();

if (!user) {
  console.error(`Nenhum usuário com o e-mail ${email}.`);
  process.exit(1);
}

// Histórico que NÃO deve ser apagado junto — se houver, aborta.
const HISTORICO = [
  ["card", "requester_id"],
  ["assignment", "user_id"],
  ["activity", "actor_id"],
  ["comment", "author_id"],
  ["prioritization", "prioritized_by"],
  ["approval", "approver_id"],
];

const encontrados = [];
for (const [table, col] of HISTORICO) {
  const { count, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(col, user.id);
  if (error) {
    console.error(`Falha ao checar ${table}.${col}: ${error.message}`);
    process.exit(1);
  }
  if ((count ?? 0) > 0) encontrados.push(`${table}.${col} = ${count}`);
}

if (encontrados.length > 0) {
  console.error(`${user.email} tem historico no sistema:`);
  for (const e of encontrados) console.error(`  ${e}`);
  console.error("\nRevogue o acesso em Configuracoes > Usuarios em vez de excluir.");
  process.exit(1);
}

const { error } = await db.auth.admin.deleteUser(user.id);
if (error) {
  console.error(`Falha ao excluir: ${error.message}`);
  process.exit(1);
}

console.log(`Excluido: ${user.email} (${user.name}).`);
