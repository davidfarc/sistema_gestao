import type { FieldChip, FieldOption, FieldType, FieldValueRaw } from "./types";

/** O mínimo de uma propriedade para montar a etiqueta da face do card. */
export interface ChipField {
  id: string;
  name: string;
  type: FieldType;
  options: FieldOption[];
}

// Data "só dia" (AAAA-MM-DD): formata em UTC para dar o mesmo texto no servidor
// e no navegador (em São Paulo o fuso local mostraria o dia anterior).
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Etiqueta de uma propriedade na face do card, ou null se o valor está vazio.
 * Função pura, usada pelo servidor (ao carregar o quadro) e pelo navegador
 * (ao atualizar o card na tela sem recarregar o quadro).
 */
export function resolveChip(
  field: ChipField,
  raw: FieldValueRaw | undefined | null,
  nameOf: (userId: string) => string | undefined,
): FieldChip | null {
  if (!raw) return null;
  const base = { fieldId: field.id, name: field.name, type: field.type };
  switch (field.type) {
    case "text":
    case "long_text":
    case "link":
      return raw.text ? { ...base, display: String(raw.text).slice(0, 60), color: null } : null;
    case "number":
      return raw.number != null ? { ...base, display: String(raw.number), color: null } : null;
    case "date":
      return raw.date ? { ...base, display: formatDate(raw.date), color: null } : null;
    case "checkbox":
      return raw.bool ? { ...base, display: `✓ ${field.name}`, color: null } : null;
    case "member":
      return raw.memberId
        ? { ...base, display: nameOf(raw.memberId) ?? "?", color: null }
        : null;
    case "select":
    case "status": {
      const opt = field.options.find((o) => o.id === raw.text);
      return opt ? { ...base, display: opt.label, color: opt.color } : null;
    }
    default:
      return null;
  }
}
