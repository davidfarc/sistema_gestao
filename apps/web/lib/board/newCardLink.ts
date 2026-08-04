/**
 * Endereço do formulário de criação de card.
 *
 * O link diz apenas "abra o formulário de criação deste pipeline" — nunca
 * QUAL dos formulários (simples, genérico ou especializado). Quem decide é o
 * `creation_form` do pipeline, lido no servidor a cada abertura. Por isso:
 *
 * - um pipeline novo, com formulário especializado próprio (outra escola, outro
 *   fluxo), ganha link compartilhável sem uma linha de código a mais;
 * - trocar o modo do pipeline depois não invalida os atalhos já cadastrados.
 *
 * Módulo puro de propósito: o cadastro de atalhos (client) e o quadro (client)
 * montam o mesmo endereço a partir daqui, sem duplicar a convenção.
 */

/** Nome do parâmetro que abre o formulário. */
export const NOVO_PARAM = "novo";

/** Link do formulário de criação de um pipeline. */
export function newCardHref(boardId: string): string {
  return `/board?board=${boardId}&${NOVO_PARAM}=1`;
}

/** Reconhece um link de formulário e devolve o pipeline; null se não for um. */
export function parseNewCardHref(href: string): string | null {
  const m = /^\/board\?board=([^&]+)&novo=1$/.exec(href.trim());
  return m?.[1] ?? null;
}
