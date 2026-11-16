import { UsersTable } from "@/components/users/UsersTable";
import { provisionAndGetActor } from "@/lib/actor";
import { loadRoles, loadUsers } from "@/lib/board/actions";
import { loadBoards } from "@/lib/board/queries";

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

  const [users, roles, boards] = await Promise.all([loadUsers(), loadRoles(), loadBoards()]);

  return (
    <div className="mt-6">
      <h1 className="text-2xl">Usuários</h1>
      <p className="mt-2 text-sm text-secondary">
        Quem tem acesso ao sistema e o papel de cada um. Os usuários entram por Google e são criados
        no primeiro login. O <strong>cargo</strong> define quem aprova as demandas em cada faixa de
        alçada. Em <strong>Pipelines</strong> você escolhe o que cada Gestor de área ou membro
        enxerga; Gestor e Gestor Master veem todos.
      </p>

      <div className="mt-6">
        <UsersTable
          users={users}
          roles={roles}
          boards={boards.filter((b) => !b.archived)}
          canSetBoards={actor.permissions.has("board:configure")}
        />
      </div>
    </div>
  );
}
