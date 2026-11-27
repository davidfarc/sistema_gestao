import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";

import { SurveyForm } from "./SurveyForm";

export const metadata = { title: "Pesquisa de satisfação", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const db = createAdminClient();
  const { data } = await db
    .from("meeting_survey")
    .select("participant, status, card:card_id(board:board_id(name))")
    .eq("token", token)
    .maybeSingle();
  if (!data) notFound();
  const row = data as unknown as { participant: string; status: string; card: { board: { name: string } | null } | null };
  const first = row.participant.split(" ")[0] || "";
  const area = row.card?.board?.name ?? "";

  return (
    <main className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto grid max-w-lg gap-6">
        <header className="rounded-2xl bg-gradient-to-br from-primary to-primary-high p-6 text-white">
          <p className="text-sm font-medium uppercase tracking-wide text-white/80">Escola Eccoprime</p>
          <h1 className="mt-1 text-2xl">Como foi a reunião?</h1>
          <p className="mt-2 text-sm text-white/90">
            {first ? `${first}, obrigado` : "Obrigado"} pela reunião{area ? ` com ${area}` : ""}. São 3 perguntas
            rápidas e a resposta vai direto para a equipe.
          </p>
        </header>
        {row.status === "enviada" ? (
          <SurveyForm token={token} />
        ) : (
          <p className="rounded-xl border border-neutral-200 bg-white p-5 text-center text-neutral-700">
            {row.status === "respondida" ? "Esta pesquisa já foi respondida. Obrigado!" : "Esta pesquisa não está mais aberta."}
          </p>
        )}
      </div>
    </main>
  );
}
