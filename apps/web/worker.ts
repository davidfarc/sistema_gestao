// Entrada do Worker no Cloudflare: o app Next (gerado pelo OpenNext) mais a
// rotina agendada da central de anamneses ("Novos alunos").
//
// O cron (wrangler.jsonc → triggers.crons) chama, a cada 5 minutos, a mesma
// rota que o Render chamava: lembretes, fila de e-mails, sincronização com o
// Google Agenda e limpeza LGPD. A chamada é interna (não sai para a rede) e
// se autentica com o CRON_SECRET.

// Gerado no build pelo `opennextjs-cloudflare build` (arquivo fora do tsconfig do Next).
import { default as app } from "./.open-next/worker.js";

type Env = { APP_URL?: string; CRON_SECRET?: string };
type Ctx = { waitUntil(promise: Promise<unknown>): void };

export default {
  fetch: app.fetch,

  async scheduled(_event: unknown, env: Env, ctx: Ctx) {
    if (!env.CRON_SECRET) {
      console.warn("Rotina de Novos alunos ignorada: CRON_SECRET não configurado.");
      return;
    }
    const url = `${env.APP_URL ?? "https://ecco-sistema.dafarc.workers.dev"}/api/anamnese/cron/process`;
    const req = new Request(url, { method: "POST", headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
    ctx.waitUntil(
      app.fetch(req, env, ctx).then(async (res: Response) => {
        if (!res.ok) console.error("Rotina de Novos alunos falhou:", res.status, await res.text());
      }),
    );
  },
};
