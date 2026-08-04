/** Atalho da tela Início — aponta para um pipeline ou para fora. */
export interface ShortcutView {
  id: string;
  label: string;
  description: string | null;
  href: string;
  icon: string | null;
  position: number;
}

/** Ícones oferecidos no cadastro (lista curada, para não virar campo livre). */
export const SHORTCUT_ICONS = [
  "Link",
  "ExternalLink",
  "KanbanSquare",
  "FileText",
  "BookOpen",
  "Presentation",
  "Palette",
  "BarChart3",
  "Users",
  "ShoppingCart",
  "GraduationCap",
  "Folder",
] as const;

export type ShortcutIcon = (typeof SHORTCUT_ICONS)[number];

/** Link externo abre em nova aba; caminho interno navega na mesma. */
export function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/** Normaliza o destino: sem protocolo e sem "/" inicial, assume link externo. */
export function normalizeHref(raw: string): string {
  const t = raw.trim();
  if (t === "") return t;
  if (t.startsWith("/") || isExternal(t)) return t;
  return `https://${t}`;
}
