import Link from "next/link";
import type { ReactNode } from "react";

// Referência a um card (gravada pelo servidor ao avisar de uma menção) ou um
// endereço http(s) colado na mensagem. Só esses dois viram link: o resto do
// texto é mostrado como texto, nunca como HTML.
const TOKEN = /(\/board\?card=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|https?:\/\/[^\s<>"']+)/gi;

/** Texto da mensagem, com link direto para o card citado. */
export function MessageBody({ body }: { body: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(body.slice(last, start));
    const token = m[0];
    if (token.startsWith("/board?card=")) {
      parts.push(
        <Link key={start} href={token} className="font-semibold text-primary underline">
          Abrir o card
        </Link>,
      );
    } else {
      parts.push(
        <a key={start} href={token} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">
          {token}
        </a>,
      );
    }
    last = start + token.length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <p className="whitespace-pre-wrap break-words text-sm text-neutral-700">{parts}</p>;
}
