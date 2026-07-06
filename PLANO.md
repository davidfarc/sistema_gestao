# Sistema de Gestão Editorial — Editora Ecco Prime

> **Cópia portável do plano aprovado** (2026-07-06). O original ficou em `~/.claude/plans/` na máquina anterior, que não sincroniza entre máquinas — este arquivo, dentro da pasta do Drive, é a fonte canônica. Stack decidida: **Supabase/Postgres + Next.js**. Ver também `PROXIMOS-PASSOS.md`.

## Contexto

A Editora Ecco Prime produz material didático (Infantil, Fundamental 1 e 2, Médio). A produção é organizada por **matéria × série × bimestre** e depois agregada em **volumes** por série (a criança recebe um volume com várias matérias = 1 de 4 bimestres). Algumas matérias vão em volume único anual (ex.: Arte), outras divididas em 4 (ex.: Matemática). Isso gera um **volume grande de produções paralelas** que percorrem um pipeline editorial (BPMN) até a gráfica.

**Problema atual:** a gestão é feita em **Trello** (kanban) + **PDFs no Google Drive** (comentários de revisão) + **WhatsApp** (comunicação informal, pouco profissional e não rastreável). Faltam: sistema próprio, acompanhamento por equipe, comunicação integrada e profissional, e uma base preparada para automação (API/MCP) e relatórios.

**Resultado desejado:** um sistema próprio, minimalista e rápido (modo diurno), com Kanban + lista, cards no modelo Trello atual (etiquetas, links do Drive, checklists de etapa), **comunicação nativa** (comentários + canais por equipe), **login Google** com acesso restrito para externos, e arquitetura **escalável e gerenciável via API/MCP** — preparada para depois integrar com o sistema existente em Next.js + Firebase e com o WhatsApp.

## Decisões confirmadas

| Tema | Decisão |
|---|---|
| **Modelo do card** | Modelo Trello atual: etiqueta de pessoa, **links do Google Drive** (emendas/bimestres), **checklists de etapa**, feed de atividade. Confirmado pela tela do card `TEX-7A-FUND2-1B-2027`. |
| **Unidade do card** | **Matéria × série × bimestre** (unidade atômica de produção). Volumes e séries são **agregações** desses cards. |
| **Quadros** | **Quadro único de pipeline** por safra/segmento; colunas = etapas configuráveis do BPMN; filtro por equipe/pessoa. Também com **visão de lista/tabela**. |
| **Comunicação** | **Nativa** no sistema: comentários por card + **canais por equipe/projeto** + @menções + notificações. **Incluída no MVP.** |
| **Acesso externo** | Autores e revisores externos entram via **Google (qualquer conta)**, mas com **acesso restrito** (só veem cards atribuídos a eles). Interno = domínio `@editoraeccoprime.com.br`. |
| **Gates/aprovações** | **Configuráveis pelo gestor** por etapa/transição (trava/destrava, exige anexo/checklist/aprovação), **editável em runtime**. Nada fixo no código. |
| **Campos/propriedades** | **Motor de campos customizados** (estilo Notion/ClickUp): gestor adiciona propriedade, escolhe o **tipo** (texto, seleção, data, número, pessoa, link, checkbox, status…) e se ela **aparece no card**. Definições por quadro. |
| **Emendas/PDF** | **Linkar do Drive** + registrar rodadas/status (1ª emenda, 2ª emenda, concluída). Gancho híbrido-evolutivo para, no futuro, estruturar emendas dentro do sistema. |
| **Stack** | **Supabase/Postgres + Next.js** (decidido após a modelagem). Restrições atendidas: integrar depois com o Next.js + Firebase existente; Google auth; pronto para API/MCP; seguro; escalável; entrega rápida; UI minimalista só modo diurno. |
| **Prioridades** | Velocidade de entrega > polimento de design. Segurança robusta. Arquitetura escalável e gerenciável via API/MCP (relatórios via WhatsApp depois). |

## Premissas confirmadas

1. **Nomenclatura** `TEX-7A-FUND2-1B-2027` = **Matéria (TEX = Produção de Texto) – 7º ano – Fundamental 2 – 1º Bimestre – 2027**. O `code` do card é gerado da taxonomia (matéria + série + segmento + bimestre + ano). → **Não há entidade "Tipo" separada**; TEX é o `code` da matéria. Um `material_type` opcional (livro do aluno vs. manual do professor) fica como gancho futuro, fora do MVP.
2. **Agregação de volumes é flexível e varia por segmento** — Infantil: Português/Matemática/Ciências; Fundamental 1 agrega História/Geografia/Produção de Texto/Artes; Fundamental 2 muda de novo. → Modelada pela junção **`volume_card` (M:N)** como **dado configurável**, nunca fixa no código. A UI de volumes fica fora do MVP; o gancho já entra na modelagem.
3. **Escala**: ~**60–100 cards** em backlog e ~**30 em produção** simultânea. Escala pequena → reforça **Supabase/Postgres** (sem necessidade de escala horizontal; custo de realtime trivial; SQL para relatórios). _A detalhar (não bloqueia): nº de pessoas por equipe._

---

## Arquitetura

**Padrão:** hexagonal-lite num monorepo pnpm. Toda a regra de negócio vive em `packages/core` (sem importar Next, React ou SDK de banco). Três "portas de entrada" — **Server Actions** (UI), **Route Handlers** `/api/v1` (REST, Fase 2) e **MCP tools** (Fase 2/3) — são adaptadores finos que chamam os **mesmos serviços** do `core`. É isso que entrega "UI + API + MCP sem retrabalho".

**Regras invioláveis:**
- `core` depende só de **interfaces (ports)**; o Supabase entra por um adaptador (`packages/adapters/supabase`) → stack reversível e integração futura com o Firebase por outro adaptador.
- **Toda escrita passa pelo servidor** (`core`), onde rodam `authorize()` + validação (Zod) + gates + auditoria. O cliente usa o **Supabase Realtime só para leitura** ao vivo.
- **Uma única `authorize(actor, action, resource)`** decide permissão; a UI só esconde por UX, o serviço é que barra.
- **Um único caminho de movimentação** (`CardService.move`) avalia os gates; o banco **bloqueia escrita direta do cliente** na etapa (RLS) → gate não-burlável.

```
UI (Next.js RSC/Client) ─┐
REST /api/v1 [P2] ───────┤→ packages/core (services + authorize + Zod + ports)
MCP tools [P2/3] ────────┘        │ (ports/interfaces)
                                  ├→ adapters/supabase     (Postgres + Realtime + Auth + Storage)
                                  ├→ adapters/google-drive (metadados de link)
                                  └→ adapters/whatsapp [P3]
```

**Estrutura de pastas (condensada):**
```
/ (pnpm workspace)
├─ packages/
│  ├─ core/       # domain/ services/ auth(policy.ts) ports/ ranking/ errors/  → @ecco/core
│  └─ adapters/   # supabase/  google-drive/  whatsapp[P3]/
├─ apps/
│  ├─ web/        # Next.js App Router: app/(boards/[id], cards/[id], channels/[id], settings/, inbox/),
│  │              #   actions/, api/(auth, v1[P2], webhooks/whatsapp[P3]), middleware.ts,
│  │              #   components/(board/, table/, fields/fieldRegistry, comments/, ui[shadcn]/)
│  └─ mcp/ [P2/3] # servidor MCP importando @ecco/core (1 tool por serviço)
└─ infra/         # migrations SQL, policies RLS, seeds
```

## Modelo de dados (Supabase/Postgres)

Convenção: `id uuid`, `created_at`, `updated_at`, soft-delete via `archived_at`; tudo `organization_id` (mono-tenant agora, barato pra crescer).

- **Taxonomia — entidades relacionais configuráveis** (nunca enum/hardcode): `segmento`, `serie` (code "7A"), `bimestre` (number 1–4, 0=anual), `materia` (code "TEX"=Produção de Texto), `ano_letivo` (safra). O `code` do card é **gerado** = matéria+série+segmento+bimestre+ano (`TEX-7A-FUND2-1B-2027`), guardado denormalizado pra busca.
- **Quadro & pipeline:** `board` (por safra/segmento, `card_face_config`), `stage` (colunas configuráveis = etapas do BPMN: `position`, `category`, `wip_limit`).
- **Card (unidade matéria×série×bimestre):** FKs de taxonomia denormalizadas (filtro/relatório indexado), `stage_id`, `stage_entered_at` (cycle-time), `position numeric` (índice fracionário), `priority`, `due_date`, `status`.
- **Volume (agregação — fora da UI do MVP, mas modelado):** `volume` + junção **`volume_card` (M:N)** = regra de agregação **configurável por segmento** (Infantil ≠ Fund1 ≠ Fund2); `isbn`/`printer_status` no volume.
- **Campos customizados (tabela tipada):** `field_definition` (board, `type`, `config` jsonb, `show_on_card_face`, `is_filterable`) + `field_value` (colunas tipadas `value_text/number/date/bool/member_id` + `value_json` p/ multi-select) com índices parciais → filtro/relatório indexável **e** configurável em runtime.
- **Checklists/anexos/emendas:** `checklist` + `checklist_item` (`assignee_id`, mirror do "Revisão [pessoa]"/"Feito por [pessoa]"); `attachment` (`kind: drive_link|emenda`, `url` do Drive); `emenda` (round + status: aberta/em revisão/enviada-autor/enviada-diagramação/concluída). `emenda_comment` (por página) **definido mas inativo no MVP** — gancho híbrido.
- **Comunicação:** `comment` (no card, `mentions[]`, thread `parent_id`), `channel` + `channel_member` (`last_read_at`) + `message` (mesma forma do comment → render/parse de menção compartilhados).
- **Acesso & pessoas:** `user` (espelho de `auth.users`, `is_internal` = domínio == org), `team` (raia BPMN), `role` (data-driven, `permissions` jsonb), e **`assignment` (card↔user↔stage)** — a linha que dá escopo ao externo.
- **Workflow & auditoria:** `workflow_rule` (por transição: `requirement` ∈ {checklist completo, anexo, campo preenchido, emenda concluída, aprovação, papel}, `enforcement: block|warn`, `is_active`), `approval`, `activity` (feed + auditoria append-only), `notification`.

**5 decisões estruturais (as mais caras de errar):** ① card = matéria×série×bimestre, volume como agregação M:N; ② taxonomia como entidades FK configuráveis; ③ campos custom em tabela tipada (não JSONB puro); ④ stage como linha (não enum); ⑤ um único `move_card` no servidor.

**Segurança (RLS = defesa em profundidade):** RLS ligado em tudo, deny-by-default. Leitura: interno vê o board; **externo vê o card só se houver `assignment` dele** (helper `can_see_card`). Escrita de etapa bloqueada no cliente → só o servidor move. `message`/`channel` só p/ membros. **404 (não 403)** em recurso não autorizado (não vaza existência).

## Stack recomendada

| Camada | Escolha |
|---|---|
| Backend | **Supabase** (Postgres + Auth + Realtime + Storage), região **South America (São Paulo)** p/ LGPD |
| App | **Next.js App Router + TypeScript**, monorepo **pnpm** (`@ecco/core`) |
| Auth | **Supabase Auth (Google)** — RLS enxerga `auth.uid()`; classificação interno/externo pelo domínio do e-mail |
| Realtime | **Supabase Realtime**, assinaturas escopadas por board/card/canal; UI otimista |
| Kanban/Tabela | **dnd-kit** (+ índice fracionário) e **TanStack Table** |
| UI | **Tailwind + shadcn/ui** (Radix), **lucide**, **React Hook Form + Zod**; minimalista, **só modo diurno** |
| Estado servidor | **TanStack Query** + ponte de realtime |
| Deploy | **Vercel** (ou host Node) |

Por quê Supabase (decidido): melhor encaixe pros dois requisitos difíceis — **campos custom consultáveis** e **relatórios/agregação em SQL** — e o **RLS** resolve o acesso externo no próprio banco. Escala pequena (30 em produção) elimina a vantagem de escala do Firebase. O Firebase atual segue e integra depois por webhook/REST (Fase 3).

## Roadmap por fases

**Fase 1 — MVP (núcleo + comunicação)** — ordem de construção:
1. `packages/core` + ports + adaptador Supabase; auth Google + classificação interno/externo + `middleware`.
2. Board + stage (seed das ~20 etapas do BPMN) + taxonomia + card + **Kanban** (dnd-kit/realtime, gates OFF) + **visão lista** (TanStack Table).
3. `assignment` + `authorize()` + **RLS** (interno total, externo escopado) + "meus cards".
4. **Comentários no card** + @menções + **notificações in-app** + feed de atividade (comms do MVP).
5. **Campos customizados** (definição + valor tipado + render no card/tabela via `fieldRegistry`).
6. Checklists + anexos (links Drive) + rastreio de rodada de emenda (status + link).
7. **Editor de workflow-rules** + gates ON (`CardService.move` aplica).
8. **Canais** por equipe/projeto + mensagens.
9. Auditoria consolidada + polimento minimalista.

**Fora do MVP:** API pública, MCP, WhatsApp, emenda estruturada por página, threads/reações, UI de volumes, presença/typing.

**Fase 2 — API + MCP + relatórios:** REST `/api/v1` (adaptadores finos, OpenAPI do Zod) · **MCP server** (`list_cards`, `get_card`, `move_card` [respeita gates], `post_comment`, `pipeline_report`) · read-models/relatórios (`reportService`) · digest por e-mail via `fanOut` · UI de volumes/ISBN se necessário.

**Fase 3 — WhatsApp + emendas estruturadas + integração Firebase:** adaptador WhatsApp Cloud API atrás de `NotifierPort` + webhook de entrada ("relatório da safra por WhatsApp") · promover emendas a objeto de 1ª classe (round/status/timeline, `emenda_comment`) · adaptador de integração com o Next+Firebase existente (identidade compartilhada / sync de status) sobre os ports já definidos.

## Verificação

Como validar ponta a ponta (projeto novo → critérios de aceite + testes):
1. **Ambiente:** projeto Supabase (dev) região São Paulo; aplicar migrations + policies RLS; seed de taxonomia + ~20 etapas do BPMN + papéis.
2. **Fluxo do card:** criar board/card, arrastar entre colunas (Kanban) e ver refletir na **visão lista**; abrir 2 navegadores e confirmar **realtime**.
3. **Gates:** configurar regra "exige checklist completo" numa transição; mover sem completar → **bloqueado**; completar → move; desligar a regra em runtime → move livre.
4. **Campos customizados:** criar campo `status` (single-select) com "mostra no card"; setar valor; **filtrar** a lista por ele.
5. **Acesso externo (teste crítico de segurança):** logar como conta Google externa atribuída a **um** card → enxerga só esse card (Kanban/lista/API); **teste automatizado** afirmando que externo não lê card não atribuído (via RLS, batendo direto no adaptador).
6. **Comunicação:** comentar com @menção → destinatário recebe notificação in-app; canal de equipe troca mensagens em tempo real.
7. **Auditoria:** cada movimentação/override aparece no `activity`/feed do card.
