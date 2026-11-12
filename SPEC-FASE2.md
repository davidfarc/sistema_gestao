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

| Item | Situação |
|---|---|
| A1 tempo real · A2 busca e "Meus cards" · A5 face do card · A6 etapas · A7 visão lembrada · A10 · A11 | Código pronto no ramo `claude/fase2-quadro`; **falta aplicar a migration 0035 e testar com dados reais** |
| Histórico enriquecido (`card_created`, origem e tempo na etapa, `completed_at`) | Idem |
| A3 card com link (`?card=<id>`, painel lateral = mesmo componente da página `/card/[id]`) | Código pronto no ramo; **falta testar na prévia** |
| A4 ordem na coluna (`@dnd-kit/sortable` + `placeInColumn` em `core/ranking.ts`; card novo entra no fim da coluna) | Código pronto no ramo; arrasto testado em navegador com dados de mentira; **falta testar na prévia com o banco**. Sem migration |
| A8 "+ Adicionar card" no pé da coluna (formulário `simple`; nasce na 1ª etapa e vai à coluna pelo `CardService.move`) | Código pronto no ramo; **falta testar na prévia**. Sem migration |
| A9 atualização local (mover, criar na coluna, editar no painel e na Lista mudam a tela na hora; o Realtime é aplicado sem ir ao servidor; `router.refresh()` só em erro, card novo de terceiros sem nome conhecido, etapas e dados velhos; a Lista abre com 1 ida ao servidor em vez de 4) | Código pronto no ramo; **falta testar na prévia**. Sem migration |

**Bloco A: código completo.** Pendências para fechar: aplicar a migration 0035 (se ainda não foi) e
validar na prévia do ramo. Próximo bloco: **B (mobile/PWA)**.

| Bloco B | Situação |
|---|---|
| Manifesto, ícones, instalação, barra inferior (Início, Quadros, Conversas, Avisos + **Menu**, que abre a barra lateral completa) e tela `/avisos` | Código pronto no ramo; **falta testar no celular pela prévia**. Sem migration. Os ícones são provisórios (livro branco sobre o azul da marca): trocar pelo logo oficial quando houver |
| Quadro e card no celular (uma etapa por vez com abas e deslizar; sem arrastar e sem Lista; "Mover para…" no topo do card, também no computador; comentários por último com campo fixo no rodapé) | Código pronto no ramo; conferido em navegador com dados de mentira; **falta testar no celular pela prévia**. Sem migration |
| Conversas no celular (lista → conversa, uma tela por vez; conversa aberta em `/canais?conversa=<id>`; botão voltar; campos de 16 px e alvos de toque maiores) | Código pronto no ramo; passa em typecheck e build, **não foi exercitado em navegador** (depende de login e dados): testar no celular pela prévia. Sem migration |
| Painel · Push · Passada de acessibilidade | A fazer |

Nota: a barra inferior ganhou um 5º item, **Menu**, além dos 4 previstos em B.3. Sem ele, Gestão
de Vila, Novos alunos, Configurações e "Sair" ficariam sem caminho no celular.
