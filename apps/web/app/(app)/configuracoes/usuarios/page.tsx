import { UsersTable } from "@/components/users/UsersTable";
import { provisionAndGetActor } from "@/lib/actor";
import { loadRoles, loadUsers } from "@/lib/board/actions";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const actor = await provisionAndGetActor();
  if (!actor?.permissions.has("board:configure")) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl">Usuários</h1>
        <p className="mt-2 text-sm text-secondary">
          Você não tem permissão para gerenciar usuários (apenas Gestor).
        </p>
      </main>
    );
  }

  const [users, roles] = await Promise.all([loadUsers(), loadRoles()]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-sm font-medium uppercase tracking-wide text-secondary">Configurações</p>
      <h1 className="mt-1 text-2xl">Usuários</h1>
      <p className="mt-2 text-sm text-secondary">
        Quem tem acesso ao sistema e o papel de cada um. Os usuários entram por Google e são
        criados no primeiro login.
      </p>

      <div className="mt-6">
        <UsersTable users={users} roles={roles} />
      </div>
    </main>
  );
}
