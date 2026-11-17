/**
 * Sincronização de propriedades entre pipelines (origem → destino), para que
 * um card enviado de um para o outro encontre cada valor no seu lugar.
 *
 * Só ACRESCENTA no destino: cria a propriedade que falta e, nas de opção,
 * as opções que faltam. Nunca apaga, renomeia nem troca tipo. A regra de
 * "mesma propriedade" é a mesma do envio de card: nome igual (sem diferenciar
 * maiúsculas) e tipo compatível; opções casam pelo rótulo.
 */

export interface SyncOption {
  id: string;
  label: string;
  color: string;
}

export interface SyncField {
  id: string;
  name: string;
  type: string;
  options: SyncOption[];
}

export interface FieldSyncPlan {
  /** Propriedades da origem que não existem no destino. */
  create: SyncField[];
  /** Opções a acrescentar em propriedades de opção que já existem no destino. */
  addOptions: { targetId: string; name: string; options: SyncOption[] }[];
  /** Mesmo nome, tipo incompatível: fica como está (decisão da gestão). */
  conflicts: { name: string; sourceType: string; targetType: string }[];
  /** Já estavam iguais. */
  unchanged: number;
}

const key = (s: string) => s.trim().toLowerCase();
const TEXT = ["text", "long_text"];
const CHOICE = ["select", "status"];

export function compatibleFieldTypes(a: string, b: string): boolean {
  if (a === b) return true;
  return (TEXT.includes(a) && TEXT.includes(b)) || (CHOICE.includes(a) && CHOICE.includes(b));
}

/** Próximo id posicional livre ("opt0", "opt1"…), sem repetir nenhum existente. */
export function nextOptionIds(existing: SyncOption[], count: number): string[] {
  const used = new Set(existing.map((o) => o.id));
  let n = existing.reduce((max, o) => {
    const m = /^opt(\d+)$/.exec(o.id);
    return m ? Math.max(max, Number(m[1]) + 1) : max;
  }, existing.length);
  const ids: string[] = [];
  while (ids.length < count) {
    const id = `opt${n++}`;
    if (!used.has(id)) ids.push(id);
  }
  return ids;
}

export function planFieldSync(source: SyncField[], target: SyncField[]): FieldSyncPlan {
  const plan: FieldSyncPlan = { create: [], addOptions: [], conflicts: [], unchanged: 0 };
  const taken = new Set<string>();
  for (const s of source) {
    const sameName = target.filter((t) => !taken.has(t.id) && key(t.name) === key(s.name));
    const match = sameName.find((t) => compatibleFieldTypes(s.type, t.type));
    if (!match) {
      if (sameName[0]) plan.conflicts.push({ name: s.name, sourceType: s.type, targetType: sameName[0].type });
      else plan.create.push(s);
      continue;
    }
    taken.add(match.id);
    if (!CHOICE.includes(s.type)) {
      plan.unchanged += 1;
      continue;
    }
    const have = new Set(match.options.map((o) => key(o.label)));
    const missing = s.options.filter((o) => !have.has(key(o.label)));
    if (missing.length === 0) {
      plan.unchanged += 1;
      continue;
    }
    const ids = nextOptionIds(match.options, missing.length);
    plan.addOptions.push({
      targetId: match.id,
      name: match.name,
      options: missing.map((o, i) => ({ id: ids[i]!, label: o.label, color: o.color })),
    });
  }
  return plan;
}
