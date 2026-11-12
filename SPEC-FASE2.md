# SPEC — Fase 2: Quadro mais simples, Mobile, WhatsApp e MCP

> **Rascunho de 12/11/2026**, escrito a partir do código no commit `56154a5`.
> Complementa o [`SPEC.md`](./SPEC.md) (que descreve o sistema como está). Quando esta
> fase for entregue, o conteúdo migra para lá e este arquivo some.
> Estimativas em dias de trabalho de desenvolvimento, sem contar validação com a equipe.

Ordem sugerida: **A → B → D → C**. A e B melhoram o uso diário; D depende de dados que
A começa a gravar; C tem o maior risco e depende de uma decisão de infraestrutura.

---

## A. Quadro (pipelines) — ajustes de usabilidade

Problemas encontrados no código atual e o que muda.

| # | Problema hoje | Onde | Mudança | Esforço |
|---|---|---|---|---|
| A1 | O Kanban **não atualiza sozinho**: só Conversas e o sininho assinam o Realtime. Quem deixa o quadro aberto vê dados velhos até recarregar. (O SPEC §4.2 diz que atualiza.) | `components/board/BoardView.tsx:45` | Assinar `card` e `stage` do pipeline aberto no Realtime e aplicar a mudança no estado local | 1 |
| A2 | **Busca e filtros só existem na Lista.** No Kanban não dá para achar um card nem ver "só os meus". | `ListView.tsx:54`, `ListToolbar.tsx` | Subir busca + filtros para o cabeçalho do quadro (valem para as duas visões) e incluir o atalho **Meus cards** | 1,5 |
| A3 | Card aberto vive só em memória: **não tem link**, o "voltar" do navegador sai do quadro, e existem duas telas de card para manter (modal estreito de 512 px e a página `/card/[id]`). | `BoardView.tsx:41`, `CardDetail.tsx:91` | Card aberto vira `?card=<id>` na URL; o modal passa a usar o mesmo componente da página (painel lateral largo no computador, tela cheia no celular) | 2 |
| A4 | Soltar um card **não respeita a posição** dentro da coluna (só troca de etapa), apesar de `card.position` existir. | `KanbanBoard.tsx:104-112` | Trocar `useDraggable` por `@dnd-kit/sortable` (já instalado) e gravar a posição com `core/ranking.ts` | 1,5 |
| A5 | A face do card não avisa o que importa: prazo vencido tem a mesma cor de prazo distante; não mostra progresso do checklist nem comentários. | `CardTile.tsx:86-93` | Prazo vencido em vermelho e "vence hoje" em âmbar; `3/5` do checklist; contador de comentários | 1 |
| A6 | Configuração de etapa escondida ou perigosa: a categoria muda clicando num **ponto de 8 px**; "Remover etapa" não pede confirmação; erros aparecem em `alert()`; o limite de WIP existe no banco e não aparece. | `StageHeader.tsx:72-78`, `:123`, `:66` | Categoria e limite de WIP no menu "⋯"; confirmação ao remover; avisos em *toast*; contador `4/6` na coluna quando há limite | 1 |
| A7 | Visão escolhida (Kanban/Lista) volta para Kanban a cada carregamento. | `BoardView.tsx:40` | Guardar por pipeline (mesmo cookie do último pipeline) | 0,25 |
| A8 | Novo card só pelo botão do topo, sempre na primeira etapa. | `NewCardDialog.tsx` | "+ Adicionar card" no pé de cada coluna (pipelines de formulário `simple`) | 0,5 |
| A9 | Toda gravação chama `router.refresh()`, que refaz as ~9 consultas do quadro inteiro; a Lista ainda dispara mais 4 ao abrir. | `ListView.tsx:93-116`, `lib/board/queries.ts` | Atualização local otimista; com A1 o Realtime cobre o resto, e o `refresh` fica só para erro | 1,5 |
| A10 | Mensagem de quadro vazio manda o usuário rodar `infra/apply.mjs`. | `app/(app)/board/page.tsx:39` | Texto para leigo + botão "Criar pipeline" para quem pode | 0,25 |
| A11 | O menu mostra o **e-mail** do usuário em vez do nome. | `Sidebar.tsx:155` | Mostrar nome e papel | 0,25 |

**Total A: ~11 dias.** A1, A2, A3 e A5 são os de maior efeito para quem usa todo dia.

### Dados que A passa a gravar (pré-requisito de D)

Hoje o histórico (`activity`) registra `card_moved` só com a etapa de destino, e não
registra criação de card nem conclusão. Para relatórios confiáveis:

- `card_created` no histórico, com a etapa inicial;
- `card_moved` com `fromStageId`, `toStageId` e os segundos que o card ficou na etapa anterior
  (calculado de `card.stage_entered_at`);
- nova coluna `card.completed_at`, preenchida ao entrar numa etapa de categoria `done` e
  limpa ao sair.

Migration `0035_activity_enrichment.sql`. Esforço incluído em A1/A4.

---

## B. Mobile

### B.1 Decisão

**Não é um aplicativo de loja.** É o mesmo sistema, instalável na tela inicial (PWA),
com um modo de telas simples abaixo de 768 px. Motivos: uma base de código só, o mesmo
login Google, publicação imediata sem Apple/Google, e a equipe é pequena.

### B.2 Escopo no celular

| Entra | Fica só no computador |
|---|---|
| Conversas (canais e diretas) | Configurações (usuários, papéis, alçadas) |
| Quadros: ver, abrir card, mover, comentar, marcar checklist, criar card simples | Edição de etapas, campos e regras de fluxo |
| Painel (novo, §B.4) | Lista (tabela) com edição direta |
| Avisos (sininho) | Planejamento de gastos, Gestão de Vila, Novos alunos (continuam abrindo, sem redesenho) |

### B.3 Telas

- **Navegação:** barra inferior fixa com 4 itens — Início, Quadros, Conversas (com contador),
  Avisos. Substitui o botão hambúrguer, que hoje fica por cima do seletor de pipeline
  (`Sidebar.tsx:64` × `BoardView.tsx:81`).
- **Quadro:** uma etapa por vez, com as etapas em abas roláveis no topo e deslizar para os
  lados. **Sem arrastar**: no card, botão "Mover para…" abre a lista de etapas. (Hoje o
  card tem `touch-none`, então o dedo sobre um card não rola a tela — `KanbanBoard.tsx:31`.)
- **Card:** tela cheia, comentários no fim com campo fixo no rodapé.
- **Conversas:** lista → conversa, uma tela por vez. Hoje a lista tem largura fixa de 288 px
  e nenhuma adaptação (`ChannelsView.tsx`), o que deixa a conversa espremida no celular.
- **Notificações push** (Web Push): menção, atribuição e mensagem direta. No iPhone só
  funciona com o sistema instalado na tela inicial (iOS 16.4+); a tela de Avisos explica o passo.

### B.4 Painel (novo, `/painel`)

Para o gestor ver no celular sem abrir cada quadro. Por pipeline que a pessoa enxerga:
cards por etapa, atrasados, parados há mais de N dias, concluídos na semana, e "meus cards".
Usa as mesmas consultas de D.2.

### B.5 Acessibilidade (vale para o sistema todo)

- Alvos de toque de no mínimo 44 × 44 px (hoje há botões de 24–28 px).
- Texto de leitura com no mínimo 14 px e contraste AA: os rótulos em `text-[10px]`/`text-[11px]`
  cinza-claro (`neutral-400`) não passam.
- Campos com fonte de 16 px no celular (evita o zoom automático do iPhone).
- Modais com foco preso, fechamento por Esc e retorno do foco; ícones com `aria-label`.
- Mover card pelo teclado (sensor de teclado do dnd-kit + o mesmo "Mover para…").
- Respeitar "reduzir movimento" do sistema.

### B.6 Esforço

| Item | Dias |
|---|---|
| Manifesto, ícones, instalação, barra inferior | 1,5 |
| Quadro e card no celular | 3 |
| Conversas no celular | 1,5 |
| Painel | 2 |
| Push (service worker, tabela `push_subscription`, envio pelo Worker) | 2,5 |
| Passada de acessibilidade | 2 |
| **Total B** | **~12,5** |

---

## C. WhatsApp — agente dedicado (API não oficial)

> Decidido em 12/11/2026: **um único número remetente**, dedicado ao sistema, que funciona
> como agente. Riscos de C.4 conhecidos e aceitos.

### C.1 O que o agente faz

Qualquer pessoa da equipe, com telefone cadastrado, conversa com o número do sistema:

| A pessoa escreve | O agente faz |
|---|---|
| "Preciso de 3 notebooks para a coordenação até dia 20" | **Cria o card** no pipeline certo (pergunta qual, se houver dúvida), com a pessoa como solicitante, e devolve o link |
| "No card 142, pode marcar a revisão como feita e passar para diagramação" | **Atualiza o card**: comenta, marca checklist, muda prazo ou responsável, move de etapa (respeitando as regras de fluxo) |
| "Como está o livro de Ciências do 7º ano?" / "O que tenho para hoje?" | **Responde com a situação**: etapa, responsável, prazo, último movimento; ou a lista dos cards da pessoa |
| Áudio ou foto | Áudio é transcrito e tratado como texto; foto vira anexo do card em questão |

E, na saída, o mesmo número **avisa**: menção, atribuição, prazo vencendo e mensagem direta
não lida há mais de X minutos.

### C.2 Regras do agente

- **Quem fala é identificado pelo telefone** (`app_user.phone`). Número desconhecido não
  recebe resposta e não cria nada.
- O agente age **com as permissões da pessoa**: só enxerga e altera o que ela poderia pela
  tela. Toda escrita passa pelo mesmo caminho do servidor (`CardService.move`, gates, auditoria)
  e fica no histórico como "via WhatsApp".
- **Confirma antes de alterar** quando houver ambiguidade (mais de um card possível, mover
  para etapa concluída, trocar responsável). Criação de card não pede confirmação: devolve o
  link e a pessoa corrige se precisar.
- Não apaga nada e não mexe em configurações, usuários, Gestão de Vila nem Novos alunos.
- A interpretação das mensagens usa um modelo de linguagem (API do Claude) com as
  **mesmas ferramentas do MCP (seção D)**, mais as de escrita (`criar_card`, `comentar`,
  `mover_card`, `atualizar_card`). Por isso D vem antes de C.

### C.3 Como funciona

```
WhatsApp do número do sistema
        ▲ │
        │ ▼   sessão do WhatsApp Web, pareada por QR code
Gateway (Evolution API, em Docker, num servidor sempre ligado)
        │ webhook assinado                    ▲ envio (HTTP)
        ▼                                     │
POST /api/whatsapp/webhook ─► fila `whatsapp_inbox` ─► agente (modelo + ferramentas) ─► `whatsapp_outbox`
```

- **Onde roda o gateway:** ele mantém uma conexão permanente, então precisa de um servidor
  sempre ligado. ⚠️ **O Supabase não oferece isso** — ele hospeda banco, login e funções
  curtas, não contêineres. O que dá para fazer na conta da Eccoprime é **guardar os dados
  do gateway no Postgres do Supabase** (schema próprio, `whatsapp_gateway`); o programa em si
  precisa de um VPS pequeno à parte (1 vCPU / 1–2 GB, ~R$ 30–60/mês). **Pendente: escolher o
  provedor do VPS.**
- No sistema: `app_user.phone` (E.164) e `whatsapp_opt_in`; filas `whatsapp_inbox` e
  `whatsapp_outbox` (com tentativas, padrão *outbox* da central de anamneses); histórico curto
  da conversa por pessoa (para o agente entender "esse card"); tela Configurações → WhatsApp
  (QR code, estado da conexão, mensagem de teste); preferências de aviso por pessoa.
- A interface `WhatsAppProvider` que já existe (`lib/anamnese/whatsapp.ts`) é reaproveitada.

### C.4 Riscos (aceitos) e cuidados

- **Viola os termos do WhatsApp**: o número pode ser banido sem aviso. Por isso o chip é
  **dedicado ao sistema** — perder o número não pode custar nada além do chip.
- Cuidados para reduzir bloqueio: o agente só responde a quem escreveu ou aceitou receber
  avisos; limite de mensagens por minuto; nada de disparo em massa.
- **Só equipe interna.** Famílias continuam por e-mail.
- Se o gateway cair ou o número for banido, o sistema segue funcionando: avisos pelo
  sininho e pelo push (B), e as mensagens recebidas ficam na fila.
- **Dados:** o texto das mensagens passa pelo gateway e pelo modelo de linguagem. O agente
  não tem acesso a dados de alunos, e as respostas trazem título, etapa, prazo e link — não
  a descrição inteira do card.

### C.5 Esforço

| Item | Dias |
|---|---|
| VPS + gateway (subir, proteger, parear, dados no Supabase) | 1,5 |
| Telefone e opt-in, filas, provedor, tela de conexão | 3 |
| Avisos de saída e preferências por pessoa | 1,5 |
| Agente: webhook, identificação, ferramentas de escrita, confirmações, histórico | 5 |
| Áudio e foto | 1,5 |
| **Total C** | **~12,5** |

Custo mensal: VPS (R$ 30–60) + chip + uso do modelo de linguagem (centavos por conversa;
estimar após o primeiro mês de uso real).

---

## D. MCP — relatórios para assistentes de IA

### D.1 O que é

Um servidor MCP remoto que deixa um assistente (Claude, por exemplo) consultar o sistema
em linguagem natural: "o que a equipe fez esta semana?", "quais pipelines estão travados?",
"como está a produtividade da Diagramação?". **Somente leitura** nesta fase.

### D.2 Ferramentas

| Ferramenta | Devolve |
|---|---|
| `listar_pipelines` | Pipelines visíveis, com etapas e contagem de cards |
| `resumo_pipeline(pipeline, período)` | Cards por etapa, criados × concluídos, atrasados, parados, tempo médio por etapa e do início ao fim |
| `atividades(período, pipeline?, usuário?)` | Linha do tempo: criações, movimentações, atribuições, comentários, checklists |
| `produtividade_usuario(usuário?, período)` | Por pessoa: cards concluídos, movimentações, comentários, itens de checklist, cards em aberto e atrasados, tempo médio de conclusão |
| `produtividade_pipeline(período)` | Comparativo entre pipelines: vazão semanal, tempo de ciclo, gargalo (etapa com maior permanência) |
| `buscar_cards(texto, filtros)` | Cards por título, responsável, etapa, prazo |
| `detalhe_card(id ou #número)` | Card com campos, checklist, comentários e histórico |

As contas ficam em funções SQL no Postgres (`report_*`), usadas também pelo Painel (B.4).
`produtividade_*` depende dos dados novos da seção A (`fromStageId`, `completed_at`); para
o período anterior, os tempos por etapa são reconstruídos pela sequência de `card_moved`.

### D.3 Arquitetura e segurança

- **Worker separado** (`ecco-mcp`, pasta `apps/mcp`), transporte Streamable HTTP. Não entra
  no Worker principal, que já está a ~2,8 MiB do limite de 3 MiB.
- **Acesso por token pessoal**, gerado em Configurações → Integrações, mostrado uma única
  vez e guardado só como *hash* (tabela `api_token`: dono, nome, último uso, validade,
  revogação). Exige a nova permissão `report:read`.
- O token **herda o alcance do dono**: enxerga só os pipelines que a pessoa enxerga. As
  funções `report_*` recebem o usuário e aplicam o mesmo escopo do SPEC §3.3.
- `produtividade_usuario` sobre **outras pessoas** só para quem tem `user:manage`; os demais
  veem apenas os próprios números.
- Fora do alcance do MCP: Gestão de Vila e Novos alunos (dados de alunos e famílias).
- Cada chamada é registrada (quem, ferramenta, quando) e há limite de requisições por token.

### D.4 Esforço

| Item | Dias |
|---|---|
| Funções `report_*` + testes com dados reais | 3 |
| Worker MCP com as 7 ferramentas | 2,5 |
| Tokens (tela, hash, revogação), permissão, auditoria, limite | 2 |
| **Total D** | **~7,5** |

Evolução natural depois: ferramentas de escrita (`criar_card`, `comentar`, `mover_card`),
sempre pelo mesmo caminho do servidor (`CardService.move`), e a API REST `/api/v1` que o
plano original previa, sobre as mesmas funções.

---

## E. Produção Pedagógica, visual novo e tempo por tarefa (planejado em 12/11/2026)

> Demanda do setor pedagógico da editora, que hoje usa um sistema próprio (site estático +
> Supabase separado). Simulação navegável aprovada como direção; **nada implementado ainda**.

### E.1 Decidido

- **Entra como um pipeline** do nosso sistema ("Produção Pedagógica"), com as etapas Em produção →
  Aguardando análise → Em emenda → Aprovado. Segmento, tipo, início, prazo, finalização e link do
  autor viram propriedades; o número de emendas sobe a cada devolução para "Em emenda".
- **Mensagens, avisos, comentários e histórico seguem os nossos.** O "parecer" da coordenação passa
  a ser comentário + mudança de etapa.
- **Visual:** o do sistema da Produção Pedagógica (cores, fontes Literata/Figtree/IBM Plex Mono,
  componentes) aplicado ao sistema **todo**, exceto o menu lateral, que continua o nosso.
- **Lista:** o modelo novo substitui o visual da Lista atual em todos os pipelines, **sem perder**
  o que ela faz hoje (edição na célula, colunas por propriedade, filtro por qualquer propriedade,
  RICE e estrela no pipeline de demandas). Ganha: resumo clicável, filtros rápidos lado a lado,
  ordenação por qualquer coluna, planilha (CSV) e destaque de atrasado/parado. Clicar no nome abre
  o card; a célula edita.
- **Relatórios separados:** o item "Painel" do menu vira **Painéis**, com um painel por área. O
  primeiro específico é o da Produção Pedagógica (por responsável, por segmento, emendas por tipo,
  tempo do início à aprovação, atrasados). A "Visão geral" atual continua sendo um dos painéis.
- **Dados:** o setor começa do zero. Importação de materiais antigos (CSV) fica para depois, se
  for pedida.
- **Login:** Google, como o resto do sistema (o e-mail e senha do sistema antigo não vêm).

### E.2 Tempo por tarefa (substitui a ideia de "presença")

Redefinido em 12/11: o objetivo **não é registrar entrada e saída da pessoa**, e sim **quanto tempo
cada tarefa consome**, para planejar prazos. Sem vínculo com ponto ou jornada; isso constará nos
termos de uso.

| Peça | Como |
|---|---|
| Cronômetro no card | O colaborador clica em **Iniciar** no card em que vai trabalhar, **Pausar** quando para e **Retomar** depois, inclusive em outro dia. O sistema soma os períodos |
| Uma tarefa por vez | Iniciar outra tarefa pausa a anterior sozinho. Mover o card para análise também pausa |
| Esquecimento | **Sem encerramento automático** (decidido em 12/11). O contador mostra há quanto tempo está ligado; se a pessoa percebe o erro (ex.: 23 h na tarefa), ela **edita a hora em que parou** antes de encerrar e depois retoma. O sistema avisa quando um cronômetro passa de um limite (sugestão: 10 h seguidas), sem parar sozinho. Toda correção fica no histórico do card |
| Dados | Tabela `time_entry` (card, pessoa, início, fim). Total do card = soma dos períodos |
| Quem vê | **Só a gestão** vê o bloco "Equipe agora" (em que cada um está trabalhando) e os relatórios. Cada pessoa vê apenas o próprio tempo |
| Relatórios (Painéis) | No que cada um trabalhou e por quanto tempo; horas médias por tipo de material e por segmento, para planejar; horas registradas por dia |
| Exportação | **Planilha (CSV) por período**, em lote: uma linha por período trabalhado (pessoa, card, pipeline, início, fim, duração) e uma versão resumida por card. Só para a gestão |

Pontos em aberto:

1. Texto dos termos de uso (finalidade: medir tempo de tarefa, não jornada) e aviso à equipe no
   primeiro acesso. Vale uma conferida de quem cuida do jurídico/RH.
2. ~~Corrigir tempo à mão~~ — decidido: sim, pelo próprio colaborador (ver "Esquecimento").
3. Tempo de guarda dos períodos detalhados (sugestão: 12 meses; os totais por card ficam).

### E.2b "Minhas demandas": a visão do colaborador

No sistema de origem ela não é configurável: quem não é da coordenação cai direto nela. Mostra só
os materiais da própria pessoa, em duas listas (em andamento e finalizados), com o que foi
devolvido para emenda em destaque.

No nosso sistema entra como **terceira visão do pipeline**, ao lado de Kanban e Lista:

- mostra os cards em que a pessoa é responsável, com os devolvidos no topo e depois por prazo;
- cada card traz o cronômetro, "Abrir card" e "Finalizar e enviar para análise";
- **é ligada por pipeline**: na criação ou na edição do pipeline escolhe-se quais visões ele oferece (Kanban, Lista, Minhas demandas), qual abre primeiro e se o controle de tempo está ativo. Kanban e Lista não mudam de funcionamento;
- onde estiver ligada, é a visão padrão de quem não gerencia o pipeline; gestores abrem na Lista;
- na tela Início, um resumo "Minhas demandas" junta os cards da pessoa em todos os pipelines.

### E.3 Ordem sugerida

**Antes de tudo:** publicar no `main` o que já está pronto (blocos A, B e D), decidido em 12/11.
O visual novo mexe em todas as telas e deve partir de uma base já validada.

1. Visual novo no sistema todo (tokens e componentes) — maior, mexe em todas as telas.
2. Lista nova (resumo, filtros rápidos, ordenação, planilha), mantendo o que já existe.
3. Pipeline "Produção Pedagógica" (propriedades, contador de emendas) e o painel dele em Painéis.
4. "Minhas demandas" e tempo por tarefa (migration `time_entry`, cronômetro, bloco "Equipe agora", relatórios de tempo).

---

## Resumo

| Bloco | Dias | Custo mensal novo |
|---|---|---|
| A. Quadro | ~11 | — |
| B. Mobile | ~12,5 | — |
| D. MCP | ~7,5 | Possível plano pago do Cloudflare (US$ 5) se o segundo Worker exigir |
| C. WhatsApp (agente) | ~12,5 | VPS do gateway (R$ 30–60) + chip dedicado + uso do modelo de linguagem |
| **Total** | **~44** | |

**Decidido (12/11/2026):** ordem A → B → D → C; WhatsApp com um único número dedicado,
atuando como agente; gateway próprio, com os dados no Supabase da Eccoprime.

**Pendente:** (1) provedor do VPS do gateway (o Supabase não hospeda o programa);
(2) quem recebe `report:read` de início.

## Andamento

> Atualizado em **12/11/2026**. Tudo abaixo está no ramo `claude/fase2-quadro` (prévia do
> Cloudflare); **nada foi para o `main`** ainda.

### Banco

| Migration | O que faz | Situação |
|---|---|---|
| `0035_board_realtime_and_completion.sql` | Publica `card` e `stage` no Realtime; cria `card.completed_at` (gatilho) | ✅ Aplicada em 12/11 |
| `0036_report_overview.sql` | Função `report_pipeline_overview` (Painel e, depois, MCP) | ✅ Aplicada em 12/11 |
| `0037_push_subscription.sql` | Tabela `push_subscription` (uma linha por aparelho; RLS: cada um lê só as suas; escrita só pelo servidor) | **A aplicar** |
| `0038_lock_definer_functions.sql` | Restringe `conversation_list` e `sala_state_set` (security definer) à chave de serviço | ✅ Aplicada em 12/11. Antes: executáveis por `anon` e `authenticated` (confirmado por consulta); depois: só `service_role` (confirmado) |
| `0039_mcp_reports.sql` | Permissão `report:read` (Gestor Master e Gestor); tabelas `api_token` e `api_token_call`; funções `report_*` das 7 ferramentas; `mcp_call`, a porta única do Worker MCP | **A aplicar** |

### Bloco A — Quadro (código completo)

| Item | O que ficou | Situação |
|---|---|---|
| A1 tempo real | Cards e etapas em canais Realtime separados; mudança em card conhecido é aplicada direto na tela. Plano B: se o canal falhar, recarrega a cada 20 s | ✅ Confirmado na prévia (duas janelas, ~1 s) |
| A2 busca e "Meus cards" · A5 face do card · A6 etapas · A7 visão lembrada · A10 · A11 | Como descrito na tabela da seção A | Na prévia; falta conferência item a item |
| Histórico enriquecido | `card_created`, `card_moved` com origem e tempo na etapa, `completed_at` | Na prévia; será validado pelos relatórios (bloco D) |
| A3 card com link | `?card=<id>` na URL; painel lateral largo (tela cheia no celular) com o mesmo `CardContent` da página `/card/[id]`; o modal antigo (`CardDetail`) saiu | Na prévia |
| A4 ordem na coluna | `@dnd-kit/sortable`; posição calculada por `placeInColumn` (`core/ranking.ts`) no navegador e no servidor; cards antigos empatados em 1000 são renumerados na primeira reordenação; card novo entra no fim | ✅ Arrastar grava (confirmado após F5) e chega às outras janelas |
| A8 "+ Adicionar card" | Pé de cada coluna, só no formulário `simple`; nasce na 1ª etapa e vai à coluna pelo `CardService.move` | Na prévia |
| A9 atualização local | As actions de card do dia a dia não chamam mais `revalidatePath`; a tela muda na hora (`lib/board/localState.ts`); `router.refresh()` só em erro, card novo cujo solicitante a tela não conhece, etapas e dados velhos; a Lista abre com 1 ida ao servidor em vez de 4 | Na prévia |

### Bloco B — Mobile (PWA)

| Item | O que ficou | Situação |
|---|---|---|
| Instalação e navegação | Manifesto e ícones; barra inferior (Início, Quadros, Conversas, Avisos + **Menu**); tela `/avisos`; convite de instalação com passo a passo do iPhone | Na prévia; falta testar no celular |
| Quadro e card no celular | Uma etapa por vez (abas + deslizar), sem arrastar e sem Lista; "Mover para" no topo do card (também no computador); comentários por último com campo fixo no rodapé | Na prévia; falta testar no celular |
| Conversas no celular | Lista → conversa, uma tela por vez; `/canais?conversa=<id>`; botão voltar | Na prévia; **não foi exercitado em navegador antes do envio**: testar com atenção |
| Painel (`/painel`) | Por pipeline: em aberto, atrasados, parados (+7 dias na etapa), concluídos e criados em 7 dias, "meus" e contagem por etapa. Atalho no menu lateral e no Início | Na prévia (0036 aplicada); falta conferir os números com os quadros |
| Push | Menção, card atribuído e mensagem direta (grupos não). Web Push sem biblioteca (`core/webpush.ts`), envio em `lib/push/send.ts`, service worker `public/sw.js` (só push, sem cache), botão de ativar por aparelho em `/avisos` | Código pronto; criptografia e migration testadas localmente; **entrega real não testada**. Falta: aplicar a 0037 e cadastrar `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` como segredos no Cloudflare (`node infra/gen-vapid.mjs`). Sem as chaves, o botão não aparece e nada é enviado |
| Passada de acessibilidade | Janelas modais com foco preso, Esc e retorno do foco, num lugar só (`components/shell/DialogA11y.tsx`); cinza-claro de texto trocado por tom que passa no contraste AA; letras de 10–11 px subiram para 12 px (ficam em 10 px só as iniciais dos avatares); campos com 16 px no celular; "reduzir movimento" respeitado; foco visível no teclado; botões que só apareciam no *hover* ficam visíveis no toque | Código pronto; teclado testado em navegador. **Não cobre** Gestão de Vila e Novos alunos (fora do escopo, B.2). Alvos de 44 px aplicados nas telas do celular (barra, quadro, card, conversas, avisos), não em todo botão do computador |

**Bloco B: código completo.** Falta a validação no celular e ativar o push (0037 + chaves).

### Bloco D — MCP (código completo)

| Item | O que ficou | Situação |
|---|---|---|
| Funções `report_*` | As 7 ferramentas de D.2, em SQL. O alcance é decidido num lugar só (`report_scope_cards`: `can_see_board` / `can_see_card`). Tempo por etapa de movimentações antigas é reconstruído pela sequência de `card_moved` | Testadas em Postgres local com o esquema real (38 migrations) e dados de exemplo: números, alcance por pessoa e bloqueios conferidos. **Falta aplicar a 0039 e conferir com dados reais** |
| Tokens | Configurações → Integrações: gerar (mostrado uma vez; no banco só o hash sha-256), listar, revogar; validade opcional; até 5 ativos por pessoa | Código pronto; não exercitado em navegador |
| Worker `ecco-mcp` (`apps/mcp`) | Streamable HTTP sem estado e sem biblioteca (4 KiB comprimido); `Authorization: Bearer` ou `/mcp/<token>`; 11 testes | Empacota (`wrangler deploy --dry-run`); **falta publicar** e testar com um assistente de verdade |
| Auditoria e limite | Cada chamada vai para `api_token_call`; 60 chamadas por minuto por token | Testado localmente |

**Como o MCP sabe quem pergunta (resolve a dúvida de D.3):** o Worker não tem chave secreta. Ele
manda o *hash* do token para `mcp_call`, que valida, assume a identidade do dono **só naquela
transação** (`request.jwt.claims`), confere `report:read` e executa. As funções `report_*` filtram
explicitamente pelo alcance, então não dependem do RLS (que a função dona ignora). Elas não são
executáveis por `anon`/`authenticated` direto; só `mcp_call` é.

Diferenças em relação a D.2/D.3: `produtividade_usuario` sem filtro devolve todas as pessoas para
quem tem `user:manage` e só a própria para os demais; `atividades` filtrada por outra pessoa também
exige `user:manage`. Descrição do card vai sem formatação e limitada a 2.000 caracteres.

Depois de D: **C (WhatsApp agente)**, sem nada iniciado. As ferramentas de escrita de C reusam `mcp_call`
como modelo, mas passando pelo servidor (`CardService.move`), não por SQL.

### Decisões e ajustes tomados durante a execução

- **Barra inferior com 5 itens**, não 4: o item **Menu** abre a barra lateral completa. Sem ele,
  Gestão de Vila, Novos alunos, Configurações e "Sair" ficariam sem caminho no celular.
- **"Mover para" é um seletor nativo no topo do card**, em vez de um botão no card do quadro. Atende
  o celular (B.3) e o teclado (B.5) com um controle só.
- **Criar numa coluna não pula regra de fluxo**: o card nasce na 1ª etapa e é movido pelo
  `CardService.move`; se um gate barrar, fica na 1ª etapa e a tela avisa.
- **Nome e marca (12/11):** o sistema passa a se chamar **Sistema de Gestão Eccoprime** (grafia do logo oficial). Logo oficial no login (colorida), no menu lateral (branca; só o símbolo com o menu recolhido) e nos ícones do aplicativo (símbolo colorido sobre branco). Arquivos em `apps/web/public/brand` e `public/icons`, gerados dos PDFs enviados.
- **Relatórios com `security invoker`**: `report_*` rodam com o RLS de quem chama. Para o MCP
  (token, sem sessão do Supabase) será preciso definir como o usuário é informado à função (D.3).
- **Web Push sem biblioteca**: implementado sobre WebCrypto em `packages/core`, para não aumentar
  o Worker (perto do limite de 3 MiB).

### Como trabalhamos (operação)

- **Migrations pelo SQL Editor do Supabase.** O computador de trabalho não tem `.env` com
  `DATABASE_URL`, e as chaves do Cloudflare não são legíveis de volta. O SQL de cada migration é
  colado no editor do projeto **Gestão Ecco SP**; todas são idempotentes.
- **O banco não é compartilhado com o assistente** (decisão de 12/11): diagnósticos são feitos com
  consultas que o David roda e devolve.
- **Testar sempre na prévia do ramo**, não em produção: o endereço normal mostra o `main`, sem
  nada desta fase. Sinal de que é a prévia: campo "Buscar card…" e "Meus cards" no topo do quadro.
- **Lição do tempo real (12/11):** o quadro não atualizava entre janelas até `card` e `stage`
  constarem em `pg_publication_tables` para `supabase_realtime`. O Supabase recusa o canal
  inteiro quando uma tabela assinada não está publicada. Conferência:
  `select tablename from pg_publication_tables where pubname = 'supabase_realtime';`
- **Antes de cada envio:** `pnpm typecheck` e `pnpm -r test`; o que é de tela é conferido num
  navegador local com dados de exemplo quando não depende de login.

### Segurança (achados durante a fase)

- **Conversas sem checagem de participação (corrigido no ramo, 12/11).** `postMessage` aceitava
  qualquer canal; `setChannelMember`, `loadChannelMembers` e `renameChannel` aceitavam conversas
  diretas e canais de outra organização (quem tem `channel:manage` podia se incluir numa DM
  alheia). Agora: postar exige ser membro; gestão vale só para grupos da própria organização.
  **O `main` (produção) continua com a falha até este ramo ser publicado.**
- **Funções `security definer` abertas (migration 0038).** `conversation_list(p_user)` e
  `sala_state_set(p_org, …)` confiam num parâmetro de quem chama e eram executáveis por
  `authenticated`/`anon` via `/rest/v1/rpc` (confirmado em 12/11). A 0038, já aplicada, restringe
  a `service_role`; vale para produção e prévia, que usam o mesmo banco.
- Regra daqui para frente: toda função `security definer` nasce com
  `revoke all … from public, anon, authenticated` e só recebe o `grant` de quem precisa.

### Pendências com o David

0. Decidir quando publicar o ramo no `main`: a correção das Conversas só chega à produção com isso.
1. Testar no celular, pela prévia: instalação, barra inferior, quadro, card, Conversas e Painel.
2. Conferir se o teclado do celular não cobre o campo de comentário nem o de mensagem (iPhone).
4. Push: aplicar a migration 0037; rodar `node infra/gen-vapid.mjs` e cadastrar os dois valores como segredos do Worker (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`); testar em Avisos → "Ativar notificações".
5. MCP: aplicar a migration 0039; publicar o Worker `ecco-mcp` (`apps/mcp`, `npx wrangler deploy`); gerar um token em Configurações → Integrações e conectar um assistente.
6. `report:read` começa com Gestor Master e Gestor; ajustar em Configurações → Papéis se quiser.
7. Pendência antiga: provedor do VPS do WhatsApp (bloco C).
