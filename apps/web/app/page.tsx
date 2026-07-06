import { buildCardCode } from "@ecco/core";

// Prova de fiação: renderiza um código de card gerado pelo @ecco/core.
// Se isto compila e aparece na tela, o transpilePackages + imports .ts funcionam.
const exemplo = buildCardCode({
  materiaCode: "TEX",
  serieCode: "7A",
  segmentoCode: "FUND2",
  bimestre: 1,
  year: 2027,
});

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Editora Ecco Prime
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Sistema de Gestão Editorial</h1>
      </div>
      <p className="text-neutral-600">
        Fundação no ar. Exemplo de código de card gerado pelo{" "}
        <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-sm">@ecco/core</code>:
      </p>
      <code className="w-fit rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-lg font-semibold">
        {exemplo}
      </code>
      <p className="text-sm text-neutral-400">
        Próximo: Kanban + lista, autenticação Google e campos customizados.
      </p>
    </main>
  );
}
