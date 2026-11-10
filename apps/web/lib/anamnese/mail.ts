import { getCloudflareContext } from "@opennextjs/cloudflare";

// Envio de e-mails da central de anamneses pelo Cloudflare Email Service
// (binding `EMAIL` no wrangler.jsonc). Não há chave de API: o remetente
// precisa ser de um domínio habilitado em Email Sending no painel.
//
// Enquanto MAIL_FROM não estiver definido (ou o binding não existir),
// `mailConfigured()` é falso: as notificações ficam na fila (tabela
// Notification) e são enviadas pela rotina automática quando for ativado.

type SendEmail = {
  send(message: { from: string | { email: string; name?: string }; to: string; subject: string; html: string; text: string }): Promise<{ messageId: string }>;
};

function binding(): SendEmail | null {
  try {
    const { env } = getCloudflareContext() as unknown as { env: { EMAIL?: SendEmail } };
    return env.EMAIL ?? null;
  } catch {
    return null; // fora do Worker (build/scripts)
  }
}

/** "Nome <email@dominio>" ou só "email@dominio". */
function parseFrom(raw: string): { email: string; name?: string } {
  const m = raw.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2]! } : { email: raw.trim() };
}

export function mailConfigured(): boolean {
  return Boolean(process.env.MAIL_FROM && binding());
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const email = binding();
  const from = process.env.MAIL_FROM;
  if (!email || !from) throw new Error("Envio de e-mail não configurado (MAIL_FROM e domínio em Email Sending).");
  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  await email.send({ from: parseFrom(from), to, subject, html, text });
}
