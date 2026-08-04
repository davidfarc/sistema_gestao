import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import SalasTabs from "@/components/salas/SalasTabs";
import { provisionAndGetActor } from "@/lib/actor";
import { SalasProvider } from "@/lib/salas/SalasContext";

export const dynamic = "force-dynamic";

/**
 * Gate do módulo Vila. No sistema de origem era uma permissão própria
 * ("salas"); aqui usa o modelo do resto do app — usuário interno. Se um dia
 * precisar ser mais restrito, vira uma Action dedicada.
 */
export default async function SalasLayout({ children }: { children: ReactNode }) {
  const actor = await provisionAndGetActor();

  if (!actor?.isInternal) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-2xl border border-black/5 bg-surface-low p-8 text-center">
        <Lock className="mx-auto mb-2 h-6 w-6 text-secondary" aria-hidden="true" />
        <p className="font-semibold text-primary">Sem acesso à Gestão de Vila</p>
        <p className="mt-1 text-sm text-secondary">
          Fale com a Direção para liberar o acesso.
        </p>
      </div>
    );
  }

  // Ver é para toda a equipe; editar exige `salas:manage`. Quem não a tem
  // continua com o modo Simulado, que não grava nada.
  const canEdit = actor.permissions.has("salas:manage");

  return (
    <SalasProvider canEdit={canEdit}>
      <div className="p-5 md:p-8">
        <SalasTabs />
        {!canEdit && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Modo consulta: você pode acompanhar e usar o <strong>Simulado</strong> para testar
            remanejamentos, mas as alterações não são salvas.
          </p>
        )}
        <div className="mt-6">{children}</div>
      </div>
    </SalasProvider>
  );
}
