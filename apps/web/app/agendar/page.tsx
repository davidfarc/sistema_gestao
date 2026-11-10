import Link from "next/link";
import { CalendarHeart, Clock3, MailCheck, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/anamnese/db";
import { getSettings } from "@/lib/anamnese/settings";
import { Brand } from "@/components/anamnese/brand";
import { BookingWizard } from "@/components/anamnese/booking/booking-wizard";
import { Alert } from "@/components/anamnese/ui/card";
import { addDaysKey, todayKey } from "@/lib/anamnese/time";

export const metadata = { title: "Agendar anamnese" };
// Lê configurações do banco a cada acesso (não pode ser gerada no build).
export const dynamic = "force-dynamic";

const SELOS = [
  { Icon: Clock3, text: "Leva cerca de 2 minutos" },
  { Icon: MailCheck, text: "Confirmação na hora" },
  { Icon: ShieldCheck, text: "Sem dados clínicos" },
];

export default async function SchedulePage() {
  const s = await getSettings();
  const segments = await prisma.schoolSegment.findMany({
    where: { active: true, deletedAt: null, psychologists: { some: { psychologist: { active: true, deletedAt: null } } } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, slug: true, name: true, description: true },
  });
  const today = todayKey();

  return (
    <div className="min-h-dvh bg-background">
      {/* Topo: marca + boas-vindas num bloco só, com fundo em degradê suave */}
      <header className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-primary-high pb-24 text-white print:hidden">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/[0.04]" />

        <div className="relative mx-auto max-w-3xl px-4 pt-5">
          <Brand s={s} light />
        </div>

        <div className="relative mx-auto mt-10 max-w-3xl px-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <CalendarHeart className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="mt-4 max-w-xl font-headline text-3xl font-extrabold leading-tight text-white sm:text-4xl">
            Central de Agendamento de Anamneses
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/85">{s.welcomeText}</p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {SELOS.map(({ Icon, text }) => (
              <li
                key={text}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/90 ring-1 ring-white/10"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {text}
              </li>
            ))}
          </ul>
        </div>
      </header>

      <main className="relative mx-auto -mt-16 max-w-3xl px-4 pb-16 print:mt-0">
        <div className="rounded-3xl border border-black/5 bg-surface-lowest p-5 shadow-premium-hover sm:p-9">
          {segments.length === 0 ? (
            <Alert variant="info">
              O agendamento online ainda não está disponível. Por favor, entre em contato com a escola
              {s.schoolContactPhone ? <>: <strong>{s.schoolContactPhone}</strong></> : null}.
            </Alert>
          ) : (
            <BookingWizard
              segments={segments}
              minMonth={today.slice(0, 7)}
              maxMonth={addDaysKey(today, s.maxDaysAhead).slice(0, 7)}
              contactPhone={s.schoolContactPhone}
              attendanceInstructions={s.attendanceInstructions}
            />
          )}
        </div>

        <footer className="mt-10 space-y-2 text-center text-xs text-secondary print:hidden">
          <p className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
            Não solicitamos informações clínicas, diagnósticos ou histórico psicológico neste formulário.
          </p>
          <p>
            <Link href="/privacidade" className="font-semibold text-primary underline-offset-4 hover:underline">
              Política de Privacidade
            </Link>
            <span className="mx-2 text-secondary/50">·</span>
            <Link href="/novos-alunos" className="underline-offset-4 hover:underline">
              Acesso da equipe
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
