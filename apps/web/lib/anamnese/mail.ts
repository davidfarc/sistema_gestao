// Envio de e-mails da central de anamneses.
//
// O original usava SMTP (nodemailer), que não roda no Cloudflare Workers. O
// envio passa a ser por API HTTP de um provedor transacional (definido na
// etapa de automações). Enquanto MAIL_API_KEY não estiver configurada,
// `mailConfigured()` é falso: as notificações ficam na fila (tabela
// Notification) e nada se perde — mesmo comportamento do original sem SMTP.
//
// Formato aceito hoje: API compatível com Resend (POST /emails, Bearer token).

const DEFAULT_ENDPOINT = "https://api.resend.com/emails";

function config() {
  return {
    apiKey: process.env.MAIL_API_KEY,
    endpoint: process.env.MAIL_API_URL ?? DEFAULT_ENDPOINT,
    from: process.env.MAIL_FROM ?? "Eccoprime <nao-responder@eccoprime.com.br>",
  };
}

export function mailConfigured(): boolean {
  return Boolean(config().apiKey);
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const c = config();
  if (!c.apiKey) throw new Error("Envio de e-mail não configurado (defina MAIL_API_KEY e MAIL_FROM).");
  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const res = await fetch(c.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: c.from, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar e-mail (${res.status}): ${body.slice(0, 300)}`);
  }
}
