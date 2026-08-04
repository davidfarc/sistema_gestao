/**
 * Filtros por propriedade, no modelo do Notion: escolhe-se a propriedade, a
 * condição e o valor. Lógica pura — roda no cliente, sem ida ao servidor.
 */

import type { FieldDef, FieldType, FieldValueRaw } from "./types";

export type FilterOp =
  | "contains"
  | "not_contains"
  | "is"
  | "is_not"
  | "gt"
  | "lt"
  | "before"
  | "after"
  | "is_empty"
  | "is_not_empty"
  | "is_checked"
  | "is_unchecked";

export interface PropFilter {
  /** Chave local (React) — não persiste. */
  id: string;
  fieldId: string;
  op: FilterOp;
  /** Sempre string; interpretada conforme o tipo do campo. */
  value: string;
}

const OP_LABEL: Record<FilterOp, string> = {
  contains: "contém",
  not_contains: "não contém",
  is: "é",
  is_not: "não é",
  gt: "maior que",
  lt: "menor que",
  before: "antes de",
  after: "depois de",
  is_empty: "está vazio",
  is_not_empty: "não está vazio",
  is_checked: "está marcado",
  is_unchecked: "não está marcado",
};

/** Condições disponíveis para cada tipo de propriedade. */
export function opsFor(type: FieldType): { op: FilterOp; label: string }[] {
  const empty: FilterOp[] = ["is_empty", "is_not_empty"];
  let ops: FilterOp[];
  switch (type) {
    case "checkbox":
      ops = ["is_checked", "is_unchecked"];
      break;
    case "number":
      ops = ["is", "is_not", "gt", "lt", ...empty];
      break;
    case "date":
      ops = ["is", "before", "after", ...empty];
      break;
    case "select":
    case "status":
    case "member":
      ops = ["is", "is_not", ...empty];
      break;
    default: // text, long_text, link
      ops = ["contains", "not_contains", "is", ...empty];
  }
  return ops.map((op) => ({ op, label: OP_LABEL[op] }));
}

/** A condição precisa de um valor digitado/escolhido? */
export function opNeedsValue(op: FilterOp): boolean {
  return !["is_empty", "is_not_empty", "is_checked", "is_unchecked"].includes(op);
}

/** Primeira condição válida para o tipo — usada ao trocar de propriedade. */
export function defaultOp(type: FieldType): FilterOp {
  return opsFor(type)[0]!.op;
}

/** O valor "cru" do campo, normalizado para comparação. */
function rawOf(field: FieldDef, v: FieldValueRaw | undefined): string | number | boolean | null {
  if (!v) return null;
  switch (field.type) {
    case "checkbox":
      return v.bool ?? false;
    case "number":
      return v.number;
    case "date":
      return v.date;
    case "member":
      return v.memberId;
    default:
      return v.text; // select/status guardam o id da opção aqui
  }
}

function isEmpty(raw: string | number | boolean | null): boolean {
  return raw === null || raw === undefined || raw === "";
}

/** Um card passa neste filtro? */
export function matchesFilter(
  field: FieldDef,
  value: FieldValueRaw | undefined,
  filter: PropFilter,
): boolean {
  const raw = rawOf(field, value);

  switch (filter.op) {
    case "is_empty":
      return isEmpty(raw);
    case "is_not_empty":
      return !isEmpty(raw);
    case "is_checked":
      return raw === true;
    case "is_unchecked":
      return raw !== true;
  }

  if (!filter.value) return true; // filtro incompleto não restringe

  switch (filter.op) {
    case "contains":
      return String(raw ?? "").toLowerCase().includes(filter.value.toLowerCase());
    case "not_contains":
      return !String(raw ?? "").toLowerCase().includes(filter.value.toLowerCase());
    case "is":
      if (field.type === "number") return Number(raw) === Number(filter.value);
      return String(raw ?? "").toLowerCase() === filter.value.toLowerCase();
    case "is_not":
      return String(raw ?? "").toLowerCase() !== filter.value.toLowerCase();
    case "gt":
      return raw != null && Number(raw) > Number(filter.value);
    case "lt":
      return raw != null && Number(raw) < Number(filter.value);
    case "before":
      return typeof raw === "string" && raw !== "" && raw < filter.value;
    case "after":
      return typeof raw === "string" && raw !== "" && raw > filter.value;
    default:
      return true;
  }
}
