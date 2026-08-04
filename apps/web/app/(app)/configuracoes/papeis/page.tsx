import { RolesEditor } from "@/components/configuracoes/RolesEditor";
import { provisionAndGetActor } from "@/lib/actor";
import { loadRoleDetails } from "@/lib/roles/actions";

export const dynamic = "force-dynamic";

export default async function PapeisPage() {
  const actor = await provisionAndGetActor();

  // Editar papéis é definir o que cada função pode fazer — inclusive a própria.
  // Fica com o Gestor Master; um Gestor comum administra usuários, não escopos.
  if (!actor?.permissions.has("role:manage")) {
    return (
      <div className="mt-6">
        <h1 className="text-2xl">Papéis</h1>
        <p className="mt-2 text-sm text-secondary">
          Só o Gestor Master edita papéis e permissões.
        </p>
      </div>
    );
  }

  const roles = await loadRoleDetails();

  return (
    <div className="mt-6">
      <h1 className="text-2xl">Papéis</h1>
      <p className="mt-2 max-w-2xl text-sm text-secondary">
        O que cada função pode fazer no sistema. Cada pessoa tem um papel, definido em{" "}
        <strong>Usuários</strong>; aqui você define o alcance de cada papel.
      </p>

      <RolesEditor roles={roles} />
    </div>
  );
}
