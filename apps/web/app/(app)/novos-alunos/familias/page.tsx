import Link from "next/link";
import { Star } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/anamnese/auth";
import { prisma } from "@/lib/anamnese/db";
import { familyStage, STAGE_LABEL, type FamilyStage } from "@/lib/anamnese/family";
import { dateKey, fmtDate, fmtDateTime, fmtTime } from "@/lib/anamnese/time";
import { formatPhone } from "@/lib/anamnese/utils";
import { EmptyState, PageHeader } from "@/components/anamnese/page-header";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from "@/components/anamnese/ui/card";
import { Button } from "@/components/anamnese/ui/button";
import { Field, Input, Select, Textarea } from "@/components/anamnese/ui/form";
import { ActionForm } from "@/components/anamnese/action-form";
import { SubmitButton } from "@/components/anamnese/submit-button";
import { AppointmentStatusBadge } from "@/components/anamnese/status-badges";
import {
  deleteGuardianAction, saveFamilyNotesAction, saveGuardianAction, saveStudentAction,
} from "@/lib/anamnese/server/family-actions";

export const metadata = { title: "Famílias" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const STAGE_VARIANT: Record<FamilyStage, "success" | "default" | "warning" | "muted"> = {
  MATRICULADA: "success",
  ANAMNESE_REALIZADA: "warning",
  AGENDADA: "default",
  SEM_AGENDAMENTO: "muted",
};

const STAGES = Object.keys(STAGE_LABEL) as FamilyStage[];

export default async function FamiliesPage({ searchParams }: { searchParams: SP }) {
  await requireUser(["ADMIN", "COORDINATION"]);
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const q = (one("q") ?? "").trim();
  const stage = STAGES.includes(one("etapa") as FamilyStage) ? (one("etapa") as FamilyStage) : undefined;
  const verId = one("ver");

  const where: Prisma.FamilyWhereInput = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { guardians: { some: { name: { contains: q, mode: "insensitive" } } } },
          { students: { some: { name: { contains: q, mode: "insensitive" } } } },
        ],
      }
    : {};

  const [families, detail] = await Promise.all([
    prisma.family.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: {
        guardians: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { name: true } },
        students: { orderBy: { createdAt: "asc" }, select: { name: true, enrolledAt: true } },
        appointments: { orderBy: { startsAt: "desc" }, select: { status: true, startsAt: true } },
      },
    }),
    verId
      ? prisma.family.findUnique({
          where: { id: verId },
          include: {
            guardians: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], include: { _count: { select: { appointments: true } } } },
            students: { orderBy: { createdAt: "asc" } },
            appointments: {
              orderBy: { startsAt: "desc" },
              include: { segment: { select: { name: true } }, psychologist: { select: { name: true } }, student: { select: { name: true } } },
            },
          },
        })
      : null,
  ]);

  const rows = families
    .map((f) => ({ ...f, stage: familyStage(f.students, f.appointments) }))
    .filter((f) => !stage || f.stage === stage);

  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<FamilyStage, number>;
  for (const f of families) counts[familyStage(f.students, f.appointments)]++;

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: q || undefined, etapa: stage, ...extra })) if (v) p.set(k, v);
    return p.toString();
  };

  const detailStage = detail ? familyStage(detail.students, detail.appointments) : null;

  return (
    <>
      <PageHeader
        title="Famílias"
        description="Cadastro formado a partir dos agendamentos. O e-mail de quem agenda identifica a família em toda a jornada, até a matrícula."
      />

      <div className="flex flex-wrap gap-2">
        <Link href={`?${qs({ etapa: undefined })}`}>
          <Badge variant={stage ? "muted" : "default"}>Todas · {families.length}</Badge>
        </Link>
        {STAGES.map((s) => (
          <Link key={s} href={`?${qs({ etapa: s })}`}>
            <Badge variant={stage === s ? STAGE_VARIANT[s] : "muted"}>{STAGE_LABEL[s]} · {counts[s]}</Badge>
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3" action="/novos-alunos/familias">
        {stage && <input type="hidden" name="etapa" value={stage} />}
        <Field label="Buscar por e-mail, responsável ou aluno" className="min-w-64 flex-1">
          <Input name="q" defaultValue={q} placeholder="Ex.: maria@email.com" />
        </Field>
        <Button type="submit">Buscar</Button>
        {q && <Button asChild variant="ghost"><Link href={`?${qs({ q: undefined })}`}>Limpar</Link></Button>}
      </form>

      {detail && detailStage && (
        <Card className="border-primary/40">
          <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{detail.email}</CardTitle>
              <p className="mt-1 text-sm text-secondary">Família desde {fmtDate(detail.createdAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STAGE_VARIANT[detailStage]}>{STAGE_LABEL[detailStage]}</Badge>
              <Button asChild variant="ghost" size="sm"><Link href={`?${qs({})}`}>Fechar</Link></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* Responsáveis */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Responsáveis</h3>
              <ul className="space-y-2">
                {detail.guardians.map((g) => (
                  <li key={g.id} className="rounded-lg border p-3 text-sm border-surface-medium">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{g.name}</span>
                        {g.isPrimary && <Badge><Star className="mr-1 size-3" aria-hidden="true" />Principal</Badge>}
                        {g.relationship && <span className="text-secondary">{g.relationship}</span>}
                        {g.phone && <span className="text-secondary">{formatPhone(g.phone)}</span>}
                        {g.email && <span className="text-secondary">{g.email}</span>}
                        <span className="ml-auto text-xs font-semibold text-primary">Editar</span>
                      </summary>
                      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_auto]">
                        <ActionForm action={saveGuardianAction} className="grid gap-3 sm:grid-cols-2">
                          <input type="hidden" name="familyId" value={detail.id} />
                          <input type="hidden" name="guardianId" value={g.id} />
                          <GuardianFields g={g} />
                          <SubmitButton size="sm" className="sm:w-fit">Salvar</SubmitButton>
                        </ActionForm>
                        {g._count.appointments === 0 && !g.activesoftId && (
                          <ActionForm action={deleteGuardianAction} className="self-end">
                            <input type="hidden" name="familyId" value={detail.id} />
                            <input type="hidden" name="guardianId" value={g.id} />
                            <SubmitButton size="sm" variant="destructive" pendingText="Removendo…">Remover</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
              <details className="rounded-lg border border-dashed p-3 text-sm border-surface-medium">
                <summary className="cursor-pointer font-semibold text-primary">+ Adicionar responsável</summary>
                <ActionForm action={saveGuardianAction} resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="familyId" value={detail.id} />
                  <GuardianFields />
                  <SubmitButton size="sm" className="sm:w-fit">Adicionar</SubmitButton>
                </ActionForm>
              </details>
            </section>

            {/* Alunos */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Alunos</h3>
              <ul className="space-y-2">
                {detail.students.map((s) => (
                  <li key={s.id} className="rounded-lg border p-3 text-sm border-surface-medium">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{s.name}</span>
                        {s.studentClass && <span className="text-secondary">{s.studentClass}</span>}
                        {s.birthDate && <span className="text-secondary">nasc. {fmtDate(s.birthDate)}</span>}
                        {s.enrolledAt ? <Badge variant="success">Matriculado em {fmtDate(s.enrolledAt)}</Badge> : <Badge variant="muted">Não matriculado</Badge>}
                        <span className="ml-auto text-xs font-semibold text-primary">Editar</span>
                      </summary>
                      <ActionForm action={saveStudentAction} className="mt-3 grid gap-3 sm:grid-cols-3">
                        <input type="hidden" name="familyId" value={detail.id} />
                        <input type="hidden" name="studentId" value={s.id} />
                        <Field label="Nome completo"><Input name="name" defaultValue={s.name} required /></Field>
                        <Field label="Turma / série pretendida"><Input name="studentClass" defaultValue={s.studentClass ?? ""} maxLength={40} /></Field>
                        <Field label="Data de nascimento">
                          <Input name="birthDate" type="date" defaultValue={s.birthDate ? s.birthDate.toISOString().slice(0, 10) : ""} max={dateKey(new Date())} />
                        </Field>
                        <SubmitButton size="sm" className="sm:w-fit">Salvar</SubmitButton>
                      </ActionForm>
                    </details>
                  </li>
                ))}
              </ul>
              {detailStage === "ANAMNESE_REALIZADA" && (
                <Alert>Anamnese realizada. A matrícula ainda é feita no Activesoft; o envio a partir daqui está em definição.</Alert>
              )}
            </section>

            {/* Agendamentos */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Anamneses</h3>
              {detail.appointments.length === 0 ? (
                <p className="text-sm text-secondary">Nenhum agendamento ligado a esta família.</p>
              ) : (
                <Table>
                  <thead>
                    <tr><Th>Código</Th><Th>Aluno</Th><Th>Segmento</Th><Th>Psicóloga</Th><Th>Data</Th><Th>Status</Th></tr>
                  </thead>
                  <tbody>
                    {detail.appointments.map((a) => (
                      <tr key={a.id} className={a.status === "CANCELLED" ? "opacity-60" : ""}>
                        <Td>
                          <Link className="font-semibold text-primary hover:underline" href={`/novos-alunos/agendamentos?q=${encodeURIComponent(a.code)}&ver=${a.id}`}>{a.code}</Link>
                        </Td>
                        <Td>{a.student?.name ?? a.studentName}</Td>
                        <Td>{a.segment.name}</Td>
                        <Td>{a.psychologist.name}</Td>
                        <Td className="whitespace-nowrap">{fmtDate(a.startsAt)} · {fmtTime(a.startsAt)}</Td>
                        <Td><AppointmentStatusBadge status={a.status} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </section>

            {/* Observações */}
            <ActionForm action={saveFamilyNotesAction} className="space-y-2">
              <input type="hidden" name="familyId" value={detail.id} />
              <Field label="Observações da equipe">
                <Textarea name="notes" defaultValue={detail.notes ?? ""} maxLength={2000} rows={3} />
              </Field>
              <div className="flex items-center gap-3">
                <SubmitButton size="sm" variant="outline">Salvar observações</SubmitButton>
                <span className="text-xs text-secondary">Atualizado em {fmtDateTime(detail.updatedAt)}</span>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState>{q || stage ? "Nenhuma família encontrada para o filtro." : "Ainda não há famílias. Elas aparecem aqui a cada novo agendamento."}</EmptyState>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr><Th>E-mail</Th><Th>Responsáveis</Th><Th>Alunos</Th><Th>Etapa</Th><Th>Última anamnese</Th><Th /></tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <Td className="font-medium">{f.email}</Td>
                  <Td>{f.guardians.map((g) => g.name).join(", ") || "—"}</Td>
                  <Td>{f.students.map((s) => s.name).join(", ") || "—"}</Td>
                  <Td><Badge variant={STAGE_VARIANT[f.stage]}>{STAGE_LABEL[f.stage]}</Badge></Td>
                  <Td className="whitespace-nowrap">{f.appointments[0] ? fmtDate(f.appointments[0].startsAt) : "—"}</Td>
                  <Td><Link className="font-semibold text-primary hover:underline" href={`?${qs({ ver: f.id })}`}>Detalhes</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {families.length === 300 && <Alert>Mostrando as 300 famílias com movimento mais recente. Use a busca para encontrar as demais.</Alert>}
    </>
  );
}

const RELATIONSHIPS = ["Mãe", "Pai", "Avó", "Avô", "Tia", "Tio", "Madrasta", "Padrasto", "Responsável legal", "Outro"];

function GuardianFields({ g }: { g?: { name: string; phone: string | null; email: string | null; relationship: string | null; isPrimary: boolean } }) {
  return (
    <>
      <Field label="Nome completo"><Input name="name" defaultValue={g?.name} required /></Field>
      <Field label="Parentesco">
        <Select name="relationship" defaultValue={g?.relationship ?? ""}>
          <option value="">—</option>
          {[...new Set([...RELATIONSHIPS, ...(g?.relationship ? [g.relationship] : [])])].map((r) => <option key={r}>{r}</option>)}
        </Select>
      </Field>
      <Field label="Telefone"><Input name="phone" defaultValue={g?.phone ?? ""} placeholder="81 99999-0000" /></Field>
      <Field label="E-mail"><Input name="email" type="email" defaultValue={g?.email ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="isPrimary" defaultChecked={g?.isPrimary} /> Responsável principal
      </label>
    </>
  );
}
