# Próximos passos — retomada em outra máquina

> Guia para recomeçar o projeto do zero na nova máquina. O plano completo está em **`PLANO.md`** (mesma pasta). Registrado em 2026-07-06.

## Estado do ambiente (máquina anterior)

- **Pasta do projeto (vazia):** `G:\Drives compartilhados\EDITORA   ADM\Sistema` — decidido que o repositório mora **aqui, na pasta do Drive** (a pedido do usuário).
- **Instalado:** Git `2.55.0`; winget `1.29.280`.
- **NÃO instalado:** Node.js, npm, pnpm, corepack, nvm/fnm/volta. → **Bloqueou o scaffolding** (não dá pra criar/rodar o projeto sem Node).
- A instalação do Node foi **interrompida** para migrar de máquina.

⚠️ **Atenção com o Drive:** como o repo fica na pasta sincronizada, o Google Drive vai tentar sincronizar `node_modules` (muitos arquivos, churn alto). **Pausar a sincronização do Drive durante `pnpm install` e builds.** Se o Drive Desktop permitir, excluir `node_modules`/`.next` do sync.

## Checklist de retomada (rodar na ordem)

1. **Abrir** a pasta do projeto no Drive já sincronizada nesta máquina.
2. **Node.js** — checar: `node -v`. Se faltar:
   ```powershell
   winget install OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
   ```
   Aprovar o prompt do Windows (UAC) e **abrir um novo terminal** depois (pra carregar o PATH).
3. **pnpm** (via corepack, que vem com o Node):
   ```powershell
   corepack enable
   corepack prepare pnpm@latest --activate
   pnpm -v
   ```
4. **Contas/credenciais externas:**
   - **Supabase:** criar projeto na região **South America (São Paulo)**. Anotar `Project URL`, `anon key` e `service_role key` (essa é **secreta** — só no servidor, nunca no bundle do cliente).
   - **Google Cloud:** criar credencial **OAuth 2.0 (Web)** para o **Supabase Auth (Google)** (usar o redirect URL que o Supabase informa). Anotar Client ID/Secret. A classificação interno/externo é por domínio do e-mail (`@editoraeccoprime.com.br`) na lógica do app — não confiar só no `hd`.
5. **Scaffolding** (seguir o Roadmap **Fase 1** do `PLANO.md`):
   - `pnpm` workspace na raiz; `apps/web` (Next.js App Router + TS, Tailwind, shadcn/ui, dnd-kit, TanStack Table/Query, React Hook Form + Zod, lucide);
   - `packages/core` (domain / services / auth `policy.ts` / ports);
   - `packages/adapters/supabase`;
   - `infra/` (migrations SQL + policies RLS + seeds).
6. **Git:** criar `.gitignore` (node_modules, .next, .env*, build outputs) → `git init` (Git já disponível). **Fortemente recomendado: usar um repositório GitHub privado como fonte de verdade do histórico.** ⚠️ Cuidado: uma pasta `.git` **sincronizada pelo Drive entre máquinas pode corromper** o repositório — trabalhar em **uma máquina por vez**, deixar o GitHub guardar o histórico e o Drive guardar os arquivos de trabalho (com `git push`/`pull` para transferir, não o sync do Drive).

## Dados para seed (extraídos das imagens de referência)

**Equipes (raias do BPMN):** Direção pedagógica · Coordenação pedagógica · Coordenação editorial · Apoio pedagógico · Apoio editorial (NAI) · Diagramação · Autor · Revisor externo. _(+ Administrativo para ISBN/burocracia.)_

**Etapas do pipeline (colunas do quadro, ordem do BPMN):**
1. Comunicação da demanda
2. Elaboração do documento da demanda
3. Produção do sumário
4. Validação do sumário
5. Escrita do livro
6. Revisão de área
7. Reescrita
8. Diagramação 1
9. Revisão 1
10. Avaliação do manuscrito
11. Supervisão da produção da 1ª emenda
12. Diagramação 2
13. Revisão 2
14. Revisão editorial
15. Diagramação 3
16. Revisão Coordenação
17. Revisão final
18. Ajuste da versão final
19. Catálogo → (Gráfica)

Gate de decisão no meio do fluxo: **"Necessita de ajuste?"** (Sim → volta para reescrita/ajuste; Não → segue). Esses gates devem ser **configuráveis** (ver `workflow_rule` no PLANO.md).

**Documentos/marcos que trafegam:** Escopo · Sumário · Manuscrito · Versão 1 · Emenda 1 · Emenda 2 · Versão final.

**Modelo do card (Trello atual, a reproduzir):** código tipo `TEX-7A-FUND2-1B-2027` (matéria-série-segmento-bimestre-ano) · etiqueta de pessoa · anexos = **links do Google Drive** (1ª/2ª Emenda, bimestre) · **checklists de etapa** (ex.: "Revisão": revisão interna → enviado p/ autor-reescrita → enviado p/ diagramação → Revisão [pessoa]; e "Feito por [pessoa]") · feed de atividade.

**Taxonomia (exemplos):**
- **Segmentos:** Infantil, Fundamental 1, Fundamental 2, Médio.
- **Matérias:** Português, Matemática, Ciências, História, Geografia, Produção de Texto (TEX), Artes.
- **Bimestres:** 1–4 (usar `0` = anual para volume único, como Artes).
- **Agregação de volume varia por segmento** (configurável via `volume_card`): Infantil = Português/Matemática/Ciências; Fundamental 1 agrega História/Geografia/Produção de Texto/Artes; Fundamental 2 muda de novo.

## Pendências a detalhar (não bloqueiam o MVP)

- Nº de pessoas por equipe.
- Regra exata de agregação de volumes por segmento.
- Lista definitiva de matérias em **volume único** vs **divididas em 4**.
- Significado de eventuais outros prefixos de código além de `TEX` (se houver).
