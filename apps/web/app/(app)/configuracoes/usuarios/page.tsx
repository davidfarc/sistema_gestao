import { UsersTable } from "@/components/users/UsersTable";
import { provisionAndGetActor } from "@/lib/actor";
import { loadRoles, loadUsers } from "@/lib/board/actions";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const actor = await provisionAndGetActor();
  if (!actor?.permissions.has("user:manage")) {
    return (
      <div className="mt-6">
        <h1 className="text-2xl">Usuários</h1>
        <p className="mt-2 text-sm text-secondary">
          Você não tem permissão para gerenciar usuários (apenas Gestor).
        </p>
      </div>
    );
  }

  const [users, roles] = await Promise.all([loadUsers(), loadRoles()]);

  return (
    <div className="mt-6">
      <h1 className="text-2xl">Usuários</h1>
      <p className="mt-2 text-sm text-secondary">
        Quem tem acesso ao sistema e o papel de cada um. Os usuários entram por Google e são criados
        no primeiro login. O <strong>cargo</strong> define quem aprova as demandas em cada faixa de
        alçada.
      </p>

      <div className="mt-6">
        <UsersTable users={users} roles={roles} />
      </div>
    </div>
  );
}
