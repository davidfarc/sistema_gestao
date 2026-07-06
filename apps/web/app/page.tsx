import { buildCardCode } from "@ecco/core";

import { getSessionUser, isInternalEmail } from "@/lib/auth";

// Prova de fiação do @ecco/core (transpilePackages + imports .ts).
const exemplo = buildCardCode({
  materiaCode: "TEX",
  serieCode: "7A",
  segmentoCode: "FUND2",
  bimestre: 1,
  year: 2027,
});

export default async function Home() {
  const user = await getSessionUser();
  const email = user?.email ?? null;
  const interno = isInternalEmail(email);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Editora Ecco Prime
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Sistema de Gestão Editorial</h1>
      </div>

      {email && (
        <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <div className="text-sm">
            <span className="text-neutral-500">Logado como </span>
            <span className="font-medium">{email}</span>
            <span
              className={
                "ml-2 rounded px-1.5 py-0.5 text-xs font-medium " +
                (interno
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700")
              }
            >
              {interno ? "interno" : "externo"}
            </span>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
            >
              Sair
            </button>
          </form>
        </div>
      )}

      <p className="text-neutral-600">
        Fundação no ar. Código de card gerado pelo{" "}
        <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-sm">@ecco/core</code>:
      </p>
      <code className="w-fit rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-lg font-semibold">
        {exemplo}
      </code>
      <p className="text-sm text-neutral-400">
        Próximo: Kanban + lista, campos customizados e canais de equipe.
      </p>
    </main>
  );
}
