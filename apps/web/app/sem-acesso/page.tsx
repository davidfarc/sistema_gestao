import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Autenticou no Google, mas não tem acesso a esta base.
 *
 * Fica FORA do grupo (app) de propósito: o shell autenticado redireciona para
 * cá quando não há usuário provisionado, e se esta página usasse aquele layout
 * o redirecionamento entraria em laço.
 */
export default async function SemAcessoPage() {
  const user = await getSessionUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Editora Ecco Prime
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Acesso não liberado</h1>
        <p className="mt-3 text-sm text-neutral-600">
          {user?.email ? (
            <>
              A conta <strong>{user.email}</strong> não tem acesso ao sistema.
            </>
          ) : (
            <>Esta conta não tem acesso ao sistema.</>
          )}{" "}
          O acesso é liberado pela gestão — peça para incluírem seu e-mail em
          Configurações → Usuários.
        </p>
      </div>

      <a
        href="/auth/signout"
        className="self-start rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50"
      >
        Sair e entrar com outra conta
      </a>
    </main>
  );
}
