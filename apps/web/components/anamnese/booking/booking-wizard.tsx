"use client";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Baby, BookOpen, CalendarCheck, Check, CheckCircle2, ChevronRight, Clock3, GraduationCap, Loader2, Printer, School, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/anamnese/ui/button";
import { Input } from "@/components/anamnese/ui/form";
import { Alert } from "@/components/anamnese/ui/card";
import { MonthCalendar } from "./month-calendar";
import { createBookingAction } from "@/lib/anamnese/server/booking-actions";
import clsx from "clsx";
import { classSuggestions } from "@/lib/anamnese/classes";

type Segment = { id: string; slug: string; name: string; description: string | null };
type Slot = { id: string; start: string; end: string; psychologist: string };
type Result = {
  code: string; guardianName: string; studentName: string; studentClass: string; phone: string; email: string;
  segment: string; psychologist: string; date: string; longDate: string; time: string; emailEnabled: boolean;
};

const ICONS = [Baby, BookOpen, School, GraduationCap];
const STEPS = ["Segmento", "Data", "Horário", "Seus dados", "Confirmação"];

const longDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function BookingWizard({
  segments, minMonth, maxMonth, contactPhone, attendanceInstructions,
}: {
  segments: Segment[]; minMonth: string; maxMonth: string; contactPhone: string; attendanceInstructions: string;
}) {
  const [step, setStep] = useState(1);
  const [segment, setSegment] = useState<Segment | null>(null);
  const [month, setMonth] = useState(minMonth);
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [loadingDates, setLoadingDates] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({ guardianName: "", studentName: "", studentClass: "", phone: "", email: "", consent: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(createBookingAction, {});

  const loadDates = useCallback(async (seg: string, m: string) => {
    setLoadingDates(true);
    try {
      const r = await fetch(`/api/anamnese/public/dates?segmentId=${seg}&month=${m}`, { cache: "no-store" });
      const j = await r.json();
      setDates(new Set<string>(j.dates ?? []));
      return (j.dates ?? []) as string[];
    } catch {
      setNotice("Não foi possível carregar as datas. Verifique sua conexão e tente novamente.");
      return [];
    } finally {
      setLoadingDates(false);
    }
  }, []);

  const loadSlots = useCallback(async (seg: string, d: string) => {
    setLoadingSlots(true);
    try {
      const r = await fetch(`/api/anamnese/public/slots?segmentId=${seg}&date=${d}`, { cache: "no-store" });
      const j = await r.json();
      setSlots(j.slots ?? []);
      return (j.slots ?? []) as Slot[];
    } catch {
      setNotice("Não foi possível carregar os horários. Tente novamente.");
      return [];
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  async function chooseSegment(s: Segment) {
    setSegment(s);
    setDate(null);
    setSlot(null);
    setNotice(null);
    setStep(2);
    // avança automaticamente para o primeiro mês que tenha datas
    let m = minMonth;
    for (let i = 0; i < 6 && m <= maxMonth; i++) {
      const found = await loadDates(s.id, m);
      if (found.length) break;
      const d = new Date(`${m}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      m = d.toISOString().slice(0, 7);
      if (m > maxMonth) {
        setMonth(minMonth);
        await loadDates(s.id, minMonth);
        break;
      }
    }
    setMonth(m <= maxMonth ? m : minMonth);
  }

  async function changeMonth(m: string) {
    setMonth(m);
    if (segment) await loadDates(segment.id, m);
  }

  async function chooseDate(d: string) {
    setDate(d);
    setSlot(null);
    setNotice(null);
    setStep(3);
    if (segment) await loadSlots(segment.id, d);
  }

  function validate() {
    const e: Record<string, string> = {};
    const words = (v: string) => v.trim().split(/\s+/).filter(Boolean).length;
    if (words(form.guardianName) < 2) e.guardianName = "Informe nome e sobrenome do responsável.";
    if (words(form.studentName) < 2) e.studentName = "Informe nome e sobrenome do aluno.";
    if (form.studentClass.trim().length < 2) e.studentClass = "Informe a turma ou série do aluno (ex.: 7º ano B).";
    const digits = form.phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    if (!/^[1-9]{2}9?\d{8}$/.test(digits)) e.phone = "Informe o DDD e o número (ex.: 81 99999-0000).";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) e.email = "Informe um e-mail válido.";
    if (!form.consent) e.consent = "É necessário aceitar a Política de Privacidade.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // Resposta do servidor
  useEffect(() => {
    if (state.ok || !state.error) return;
    const code = (state.data as { code?: string } | undefined)?.code;
    if (state.fieldErrors) {
      setErrors(state.fieldErrors);
      setStep(4);
    } else if (code === "SLOT_UNAVAILABLE" || code === "TOO_SOON" || code === "SLOT_IN_PAST") {
      setNotice(state.error);
      setSlot(null);
      setStep(3);
      if (segment && date) loadSlots(segment.id, date);
    }
  }, [state, segment, date, loadSlots]);

  const result = state.ok ? (state.data as unknown as Result) : null;
  const available = useMemo(() => dates, [dates]);

  if (result) return <Success r={result} contactPhone={contactPhone} instructions={attendanceInstructions} />;

  const back = () => {
    setNotice(null);
    setStep((s) => Math.max(1, s - 1));
  };

  return (
    <div className="space-y-7">
      <Stepper step={step} />

      {notice && <Alert variant="warning">{notice}</Alert>}
      {state.error && !state.fieldErrors && step === 5 && <Alert variant="error">{state.error}</Alert>}

      {step > 1 && step < 5 && (
        <button
          type="button"
          onClick={back}
          className="-ml-1 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-secondary transition hover:bg-surface-low hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>
      )}

      {step === 1 && (
        <section aria-labelledby="s1" className="space-y-5">
          <Title id="s1" hint="Toque no segmento para ver as datas disponíveis.">
            Qual é o segmento escolar do seu filho(a)?
          </Title>
          <div className="grid gap-3 sm:grid-cols-2">
            {segments.map((s, i) => {
              const Icon = ICONS[i % ICONS.length]!;
              return (
                <button key={s.id} type="button" onClick={() => chooseSegment(s)}
                  className="group flex items-center gap-4 rounded-2xl border border-surface-medium bg-surface-lowest p-5 text-left shadow-premium-soft transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-premium-hover">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary/[0.07] text-primary transition group-hover:bg-primary group-hover:text-white">
                    <Icon className="h-7 w-7" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-headline text-lg font-bold leading-snug text-primary">{s.name}</span>
                    {s.description && <span className="mt-0.5 block text-sm text-secondary">{s.description}</span>}
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-secondary/40 transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {step === 2 && segment && (
        <section aria-labelledby="s2" className="space-y-5">
          <Title id="s2" hint={segment.name}>Escolha a data</Title>
          <MonthCalendar month={month} onMonthChange={changeMonth} available={available} selected={date}
            onSelect={chooseDate} minMonth={minMonth} maxMonth={maxMonth} loading={loadingDates} />
          {!loadingDates && dates.size === 0 && (
            <Alert variant="info">
              Não há datas disponíveis neste mês. Use as setas para ver outros meses
              {contactPhone ? <> ou fale com a escola: <strong>{contactPhone}</strong></> : null}.
            </Alert>
          )}
        </section>
      )}

      {step === 3 && segment && date && (
        <section aria-labelledby="s3" className="space-y-5">
          <Title id="s3" hint="Escolha o horário da anamnese.">
            <span className="first-letter:uppercase">{longDate(date)}</span>
          </Title>
          {loadingSlots ? (
            <div className="flex items-center gap-2 text-sm text-secondary"><Loader2 className="h-4 w-4 animate-spin" /> Carregando horários…</div>
          ) : slots.length === 0 ? (
            <Alert variant="info">Todos os horários desta data foram preenchidos. Volte e escolha outra data.</Alert>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {slots.map((s) => (
                <button key={s.id} type="button" onClick={() => { setSlot(s); setNotice(null); setStep(4); }}
                  className="group rounded-2xl border border-surface-medium bg-surface-lowest px-3 py-4 text-center shadow-premium-soft transition hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:shadow-premium-hover">
                  <Clock3 className="mx-auto mb-1 h-4 w-4 text-secondary/60 transition group-hover:text-white/80" aria-hidden />
                  <span className="block font-headline text-xl font-bold tabular-nums text-primary transition group-hover:text-white">{s.start}</span>
                  <span className="block text-xs text-secondary transition group-hover:text-white/75">até {s.end}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 4 && (
        <section aria-labelledby="s4" className="space-y-5">
          <Title id="s4" hint="Usamos estes dados só para confirmar e organizar o atendimento.">
            Identificação da família
          </Title>
          <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (validate()) setStep(5); }}>
            <Fld id="guardianName" label="Nome completo do responsável" error={errors.guardianName}>
              <Input id="guardianName" autoComplete="name" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} className={inputCls} />
            </Fld>
            <Fld id="studentName" label="Nome completo do aluno" error={errors.studentName}>
              <Input id="studentName" value={form.studentName} onChange={(e) => setForm({ ...form, studentName: e.target.value })} className={inputCls} />
            </Fld>
            <Fld id="studentClass" label="Turma / série do aluno" error={errors.studentClass}>
              <Input id="studentClass" list="student-class-options" maxLength={40} placeholder={segment?.slug === "fundamental-2" ? "Ex.: 7º ano B ou 2ª série do Médio" : "Ex.: 3º ano B"}
                value={form.studentClass} onChange={(e) => setForm({ ...form, studentClass: e.target.value })} className={inputCls} />
              <datalist id="student-class-options">
                {classSuggestions(segment?.slug ?? "").map((c) => <option key={c} value={c} />)}
              </datalist>
            </Fld>
            <Fld id="phone" label="Telefone / WhatsApp" error={errors.phone}>
              <Input id="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(81) 99999-0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </Fld>
            <Fld id="email" label="E-mail" error={errors.email}>
              <Input id="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
            </Fld>
            <div className="rounded-2xl border border-primary/10 bg-primary/[0.03] p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-primary"><ShieldCheck className="h-4 w-4" /> Seus dados e a LGPD</p>
              <p className="mt-1 text-secondary">
                Usamos estas informações apenas para organizar o atendimento e confirmar o agendamento.
                Não pedimos nem registramos informações clínicas neste formulário.
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-3 text-primary">
                <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary" />
                <span>
                  Sou o responsável legal pelo aluno e li e concordo com a{" "}
                  <a href="/privacidade" target="_blank" rel="noopener" className="font-semibold text-primary underline">Política de Privacidade</a>.
                </span>
              </label>
              {errors.consent && <p role="alert" className="mt-1 text-xs font-medium text-danger">{errors.consent}</p>}
            </div>
            <Button type="submit" size="lg" className="w-full rounded-xl py-3.5 shadow-premium-soft">
              Continuar <ChevronRight />
            </Button>
          </form>
        </section>
      )}

      {step === 5 && segment && slot && date && (
        <section aria-labelledby="s5" className="space-y-5">
          <Title id="s5" hint="Confira os dados antes de confirmar.">Confira e confirme</Title>
          <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-primary to-primary-high p-5 text-white">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/15">
              <CalendarCheck className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-headline text-lg font-bold leading-snug first-letter:uppercase">{longDate(date)}</p>
              <p className="text-sm text-white/85">{slot.start} às {slot.end} · {segment.name}</p>
            </div>
          </div>
          <Summary
            rows={[
              ["Responsável", form.guardianName],
              ["Aluno(a)", form.studentName],
              ["Turma / série", form.studentClass.trim()],
              ["Psicóloga responsável", slot.psychologist],
            ]}
          />
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="slotId" value={slot.id} />
            <input type="hidden" name="segmentId" value={segment.id} />
            <input type="hidden" name="guardianName" value={form.guardianName} />
            <input type="hidden" name="studentName" value={form.studentName} />
            <input type="hidden" name="studentClass" value={form.studentClass} />
            <input type="hidden" name="phone" value={form.phone} />
            <input type="hidden" name="email" value={form.email} />
            <input type="hidden" name="consent" value={form.consent ? "on" : ""} />
            {/* honeypot */}
            <div aria-hidden className="absolute -left-[9999px]">
              <label>Site<input name="website" tabIndex={-1} autoComplete="off" /></label>
            </div>
            <Button type="submit" size="lg" variant="accent" className="w-full rounded-xl py-4 text-base shadow-premium-hover" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <CalendarCheck />}
              {pending ? "Confirmando…" : "CONFIRMAR AGENDAMENTO"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setStep(4)} disabled={pending}>Corrigir meus dados</Button>
          </form>
        </section>
      )}
    </div>
  );
}

const inputCls =
  "h-12 rounded-xl bg-surface-lowest text-base transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10";

/** Barra de etapas: progresso preenchido + etapa atual destacada. */
function Stepper({ step }: { step: number }) {
  const pct = ((step - 1) / (STEPS.length - 1)) * 100;
  return (
    <div>
      <ol className="relative flex items-start justify-between" aria-label="Etapas do agendamento">
        <span aria-hidden className="absolute left-4 right-4 top-4 h-0.5 rounded-full bg-surface-medium" />
        <span
          aria-hidden
          className="absolute left-4 top-4 h-0.5 rounded-full bg-success transition-all duration-500"
          style={{ width: `calc((100% - 2rem) * ${pct / 100})` }}
        />
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <li key={label} className="relative z-10 flex w-16 flex-col items-center gap-1.5" aria-current={current ? "step" : undefined}>
              <span
                className={clsx(
                  "grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition",
                  done && "bg-success text-white",
                  current && "bg-primary text-white ring-4 ring-primary/15",
                  !done && !current && "border border-surface-medium bg-surface-lowest text-secondary",
                )}
              >
                {done ? <Check className="h-4 w-4" aria-hidden /> : n}
              </span>
              <span className={clsx("hidden text-center text-[11px] font-semibold leading-tight sm:block", current ? "text-primary" : "text-secondary")}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-center text-sm font-semibold text-secondary sm:hidden">
        Etapa {step} de {STEPS.length} · <span className="text-primary">{STEPS[step - 1]}</span>
      </p>
    </div>
  );
}

function Title({ id, hint, children }: { id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 id={id} className="font-headline text-2xl font-bold leading-tight text-primary">{children}</h2>
      {hint && <p className="mt-1 text-sm text-secondary">{hint}</p>}
    </div>
  );
}

function Summary({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-surface-medium overflow-hidden rounded-2xl border border-surface-medium bg-surface-lowest">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <dt className="text-sm text-secondary">{k}</dt>
          <dd className="font-semibold text-primary sm:text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Fld({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-primary">{label}</label>
      {children}
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}

function Success({ r, contactPhone, instructions }: { r: Result; contactPhone: string; instructions: string }) {
  return (
    <section className="space-y-6" aria-live="polite">
      <div className="text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/10 ring-8 ring-success/5">
          <CheckCircle2 className="h-9 w-9 text-success" />
        </span>
        <h2 className="mt-4 font-headline text-2xl font-bold text-primary">Agendamento confirmado!</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
          {r.emailEnabled ? (
            <>Enviamos a confirmação para <strong className="text-primary">{r.email}</strong>. Confira também a caixa de spam.</>
          ) : (
            <>Guarde o código abaixo ou use o botão de imprimir. Seu agendamento está registrado.</>
          )}
        </p>
      </div>

      <div className="rounded-2xl border-2 border-dashed border-primary/20 bg-primary/[0.03] px-5 py-4 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-secondary">Código do agendamento</p>
        <p className="mt-1 font-headline text-3xl font-extrabold tracking-wider text-primary">{r.code}</p>
      </div>

      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-primary to-primary-high p-5 text-white">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/15">
          <CalendarCheck className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-headline text-lg font-bold leading-snug first-letter:uppercase">{r.longDate}</p>
          <p className="text-sm text-white/85">{r.time} · {r.segment}</p>
        </div>
      </div>

      <Summary
        rows={[
          ["Aluno(a)", r.studentName],
          ["Turma / série", r.studentClass],
          ["Responsável", r.guardianName],
          ["Telefone", r.phone],
          ["Psicóloga responsável", r.psychologist],
        ]}
      />
      <Alert variant="info"><strong>Orientações:</strong> {instructions}{contactPhone ? <> Contato da escola: <strong>{contactPhone}</strong>.</> : null}</Alert>
      <Button type="button" variant="outline" className="w-full rounded-xl py-3 print:hidden" onClick={() => window.print()}>
        <Printer /> Imprimir / salvar comprovante
      </Button>
    </section>
  );
}
