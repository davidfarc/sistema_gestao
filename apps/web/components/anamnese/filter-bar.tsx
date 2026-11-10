import Link from "next/link";
import type { SchoolSegment, Psychologist } from "@prisma/client";
import { Button } from "@/components/anamnese/ui/button";
import { Input, Select } from "@/components/anamnese/ui/form";
import type { Filters } from "@/lib/anamnese/queries";

const PERIODS = [
  ["hoje", "Hoje"],
  ["semana", "Esta semana"],
  ["mes", "Este mês"],
  ["personalizado", "Período personalizado"],
  ["todos", "Todo o histórico"],
] as const;

const STATUS = [
  ["", "Todos os status"],
  ["CONFIRMED", "Confirmado"],
  ["COMPLETED", "Realizado"],
  ["NO_SHOW", "Não compareceu"],
  ["CANCELLED", "Cancelado"],
] as const;

/** Filtros por GET (links compartilháveis, sem JavaScript). */
export function FilterBar({
  f, segments, psychologists, showPsychologist = true, showStatus = true, showSearch = true, action,
}: {
  f: Filters;
  segments: Pick<SchoolSegment, "id" | "name">[];
  psychologists: Pick<Psychologist, "id" | "name">[];
  showPsychologist?: boolean;
  showStatus?: boolean;
  showSearch?: boolean;
  action: string;
}) {
  return (
    <form action={action} className="grid gap-3 rounded-lg border bg-surface-lowest p-4 sm:grid-cols-2 lg:grid-cols-4 border-surface-medium">
      <label className="space-y-1 text-xs font-medium text-secondary">Período
        <Select name="periodo" defaultValue={f.period} className="text-primary">
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </label>
      <label className="space-y-1 text-xs font-medium text-secondary">De (personalizado)
        <Input type="date" name="de" defaultValue={f.period === "personalizado" ? f.from : ""} className="text-primary" />
      </label>
      <label className="space-y-1 text-xs font-medium text-secondary">Até (personalizado)
        <Input type="date" name="ate" defaultValue={f.period === "personalizado" ? f.to : ""} className="text-primary" />
      </label>
      <label className="space-y-1 text-xs font-medium text-secondary">Segmento
        <Select name="segmento" defaultValue={f.segmentId ?? ""} className="text-primary">
          <option value="">Todos os segmentos</option>
          {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </label>
      {showPsychologist && (
        <label className="space-y-1 text-xs font-medium text-secondary">Psicóloga
          <Select name="psicologa" defaultValue={f.psychologistId ?? ""} className="text-primary">
            <option value="">Todas as psicólogas</option>
            {psychologists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </label>
      )}
      {showStatus && (
        <label className="space-y-1 text-xs font-medium text-secondary">Status
          <Select name="status" defaultValue={f.status ?? ""} className="text-primary">
            {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </label>
      )}
      {showSearch && (
        <label className="space-y-1 text-xs font-medium text-secondary">Buscar (aluno, responsável, código)
          <Input name="q" defaultValue={f.q ?? ""} className="text-primary" maxLength={80} />
        </label>
      )}
      <div className="flex items-end gap-2">
        <Button type="submit">Filtrar</Button>
        <Button asChild variant="ghost"><Link href={action}>Limpar</Link></Button>
      </div>
    </form>
  );
}
