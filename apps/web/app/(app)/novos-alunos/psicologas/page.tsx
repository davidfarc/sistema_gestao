import { requireUser } from "@/lib/anamnese/auth";
import { prisma } from "@/lib/anamnese/db";
import { PageHeader } from "@/components/anamnese/page-header";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/anamnese/ui/card";
import { ActionForm } from "@/components/anamnese/action-form";
import { SubmitButton } from "@/components/anamnese/submit-button";
import { Field, Input } from "@/components/anamnese/ui/form";
import { createPsychologistAction, deletePsychologistAction, updatePsychologistAction } from "@/lib/anamnese/server/admin-actions";

export const metadata = { title: "Psicólogas" };

const checkbox = "size-4 accent-[hsl(var(--primary))]";

export default async function PsychologistsPage() {
  await requireUser(["ADMIN"]);
  const [list, segments] = await Promise.all([
    prisma.psychologist.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, include: { segments: true } }),
    prisma.schoolSegment.findMany({ where: { deletedAt: null, active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Psicólogas" description="Cada psicóloga tem acesso individual e vê apenas a própria agenda." />

      <Card>
        <CardHeader>
          <CardTitle>Nova psicóloga</CardTitle>
          <CardDescription>Cria o acesso de login e a associação aos segmentos.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createPsychologistAction} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome completo"><Input name="name" required /></Field>
            <Field label="E-mail (login e notificações)"><Input name="email" type="email" required /></Field>
            <Field label="Telefone (opcional)"><Input name="phone" /></Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">O acesso é pelo login Google do sistema, com este e-mail. Não há senha.</p>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">Segmentos atendidos</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {segments.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="segmentIds" value={s.id} className={checkbox} />
                    {s.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="canViewOthers" className={checkbox} /> Autorizar visualizar dados administrativos das demais psicólogas
            </label>
            <SubmitButton className="sm:w-fit">Cadastrar psicóloga</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {list.map((p) => {
          const mine = new Set(p.segments.map((s) => s.segmentId));
          return (
            <Card key={p.id}>
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-5">
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{p.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {segments.filter((s) => mine.has(s.id)).map((s) => (
                      <Badge key={s.id}>{s.name}</Badge>
                    ))}
                    <Badge variant={p.active ? "success" : "muted"}>{p.active ? "Ativa" : "Inativa"}</Badge>
                  </div>
                </summary>
                <div className="grid gap-6 border-t p-5 lg:grid-cols-3">
                  <ActionForm action={updatePsychologistAction} className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
                    <input type="hidden" name="id" value={p.id} />
                    <Field label="Nome"><Input name="name" defaultValue={p.name} required /></Field>
                    <Field label="E-mail"><Input name="email" type="email" defaultValue={p.email} required /></Field>
                    <Field label="Telefone"><Input name="phone" defaultValue={p.phone ?? ""} /></Field>
                    <div className="space-y-2 sm:col-span-2">
                      <p className="text-sm font-medium">Segmentos</p>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {segments.map((s) => (
                          <label key={s.id} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name="segmentIds" value={s.id} defaultChecked={mine.has(s.id)} className={checkbox} />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="canViewOthers" defaultChecked={p.canViewOthers} className={checkbox} /> Pode ver dados das demais
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={p.active} className={checkbox} /> Ativa
                    </label>
                    <SubmitButton size="sm" className="sm:w-fit">Salvar alterações</SubmitButton>
                  </ActionForm>
                  <details className="rounded-md bg-muted/50 p-4 lg:col-start-3">
                    <summary className="cursor-pointer text-sm font-medium text-destructive">Excluir psicóloga</summary>
                    <ActionForm action={deletePsychologistAction} className="mt-3 space-y-2">
                      <input type="hidden" name="id" value={p.id} />
                      <p className="text-xs text-muted-foreground">
                        O acesso é encerrado, horários livres futuros são removidos e a conexão com o Google é apagada.
                        Só é possível se não houver agendamentos futuros. O histórico é mantido.
                      </p>
                      <SubmitButton size="sm" variant="destructive" pendingText="Excluindo…">Confirmar exclusão</SubmitButton>
                    </ActionForm>
                  </details>
                </div>
              </details>
            </Card>
          );
        })}
        {list.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma psicóloga cadastrada.</p>}
      </div>
    </>
  );
}
