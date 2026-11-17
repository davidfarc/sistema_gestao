/**
 * Telefone no formato internacional (E.164), a chave que identifica a pessoa no
 * WhatsApp. Aceita o jeito brasileiro de escrever ("(84) 99999-8888",
 * "84 99999 8888", "+55 84 99999-8888") e devolve "+5584999998888".
 * Número de outro país só com o "+" na frente. Devolve null se não der para ler.
 */
export function normalizePhone(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  // Brasil: DDD (2) + número (8 fixo ou 9 celular); "55" e o "0" de operadora são opcionais.
  let national = digits.replace(/^0+/, "");
  if (national.length > 11 && national.startsWith("55")) national = national.slice(2);
  if (national.length !== 10 && national.length !== 11) return null;
  if (national[0] === "0") return null;
  return `+55${national}`;
}

/** "+5584999998888" → "(84) 99999-8888"; outros países ficam como estão. */
export function formatPhone(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/**
 * O WhatsApp identifica celulares brasileiros antigos sem o 9 inicial. Devolve
 * as formas equivalentes de um número, para casar o remetente com o cadastro.
 */
export function phoneVariants(e164: string): string[] {
  const m = /^\+55(\d{2})(\d{8,9})$/.exec(e164);
  if (!m) return [e164];
  const [, ddd, rest] = m;
  if (rest!.length === 9 && rest![0] === "9") return [e164, `+55${ddd}${rest!.slice(1)}`];
  if (rest!.length === 8 && /[6-9]/.test(rest![0]!)) return [e164, `+55${ddd}9${rest}`];
  return [e164];
}
