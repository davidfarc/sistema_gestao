# SPEC — Sistema de Gestão Ecco Prime

> Especificação do sistema **como ele está hoje**, reconstruída a partir do código
> (ramo `main`, commit `7d2baa3`), das migrations e dos documentos do repositório.
> Atualizada em **10/11/2026**.
>
> - O plano original (julho/2026) está em [`PLANO.md`](./PLANO.md). Parte dele foi
>   simplificada ou mudou de rumo; quando os dois divergem, **vale este SPEC**.
> - Como publicar: [`DEPLOY.md`](./DEPLOY.md).

---

## 1. Visão geral

Sistema interno da Ecco Prime (editora e escola), num só endereço com login Google.
Nasceu como gestor de produção editorial (substituto do Trello + WhatsApp) e hoje reúne
quatro frentes:

| Módulo | Para quê | Rota |
|---|---|---|
| **Quadro (pipelines)** | Kanban/lista de qualquer fluxo: produção editorial, demandas de compras, TI, marketing… | `/board`, `/card/[id]` |
| **Prioridades e Planejamento** | Fila priorizada de demandas (RICE + alçadas) e orçamento mensal | `/prioridades`, `/prioridades/planejamento` |
| **Gestão de Vila** | Salas, alunos, equipe, rotina diária e busca ativa da escola | `/salas/*` |
| **Novos alunos** | Central de agendamento de anamneses com psicólogas (área interna + página pública para famílias) | `/novos-alunos/*`, `/agendar` |
| **Conversas** | Canais por equipe e mensagens diretas (substitui o WhatsApp interno) | `/canais` |
| **Configurações** | Usuários, papéis/permissões, alçadas | `/configuracoes/*` |
| **Início** | Painel com atalhos cadastrados pelo gestor | `/` |

**Endereço de produção:** https://gestao.eccoprime.com.br (o antigo, https://ecco-sistema.dafarc.workers.dev, segue ativo e serve as prévias)
(o antigo `ecco-sistema.vercel.app` redireciona para cá).

---

## 2. Arquitetura

```
Navegador ──► Cloudflare Worker "ecco-sistema" (Next.js 15 via OpenNext)
                 │
                 ├─► Supabase (Postgres + Auth Google + Realtime + Storage)
                 │      schema public   → quadro, conversas, salas, permissões
                 │      schema anamnese → central de novos alunos (via Prisma)
                 │                        acessado pelo Hyperdrive (binding ANAMNESE_DB)
                 │
                 ├─► Activesoft / SIGA (ERP da escola) — importação de alunos
                 ├─► Google Agenda (OAuth) — eventos das anamneses
                 └─► Cloudflare Email Service — confirmações e lembretes
                     (remetente nao-responder@msg.eccoprime.com.br)

  Cron Trigger do Worker (a cada 5 min) ─► rotina de Novos alunos (§6.6)
```

### 2.1 Stack

| Camada | Tecnologia |
|---|---|
| App | Next.js 15 (App Router, Server Actions), React 19, TypeScript |
| Monorepo | pnpm workspaces: `apps/web` + `packages/core` (`@ecco/core`) |
| Hospedagem | **Cloudflare Workers** (adaptador `@opennextjs/cloudflare`); build automático pelo Workers Builds ligado ao GitHub |
| Banco/Auth | **Supabase** — projeto `Gestão Ecco SP` (`rcjjwoajuvnrgeuzsgsj`, São Paulo/`sa-east-1`, desde 10/11/2026). Postgres com RLS, Auth Google, Realtime, Storage. O antigo `njdocgzzuhhlaweqqnrq` (Ohio) ficou parado como reserva |
| ORM (só Novos alunos) | Prisma 6 + `@prisma/adapter-pg`, conexão pelo **Hyperdrive** `anamnese-db-sp` (conexão direta ao banco, cache desligado) |
| UI | Tailwind, lucide, dnd-kit (Kanban), TanStack Table (lista), Tiptap (descrição rica) |

### 2.2 Estrutura de pastas

```
apps/web/
  app/(app)/        telas autenticadas (board, card, canais, salas, prioridades,
                    novos-alunos, configuracoes, início)
  app/agendar       página PÚBLICA de agendamento (famílias)
  app/privacidade   política de privacidade (pública)
  app/api/          rotas HTTP (ver §8)
  components/       por módulo (board, salas, anamnese, shell…)
  lib/              lógica de servidor por módulo (board, demandas, salas, anamnese…)
  prisma/           schema e migrations da central de anamneses
  worker.ts         entrada do Worker: app Next (OpenNext) + rotina agendada
  wrangler.jsonc    configuração do Worker
packages/core/      regras puras, sem Next/banco: domínio, permissões, gates,
                    ranking (índice fracionário), alçadas + RICE, SLA — com testes
infra/
  migrations/       SQL do schema public (0001 → 0033), aplicadas à parte
  *.mjs / *.sql     utilitários de aplicação, verificação e testes de RLS
```

### 2.3 Princípios (valem para qualquer mudança)

1. **Toda escrita passa pelo servidor** (Server Action / rota), que checa permissão
   (`requireActor(acao)` / `authorize()`), valida e grava auditoria. O navegador só lê
   (inclusive pelo Realtime).
2. **RLS ligado em todas as tabelas**, negando por padrão. A UI esconde botões só por
   conveniência; quem barra é o servidor e o banco.
3. **Um único caminho para mover card** (`CardService.move`), que avalia os gates.
4. **Configuração é dado, não código:** etapas, campos, papéis, regras de fluxo, alçadas,
   formulários e atalhos são editáveis na tela.
5. Recurso sem permissão responde **404** (não revela que existe).

---

## 3. Acesso, login e permissões

### 3.1 Login

- Login único com **Google** (Supabase Auth). Rotas: `/login`, `/auth/callback`, `/auth/signout`.
- **Interno** = e-mail de um dos domínios em `INTERNAL_EMAIL_DOMAIN`
  (`editoraeccoprime.com.br`, `eccoprime.com.br`, `adm.eccoprime.com.br`).
  Qualquer outra conta Google entra como **externo** e só vê os cards atribuídos a ela.
- No primeiro login o usuário é provisionado em `app_user`. O login **não rebaixa** quem
  já existe (correção de 27/08).
- Também é possível pré-cadastrar alguém pelo e-mail em Configurações → Usuários.

### 3.2 Papéis (editáveis)

Papéis ficam na tabela `role` com uma lista de permissões. Papéis de sistema têm `slug`
e não podem ser excluídos:

| Papel (slug) | Resumo |
|---|---|
| **Gestor Master** (`master`) | Tudo, inclusive editar papéis e conceder papéis administrativos |
| **Gestor** (`gestor`) | Administra o dia a dia: todos os pipelines, usuários, Vila, orçamento |
| **Gestor de área** (`area`) | Gerencia só os pipelines de que é membro; não edita a Vila nem o orçamento |
| **Membro interno** (`interno`) | Trabalha nos pipelines de que é membro |
| **Externo** (`externo`) | Só os cards atribuídos a ele |

Outros papéis podem ser criados na tela (`/configuracoes/papeis`). O sistema impede
mudanças que deixariam a organização sem nenhum Gestor Master ativo ou sem ninguém
com `user:manage`.

**Catálogo de permissões** (19) (`packages/core/src/domain/index.ts`):

| Permissão | Libera |
|---|---|
| `board:read` / `board:configure` | Ver pipelines / criar, renomear, arquivar e definir membros |
| `card:read` `card:create` `card:update` `card:move` `card:assign` | Operações no card |
| `comment:create` | Comentar |
| `channel:read` `channel:post` `channel:manage` | Conversas |
| `field:manage` | Editar propriedades (campos) |
| `stage:manage` | Editar etapas (colunas) |
| `workflow:manage` | Editar regras de fluxo (gates) |
| `plan:manage` | Planejamento de gastos |
| `salas:manage` | Editar a Gestão de Vila (sem ela, o módulo é só leitura) |
| `novos:access` | Novos alunos: agenda, agendamentos e relatórios (atendimento/coordenação) |
| `novos:manage` | Novos alunos: também psicólogas, segmentos, configurações e auditoria |
| `user:manage` | Convidar usuários e trocar papéis comuns |
| `role:manage` | Editar papéis e conceder papéis administrativos |

**Cargo** (`app_user.cargo`) é separado do papel: diz a função no organograma
(Gestor Financeiro, Diretor Administrativo, Diretor Geral…) e é usado nas aprovações por alçada.

### 3.3 Escopo de visibilidade

- Quem tem `board:configure` vê todos os pipelines; os demais veem só os pipelines em
  que constam em `board_member`.
- Externo vê apenas cards com `assignment` dele.
- Quem **solicitou** um card enxerga aquele card, mesmo sem ser membro do pipeline.
- **Novos alunos** depende das permissões `novos:*` ou do cadastro como psicóloga (§6.4).

---

## 4. Quadro (pipelines)

### 4.1 Conceitos

- **Pipeline (`board`)**: vários por organização; criar, trocar, renomear e arquivar.
  O Quadro abre no último pipeline usado (ou no primeiro em ordem alfabética).
- **Etapa (`stage`)**: coluna configurável (`position`, `category`, `wip_limit`).
- **Card**: título, descrição rica (com imagens coladas, guardadas num bucket público
  do Storage com caminho aleatório), **responsável** único, **solicitante**, prazo,
  prioridade, propriedades, checklists, anexos (links), comentários e histórico de atividade.
  Ordem dentro da coluna por índice fracionário (`core/ranking.ts`).
- A taxonomia editorial (matéria × série × bimestre → código `TEX-7A-FUND2-1B-2027`)
  continua modelada no banco, mas **é opcional** e não aparece mais como obrigatória no produto.
  Volumes (`volume`, `volume_card`) e emendas (`emenda`) estão modelados, sem tela.

### 4.2 Visões

- **Kanban** com arrastar e soltar e atualização em tempo real.
- **Lista** (tabela) com colunas de propriedades, edição direta e configuração de colunas.
- **Card** em modal ou página expandida (`/card/[id]`) com atividade na lateral.

### 4.3 Propriedades (campos customizados)

- Tipos: `text`, `long_text`, `number`, `date`, `select`, `multi_select`, `checkbox`,
  `member`, `link`, `status`.
- Por pipeline ou **globais** (`board_id` nulo → aparecem em todos).
- Opções: mostrar na face do card, filtrável, mostrar no formulário de criação.
- **Quem pode editar** um campo pode ser restrito (ex.: só a coordenação marca "Aprovado").
- Valores gravados em colunas tipadas (`field_value`), o que permite filtrar e gerar relatórios.

### 4.4 Formulário de criação e caixa de entrada

- Cada pipeline escolhe o formulário: `simple` (só título), `generic` (campos marcados
  "no formulário") ou `custom` (formulário próprio, ex.: **Demandas de compras**).
- **Quem pode abrir demanda** no pipeline (`board.intake`): só membros, toda a equipe
  interna, ou pessoas nomeadas. Ex.: a coordenação pedagógica pode pedir algo à TI sem
  ver o pipeline da TI.

### 4.5 Regras de fluxo (gates)

Configuradas por transição de etapa (`workflow_rule`), ligadas e desligadas na hora,
com efeito **bloquear** ou **avisar**. Requisitos disponíveis:

| Requisito | Exige |
|---|---|
| `checklist_complete` | Checklist concluído |
| `attachment_present` | Ao menos um anexo |
| `field_filled` | Campo preenchido (com o controle de quem edita, vira aprovação) |
| `emenda_concluded` | Emenda concluída |
| `approval` | Aprovação registrada |
| `role` | Papel específico de quem move |
| `prioritized` | Card priorizado (checkpoint de demandas: não dá para "pular" a etapa) |

### 4.6 Comunicação no card e notificações

- Comentários com **@menções**; a menção gera DM para a pessoa e uma notificação.
- **Sininho** de notificações no app (menções e atribuições), em tempo real.

---

## 5. Demandas: priorização, alçadas e orçamento

Usado no pipeline **"Demandas com orçamento"** (compras/serviços), com o formulário
personalizado "Demandas de compras".

### 5.1 Alçadas (`core/alcadas.ts`)

Classifica cada demanda numa faixa de aprovação **A / B / C**:

1. Faixa base pelo valor: até **R$ 2.000** = A; até **R$ 10.000** = B; acima = C.
2. Vão direto para **C**: tipo *Transform*; *Grow* acima de **R$ 5.000**; recorrência com
   custo anual acima de **R$ 24.000**; reclassificação para Transform.
3. Cada gatilho de risco sobe uma faixa (risco alto, fornecedor único, fora do orçamento,
   baixa reversibilidade, suspeita de fracionamento…).

Os quatro limites são **editáveis por pipeline** (`board.alcada_thresholds`,
tela `/configuracoes/alcadas`). A faixa define quais cargos aprovam
(Gestor Financeiro, Diretor Administrativo, Diretor Geral).

Tipos de demanda: **Run, Keep, Grow, Transform**.

### 5.2 RICE e fila priorizada

- **RICE = (Alcance × Impacto × Confiança%) / Esforço**, com
  **Esforço = Tempo + Complexidade + Orçamento** (soma, conforme o manual de Compras).
- Uma demanda só pode ser **priorizada** com RICE completo. Priorizar registra quem,
  quando, a posição na fila e o RICE do momento (`prioritization`), e **move o card** para
  a coluna de prioridade. Despriorizar arquiva o registro (o histórico fica).
- Tela `/prioridades`: fila priorizada antes de "Aguardando priorização", com gráficos de
  orçamento e execução.

### 5.3 SLA por urgência (`core/sla.ts`)

Prazo em dias úteis: muito alta 2 · alta 7 · normal 30 · baixa 90 · muito baixa 180.

### 5.4 Planejamento de gastos

Tela `/prioridades/planejamento` (permissão `plan:manage`): valor planejado por **mês** e
por **área** (`spend_plan`). A tabela já aceita uma segunda dimensão, por tipo
(Run/Keep/Grow/Transform), ainda sem tela.

---

## 6. Novos alunos (central de anamneses)

Agendamento de entrevistas (anamneses) entre famílias de alunos novos e as psicólogas
da escola. Veio de um sistema separado e foi integrado em 09/11/2026.

### 6.1 Fluxo da família (público, sem login)

1. Acessa **`/agendar`**, escolhe o **segmento escolar**, a data e um horário livre.
2. Informa responsável, aluno, turma (opcional), telefone e e-mail, e aceita a política de
   privacidade (`/privacidade`). O aceite é registrado com data, versão e IP.
3. Recebe um **código de agendamento** e um **e-mail de confirmação**; 24 h antes, um lembrete.

Regras: antecedência mínima de **12 h**, no máximo **90 dias** à frente, duração padrão
de **50 min**. Os três valores são configuráveis. Quando duas psicólogas oferecem o mesmo
horário, ele aparece uma vez só. As rotas públicas têm limite de requisições gravado no banco.

### 6.2 Garantia contra agendamento duplo

A reserva é **atômica**: um único `UPDATE … AVAILABLE → BOOKED` dentro de uma transação,
com um índice único parcial como última proteção. Na mesma transação ficam registradas as
pendências de Google Agenda e de e-mail (padrão *outbox*). Por isso o **cache do
Hyperdrive fica desligado**: a agenda não pode mostrar como livre um horário já ocupado.

### 6.3 Área interna (`/novos-alunos/*`)

| Tela | Função |
|---|---|
| Início | Resumo do dia e próximos atendimentos |
| `agenda` | Calendário de atendimentos |
| `agendamentos` | Lista com filtros; cancelar, remarcar (até para outra psicóloga ou segmento), concluir, falta; exportar CSV |
| `disponibilidade` | Regras de horário por psicóloga e segmento (período, dias da semana, início e fim, duração, intervalo) que geram os horários; bloqueios |
| `psicologas` | Cadastro e vínculo com os segmentos |
| `segmentos` | Segmentos escolares oferecidos (ordem, ativo) |
| `google` | Conectar o Google Agenda da equipe e de cada psicóloga |
| `relatorios` | Indicadores de agendamentos |
| `auditoria` | Registro de todas as ações |
| `configuracoes` | Marca, textos, regras de agendamento, lembretes, e-mails da equipe, LGPD |

### 6.4 Perfis da central

O acesso usa o **mesmo login Google** e segue o **gerenciador de papéis** do sistema
(Configurações → Papéis). O perfil na central é calculado a cada acesso, nesta ordem:

| Perfil | Quem recebe | Pode |
|---|---|---|
| **ADMIN** | Papel com `novos:manage` (Gestor Master e Gestor, por padrão) | Tudo na central |
| **PSYCHOLOGIST** | Quem está cadastrada e ativa em **Psicólogas** | A própria agenda e os próprios atendimentos (vê os das outras só com `canViewOthers`) |
| **COORDINATION** | Papel com `novos:access` | Atendimento: ver e gerenciar agendamentos; cancelar só se `coordinationCanCancel` estiver ligado |

Sem nenhum dos três, a seção fica fechada. O registro em `anamnese."User"` é criado e
atualizado sozinho (por e-mail), só para auditoria e vínculos. Não existe mais a tela de usuários da central.

### 6.5 LGPD

- Após **24 meses** do atendimento (configurável, de 6 a 120), os dados pessoais são
  **anonimizados**. As contagens continuam valendo para relatórios.
- E-mails enviados são apagados depois de 90 dias.
- Tokens do Google são guardados criptografados (`ENCRYPTION_KEY`).

### 6.6 Rotina periódica

A cada **5 minutos** o Cron Trigger do Worker (`worker.ts`) chama internamente
`POST /api/anamnese/cron/process` (autenticado com `CRON_SECRET`), que cria lembretes
(24 h antes), envia os e-mails pendentes, repete sincronizações do Google que falharam,
limpa tentativas antigas e aplica a retenção.

### 6.7 Modelo de dados (schema `anamnese`, Prisma)

`User`, `Psychologist`, `SchoolSegment`, `PsychologistSegment`, `AvailabilityRule`,
`AvailabilitySlot` (AVAILABLE/BOOKED/BLOCKED), `Appointment`
(CONFIRMED/CANCELLED/COMPLETED/NO_SHOW), `GoogleCalendarConnection`, `GoogleCalendarEvent`,
`Notification` (EMAIL; WHATSAPP previsto e hoje ignorado), `AuditLog`, `SystemSetting`,
`LoginAttempt`.

---

## 7. Gestão de Vila (salas)

Gestão do dia a dia da escola, dividida em duas vilas (`vila1`, `vila2`) e dois turnos.

| Tela | Função |
|---|---|
| `/salas` | Salas/turmas de cada vila; **Ver Alunos** mostra quem está na manhã, na tarde e no almoço do dia |
| `/salas/alunos` | Alunos: sala, dias de manhã e tarde, dias de almoço; **importação do Activesoft** |
| `/salas/equipe` | Adultos (professores, auxiliares…), tipos de função, escalas por sala e ausências |
| `/salas/rotina` | Rotina diária: faltas, saídas antecipadas, horário estendido, observações |
| `/salas/busca-ativa` | Alertas de alunos faltosos (vermelho, laranja, verde) e registro das etapas de busca ativa |
| `/salas/relatorios` | Relatórios do módulo |

- **Modo Real / Simulado**: dá para testar mudanças sem afetar os dados reais.
- **Armazenamento:** um único documento JSON por organização (`sala_state`), com a mesma
  forma do antigo Firebase. A gravação é feita **por caminho** (`sala_state_set`), para que
  dois usuários não sobrescrevam o trabalho um do outro. Leitura para internos; edição exige
  `salas:manage`.
- **Activesoft:** `POST /api/salas/activesoft/sync` busca a lista de alunos no SIGA com o
  segredo `ACTIVESOFT_API_TOKEN` (só no servidor). A mesclagem com os dados atuais acontece na tela.
- **Origem:** migrado do Firebase `eccoprime-salas`, cujas regras estavam totalmente
  abertas. Os dados importados são de **29/07/2026**; o que mudou depois no sistema antigo
  ainda não foi trazido.
- Os alertas de busca ativa ainda vêm de uma automação em Python, externa ao repositório,
  que grava no Firebase.

---

## 8. Conversas, Início e Configurações

- **Conversas (`/canais`)**: canais por equipe ou projeto e mensagens diretas, em tempo
  real, com contador de não lidas. Criar e editar grupos exige `channel:manage`.
- **Início (`/`)**: atalhos (`shortcut`) cadastrados pelo gestor, apontando para um pipeline
  (`/board?board=<id>`) ou para links externos (Canva, playbooks…).
- **Configurações**: `usuarios` (convidar, papel, cargo, arquivar), `papeis` (editor de
  permissões), `alcadas` (limites por pipeline).

---

## 9. Rotas HTTP

| Rota | Acesso | Função |
|---|---|---|
| `GET /auth/callback`, `POST /auth/signout` | — | Login e logout Google |
| `POST /api/salas/activesoft/sync` | interno logado | Importa alunos do Activesoft |
| `GET /api/anamnese/public/dates` | público | Datas com horário livre por segmento |
| `GET /api/anamnese/public/slots` | público | Horários livres de uma data |
| `GET /api/anamnese/export/appointments` | perfil da central | CSV de agendamentos |
| `GET /api/anamnese/google/connect` / `callback` | ADMIN / psicóloga | Conexão OAuth com o Google Agenda |
| `POST /api/anamnese/cron/process` | `CRON_SECRET` | Rotina periódica (§6.6), chamada pelo cron do Worker |

O resto das escritas usa Server Actions (`lib/**/actions.ts`).
A API REST pública `/api/v1` e o servidor MCP previstos no plano **não foram feitos**.

---

## 10. Banco de dados (schema `public`)

Migrations em `infra/migrations` (0001 → 0034; **não rodam no deploy**, são aplicadas à
parte com `infra/apply.mjs` / `run-sql.mjs`).

| Grupo | Tabelas |
|---|---|
| Organização e pessoas | `organization`, `app_user` (com `cargo`), `team`, `user_team`, `role`, `user_role` |
| Pipelines | `board` (formulário, intake, alçadas), `board_member`, `stage`, `card`, `assignment` |
| Campos | `field_definition`, `field_value` |
| Conteúdo do card | `checklist`, `checklist_item`, `attachment`, `comment`, `emenda` |
| Fluxo e auditoria | `workflow_rule`, `approval`, `activity`, `notification` |
| Demandas | `prioritization`, `spend_plan` |
| Conversas | `channel`, `channel_member`, `message` |
| Taxonomia editorial (opcional) | `segmento`, `serie`, `materia`, `ano_letivo`, `volume`, `volume_card` |
| Outros | `sala_state`, `shortcut` |

Storage: bucket público para imagens da descrição dos cards.

---

## 11. Configuração e segredos

**Variáveis públicas** (`wrangler.jsonc` → `vars`, ou padrão em `next.config.ts`):
`INTERNAL_EMAIL_DOMAIN`, `APP_URL`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, URL e chave *publishable* do Supabase.

**Segredos** (só no painel do Cloudflare, *runtime*, nunca no repositório):

| Segredo | Uso | Situação |
|---|---|---|
| `SUPABASE_SECRET_KEY` (formato `sb_secret_`) | Escritas do servidor | ✅ |
| `ACTIVESOFT_API_TOKEN` | Importação de alunos | ✅ — **trocar** (ver §13) |
| `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` | Central de anamneses | ✅ |
| `GOOGLE_CLIENT_SECRET` | Google Agenda | ✅ |

E-mail não usa chave: sai pelo binding `EMAIL` (Cloudflare Email Service), com o
subdomínio `msg.eccoprime.com.br` habilitado em Email Sending.

**Bindings do Worker:** `ANAMNESE_DB` (Hyperdrive → Supabase SP, cache desligado),
`EMAIL` (envio de e-mail), `ASSETS`, `WORKER_SELF_REFERENCE`. **Cron:** `*/5 * * * *`.

**Supabase Auth** (projeto SP): cliente OAuth Google com redirect
`https://rcjjwoajuvnrgeuzsgsj.supabase.co/auth/v1/callback`; endereços liberados em URL Configuration:
`https://gestao.eccoprime.com.br/**`, `https://ecco-sistema.dafarc.workers.dev/**` e `https://*-ecco-sistema.dafarc.workers.dev/**` (prévias).

**Publicação:** push no `main` publica; outros ramos geram **prévia** (`upload`), sem
publicar. Detalhes em `DEPLOY.md`.

---

## 12. Situação atual e próximos passos

| Item | Situação |
|---|---|
| Migração Vercel → Cloudflare | ✅ Concluída em 09/11/2026 |
| Quadro, Demandas, Prioridades, Planejamento, Conversas, Configurações | ✅ Em produção |
| Gestão de Vila + Ver Alunos + Activesoft | ✅ Em produção (dados de 29/07) |
| Banco no Supabase de São Paulo | ✅ Migrado em 10/11/2026 (o de Ohio ficou parado como reserva) |
| Novos alunos — central integrada, acesso por papéis, página pública | ✅ Em produção |
| Novos alunos — e-mail, Google Agenda e rotina a cada 5 min | ✅ Em produção (conferir um ciclo completo: agendar → e-mail → evento na agenda → lembrete) |
| Domínio próprio `gestao.eccoprime.com.br` | ✅ 16/11 |
| Atualizar a Vila com os dados posteriores a julho e desligar o Firebase | ⏳ |
| API REST `/api/v1`, MCP, WhatsApp, tela de volumes, emendas por página | 💤 Fora do escopo atual |

**Pontos de atenção técnicos**
- O Worker tem **~2,8 MiB comprimido**, perto do limite de 3 MiB do plano gratuito do
  Cloudflare. O próximo módulo pode exigir o plano pago (limite de 10 MiB) ou reduzir o pacote.
- Prévias de ramos antigos (gerados antes de 10/11) apontam para o Supabase de Ohio e não
  fazem login. Testar sempre a partir do `main` atual.
- Build local no Windows não gera um Worker válido: o build que vale é o do Cloudflare (Linux).

---

## 13. Segurança — incidente de 10/11/2026

O repositório ficou **público** por um período e continha
`infra/backups/salas-rtdb-2026-07-29….json`, com a **chave da API do Activesoft** e dados de
alunos e funcionários (nomes, faltas, motivos).

| Ação | Situação |
|---|---|
| Repositório tornado privado | ✅ 10/11/2026 |
| Arquivo removido do repositório **e do histórico** de todos os ramos (`git filter-repo`) | ✅ 10/11/2026 |
| Nova chave no Activesoft, antiga revogada, segredo `ACTIVESOFT_API_TOKEN` atualizado no Cloudflare | ⏳ Com o David |
| Avaliar se a exposição precisa ser comunicada (LGPD, dados de menores) | ⏳ |

**Regras daqui para frente**
- Nenhum segredo e nenhum dado pessoal em arquivo versionado. Backups ficam fora do Git
  (Drive com acesso restrito). `infra/backups/` está no `.gitignore`.
- Cópias antigas do repositório (clonadas antes de 10/11/2026) ainda têm o arquivo no
  histórico: apague e clone de novo. Não envie nada a partir delas.
