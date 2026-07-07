# Deploy — Sistema de Gestão Editorial (Ecco Prime)

> Hospedagem na **Vercel** (Next.js) + **Supabase** já hospedado (DB/Auth/Realtime).
> GitHub = fonte de verdade: `github.com/davidfarc/sistema_gestao`.

## ✅ Estado atual (no ar)

- **Produção:** https://ecco-sistema.vercel.app
- **Projeto Vercel:** `eccoprime/ecco-sistema` (time `eccoprime`), **Root Directory = `apps/web`**.
- **Variáveis** (Production) já configuradas: as 4 abaixo.
- **Supabase Auth** já apontado para a URL de produção (Site URL + Redirect URLs com wildcard,
  mantendo `localhost`).
- **Deploy feito via CLI** a partir da **raiz do repo** (sobe o monorepo pnpm inteiro).

**Redeploy (após mudanças locais):** na raiz, com a Vercel CLI logada:
```
vercel deploy --prod --scope eccoprime --yes
```
Ou conectar o GitHub ao projeto (Settings → Git) para **deploy automático a cada push**.

⚠️ Migrations **não** rodam no deploy — aplicar à parte (ver §Notas).

---


## Visão geral

- **Frontend/SSR:** Vercel builda o `apps/web` a partir do GitHub (monorepo pnpm).
- **Backend:** Supabase (Postgres + Auth + Realtime), já no ar (`njdocgzzuhhlaweqqnrq`).
- **OAuth:** o app manda o Google via Supabase; o redirect final volta pro app. O código
  usa o domínio da requisição (`window.location.origin`), então **funciona em qualquer
  domínio** — só precisa liberar o domínio no allow-list do Supabase (o Google Cloud **não**
  muda, pois o redirect dele aponta pro Supabase).

## 1. Vercel — criar o projeto

1. Em vercel.com → **Add New → Project** → importar `davidfarc/sistema_gestao`.
2. Configurar:
   - **Framework Preset:** Next.js
   - **Root Directory:** `apps/web`  ← (monorepo; a Vercel instala o workspace inteiro)
   - Build/Install/Output: deixar o padrão detectado (pnpm). `@ecco/core` é transpilado
     pelo Next (`transpilePackages`), sem build separado.
3. **NÃO** clicar em Deploy ainda — primeiro as variáveis de ambiente (passo 2).

## 2. Variáveis de ambiente (Vercel → Settings → Environment Variables)

Adicionar as 4 abaixo em **Production** e **Preview**. Os valores estão no seu
`apps/web/.env.local` (ou no painel do Supabase → Settings → API).

| Nome | Onde pegar | Exposição |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → API → Project URL | pública |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → anon/publishable key | pública |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → **service_role** (secreta!) | **secreta** — só server |
| `INTERNAL_EMAIL_DOMAIN` | `adm.eccoprime.com.br,editoraeccoprime.com.br` | server |

> ⚠️ A `service_role` bypassa RLS — nunca colocar em variável `NEXT_PUBLIC_*`.

Depois de salvar as 4, clicar em **Deploy**. Anotar a URL gerada (ex.:
`https://sistema-gestao.vercel.app`).

## 3. Supabase Auth — liberar o domínio de produção

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://<seu-app>.vercel.app`
- **Redirect URLs:** adicionar `https://<seu-app>.vercel.app/**`
  (e manter `http://localhost:3000/**` para o dev)

> O provider Google já está configurado; o redirect dele aponta pro Supabase
> (`https://njdocgzzuhhlaweqqnrq.supabase.co/auth/v1/callback`) e **não muda**.

## 4. Primeiro acesso e verificação

1. Abrir a URL de produção → **Entrar com Google** com uma conta **interna**
   (`@adm.eccoprime.com.br` ou `@editoraeccoprime.com.br`).
2. O 1º interno sem Gestor vira **Gestor** (bootstrap). Confirmar que o quadro abre.
3. Testar: criar card, mover, comentar, abrir a visão expandida, Conversas em tempo real
   (2 navegadores), sino de notificações.

## 5. Onboarding dos testadores externos

- Externos entram com **qualquer conta Google**, mas só veem o que lhes for atribuído (RLS).
- Fluxo p/ dar acesso a um externo:
  1. (Opcional) Gestor pré-cadastra em **Configurações → Usuários → Adicionar usuário**
     (acesso *externo*), ou o externo loga uma vez e é provisionado.
  2. No card, definir o externo como **responsável** de uma etapa (isso cria o `assignment`
     que dá visibilidade). Sem assignment, o externo não vê o card.
- **Gestor de área:** dar o papel em Usuários e incluí-lo nos pipelines certos via
  **quadro → seletor de pipeline → Membros**.

## 6. Domínio próprio (opcional, depois)

Vercel → Settings → Domains → adicionar (ex.: `sistema.editoraeccoprime.com.br`) e apontar o
CNAME. Depois, **repetir o passo 3** (Site URL + Redirect URLs) com o novo domínio.

## Notas

- Migrations continuam manuais via `node --env-file=.env infra/run-sql.mjs <arquivo>` (pooler).
  A Vercel **não** roda migrations — o schema é gerido à parte.
- Uma máquina por vez para o histórico git; a Vercel builda do GitHub (não do disco local).
