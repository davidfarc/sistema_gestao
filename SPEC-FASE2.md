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

## C. WhatsApp — agente de demandas (Twilio, API oficial)

> **Redesenhado em 16/11/2026** a pedido do David. Substitui a decisão de 12/11 (API não oficial com
> gateway em VPS): o número passa a ser contratado na **Twilio**, que usa a API oficial do WhatsApp.
> Com isso **não há gateway, VPS nem computador ligado na escola**: a Twilio chama o nosso servidor
> quando chega mensagem, e o servidor chama a Twilio para responder. O risco de banimento da versão
> anterior deixa de existir.

> **Decisão final de 16/11: API não oficial com a Evolution API**, rodando num computador da escola
> sempre ligado (Docker), alcançado pelo sistema por um Cloudflare Tunnel, com um **número
> descartável** (chip próprio num Android barato; número virtual da Twilio foi descartado porque o
> WhatsApp comum costuma recusar). Motivos: custo zero por mensagem e sem a janela de 24 h nem
> modelos de mensagem. Risco aceito: o número pode ser bloqueado; troca-se o chip e pareia de novo.
> Onde este capítulo fala em Twilio, webhook assinado da Twilio e modelos da Meta, vale a Evolution
> API: webhook com segredo próprio, envio pela API dela e mensagens livres a qualquer hora. O código
> tem uma interface de provedor para trocar depois sem reescrever o agente.
>
> **Decidido em 16/11:** só telefones cadastrados falam com o agente; o telefone entra no cadastro
> do usuário, com convite para preencher no primeiro acesso. Quem libera demanda: **gestor de área
> do pipeline, Gestor e Gestor Master** (não há cargo "diretor" nessa regra).

### C.1 O que o agente faz (primeiro pipeline: Manutenção)

1. **Abrir demanda por texto ou áudio.** O professor escreve ou fala ("o ar-condicionado da minha
   sala não funciona"). O agente pergunta o que falta até ter o mínimo do pipeline; na Manutenção, o
   **número da sala**, pedindo para conferir a placa na porta quando a pessoa der um nome em vez do
   número. Com tudo em mãos, cria o card e responde com o **número do pedido**.
2. **Não duplicar.** Antes de criar, o agente procura card aberto do mesmo pipeline com a mesma sala
   e o mesmo problema. Se achar, **não cria outro**: registra um comentário no card existente ("novo
   pedido em DD/MM, por Fulano"), inclui a pessoa como acompanhante e avisa: "já existe o pedido
   #N; registrei o seu reforço e você passa a receber as atualizações".
3. **Consultar.** "Como está o pedido 142?" → etapa, responsável, prazo e última atualização.
4. **Avisar quem pediu** a cada avanço: mudou de etapa, ganhou responsável, foi concluído.
5. **Avisar a gestão:** a gestora de área do pipeline recebe a demanda nova; o responsável recebe
   quando é atribuído.
6. **Liberação.** A demanda nasce travada na entrada. Só anda quando a **gestora de área do
   pipeline** ou um **diretor** a move e atribui o responsável (pela tela, como hoje).
7. **Cobrar atualização.** Card em andamento sem novidade há 3 dias (configurável por pipeline):
   o responsável recebe um lembrete e pode responder ali mesmo; a resposta vira comentário no card.
   Prazo vencido também gera alerta.

### C.2 Regras

- **Quem fala é identificado pelo telefone** cadastrado no usuário (`app_user.phone`). Número
  desconhecido recebe uma resposta padrão e não cria nada.
- O agente age **com as permissões da pessoa** e pelas mesmas portas do servidor (criação pela caixa
  de entrada do pipeline, `CardService.move`, escopo de `lib/board/scope.ts`). Tudo fica no histórico
  como "via WhatsApp".
- **O que o agente sabe de cada pipeline é configurável**, sem código: em "Atendimento pelo
  WhatsApp" (opções do pipeline) a gestão liga o atendimento, escreve as **instruções** (as salas, o
  que há em cada uma, que tipo de demanda cabe ali) e define os dias do lembrete. As perguntas
  obrigatórias saem das **propriedades marcadas como obrigatórias** na criação (ex.: Sala, Tipo).
- Não apaga nada, não mexe em configurações, usuários, Gestão de Vila nem Novos alunos, e não tem
  acesso a dados de alunos.
- **Janela de 24 horas (regra do WhatsApp):** resposta livre só vale até 24 h depois da última
  mensagem da pessoa. Avisos fora dessa janela (avanço de etapa dias depois, lembrete) precisam de
  **modelos de mensagem aprovados pela Meta**, cadastrados na Twilio. Os textos dos modelos saem
  daqui; o cadastro é feito pelo David.

### C.3 Como funciona

```
WhatsApp ──► Twilio ──► POST /webhook (Worker `ecco-whatsapp`, assinatura conferida)
                              │ grava em `whatsapp_message` e responde 200 na hora
                              ▼
                      agente: modelo de linguagem (API do Claude) + ferramentas
                      (buscar_cards, criar_card, comentar, acompanhar, situacao)
                              │
                              ▼
                      Twilio (envio) ──► WhatsApp
```

- **Worker separado** (`apps/whatsapp`), como o do MCP: o Worker principal está perto do limite de
  3 MiB. Ele grava pelo banco com a identidade da pessoa.
- **Áudio:** a Twilio entrega o arquivo; a transcrição roda no próprio Cloudflare (Workers AI,
  modelo Whisper), sem conta nova.
- **Avisos de saída:** gatilhos do sistema (card criado, movido, atribuído) entram numa fila
  (`whatsapp_outbox`, com tentativas); a rotina agendada cuida dos lembretes de 3 dias e de atraso.
- **Banco:** `app_user.phone`; `card_follower` (quem acompanha um card); `whatsapp_conversation` e
  `whatsapp_message` (histórico curto, para o agente entender "esse pedido"); `whatsapp_outbox`;
  opções por pipeline (`whatsapp_enabled`, `whatsapp_instructions`, `update_reminder_days`); regra de
  fluxo nova "liberação pela gestão".
- **Segredos (só no Cloudflare):** credenciais da Twilio e chave da API do Claude.

### C.4 Riscos e cuidados

- **Aprovação do número pela Meta** (verificação da empresa) pode levar dias. Enquanto isso, o
  desenvolvimento usa o **ambiente de teste da Twilio** (número compartilhado, entra-se com um código).
- **Custo por mensagem:** a Twilio e a Meta cobram por mensagem/conversa, e o modelo de linguagem por
  uso. Estimar depois do primeiro mês real; limite de mensagens por pessoa por hora desde o início.
- **Dados:** o texto e o áudio passam pela Twilio, pelo Cloudflare e pelo modelo de linguagem. As
  respostas trazem número, título, etapa e prazo, não a descrição inteira.
- Se a Twilio ou o modelo falharem, o sistema segue normal; as mensagens ficam na fila.

### C.5 Etapas e esforço

| Etapa | O que entrega | Dias |
|---|---|---|
| C1 Base | Telefone no usuário, Worker, webhook com assinatura, envio, fila, tela Configurações → WhatsApp, teste no ambiente da Twilio | 3 |
| C2 Agente | Abrir demanda com perguntas guiadas, checagem de duplicado, consulta de situação, áudio, opções por pipeline | 5 |
| C3 Avisos | Acompanhantes, avisos a quem pediu, à gestora e ao responsável; modelos de mensagem | 3 |
| C4 Fluxo | Liberação pela gestora ou diretor; lembrete de 3 dias e alerta de atraso, com resposta virando comentário | 2,5 |
| **Total C** | | **~13,5** |

**Pendente com o David:** computador da escola com a Evolution API e o túnel; aparelho para o chip;
chave da API do Claude; cadastro dos telefones da equipe.

**Andamento de C**

| Etapa | Situação |
|---|---|
| C1 telefone no cadastro | Código pronto em 16/11: tabela `user_phone` (0044; cada um lê o seu, a gestão lê todos), convite "Complete seu cadastro" para quem não tem telefone (adiável por 7 dias), "Meu telefone" em Avisos, telefone na edição do usuário e aviso "sem telefone" na lista. Normalização em `core/phone.ts` (com as formas com e sem o nono dígito, para casar com o WhatsApp) |
| C1 Worker, webhook e envio | Código pronto em 18/11 (número pareado na Evolution, instância "Eccoprime Zap"): Worker `ecco-whatsapp` (`apps/whatsapp`) recebe o webhook da Evolution com senha no endereço, reconhece a pessoa pelo telefone (`whatsapp_inbound`, 0049), ignora grupos, repetidas e enxurrada, e responde. Resposta ainda FIXA (confirma a quem é da equipe; orienta o desconhecido uma vez por dia). Falta publicar: túnel do Cloudflare, 3 segredos (`WEBHOOK_SECRET`, `EVOLUTION_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), `npx wrangler deploy` e o webhook na Evolution |
| C1 em produção | Feito em 18/11: túnel `zap.eccoprime.com.br` fechado pelo Cloudflare Access (credencial de serviço), Worker publicado, webhook ligado; teste real respondeu |
| C2 agente | Código pronto em 18/11, ainda NÃO testado com o modelo de verdade (falta a chave): `apps/whatsapp/src/agent.ts` (a pedido do David em 18/11, o modelo é da **OpenAI**, não o Claude: API de conversa com ferramentas chamada direto, sem biblioteca; laço de ferramentas no próprio Worker; modelo na variável `OPENAI_MODEL`) e `whatsapp_agent` (0050), que roda com a identidade da pessoa. Ferramentas: buscar pedidos abertos (para não duplicar), criar, reforçar o existente (comentário) e consultar situação. Liga-se por pipeline em Opções do pipeline → Atendimento pelo WhatsApp (liga/desliga + instruções); as perguntas saem dos campos "pedir na criação" obrigatórios. Sem `OPENAI_API_KEY` o Worker segue na resposta fixa. **Áudio (18/11):** o Worker baixa o áudio da Evolution, transcreve pela OpenAI (`OPENAI_TRANSCRIBE_MODEL`), grava só o texto na conversa (`whatsapp_set_transcript`, 0051) e segue para o agente; até 3 minutos. **Menu (18/11):** só quando há dúvida entre pipelines o agente manda um menu numerado com os pipelines atendidos; o nome de cada item pode ser definido nas instruções do pipeline. Fica para depois: acompanhantes e avisos (C3), liberação e lembretes (C4) |
| C3 avisos e C4 fluxo | Código pronto em 18/11 (0052), testado só em banco local e com respostas simuladas. **Avisos:** gatilho em `activity` enfileira em `whatsapp_outbox` (card criado → gestores de área do pipeline; mudança de etapa → solicitante, responsável e gestores de área; responsável definido → o novo responsável e o solicitante; nunca quem fez a ação; freio de 8 por pessoa por minuto); o Worker envia a cada minuto (cron) e o aviso entra na conversa. **Liberação:** opção do pipeline `release_required` (o card só sai da 1ª etapa pelas mãos de quem gerencia o pipeline; conferido em `moveCardAs`, vale para a tela também). Por mensagem: `preparar_liberacao` confere e escolhe o responsável (um só "membro interno" no pipeline → automático; mais de um → o gestor diz o nome) e o site executa pela rota interna `/api/whatsapp/acao` (segredo `WHATSAPP_SERVICE_SECRET` nos dois Workers, ligação direta entre eles), usando o mesmo `CardService.move` e a mesma atribuição da tela (`lib/board/cardOps.ts`). **Lembrete:** `whatsapp_enqueue_reminders` (dias úteis, 8h–18h, card liberado e não concluído, parado há N dias, N por pipeline); a resposta vira comentário (`comentar_pedido`). **Número não cadastrado (pedido do David):** orienta a procurar o gestor do serviço, no máximo 3 vezes, depois silêncio |
| Fotos de evidência (23/11) | Código pronto, testado em banco local e com respostas simuladas. A pessoa manda a foto pelo WhatsApp; o Worker a baixa da Evolution, guarda no bucket `card-images` (o das imagens da descrição: leitura pública por endereço aleatório, decisão do David "por enquanto") e a deixa pendente por até 1 hora (`whatsapp_media`). Ao abrir ou reforçar um pedido, as pendentes viram anexos do card; `anexar_imagens` as põe num pedido existente (quem pediu, o responsável ou quem tem `card:update`). O modelo não vê a imagem. **Pipeline "Editora Revisão"** (erros de livro apontados por escolas): modelo de pipeline novo em `templates.ts` (Backlog → Em produção → Feito; Série, Disciplina, Período e Página obrigatórios; atendimento já ligado com instruções que exigem confirmação antes de abrir). **Google Drive (23/11, a pedido do David):** opção do pipeline `drive_archive`. A cada minuto o Worker grava o que falta: raiz → 1º campo obrigatório de opções → 2º → "Erro NNN - demais campos", com `erro.txt` e as fotos; o link da pasta entra nos anexos do card. Só gravação (`apps/whatsapp/src/drive.ts`: cria pasta e cria arquivo, nada mais); ids e numeração ficam no banco (0056). Entra como conta de serviço do Google (segredos `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `DRIVE_ROOT_FOLDER_ID`); a raiz precisa estar num drive compartilhado. Não testado contra o Google real |
| Luix e rotina (25/11) | O agente passa a se chamar **Luix**. Além das demandas, registra ajustes na rotina da Gestão de Vila (falta, atraso, +time, observação) para quem tem acesso a ela: pergunta se é demanda ou rotina, se é hoje ou data futura, confirma o aluno pelo nome completo e a turma, repete tudo e só grava depois do sim (`whatsapp_routine`, 0057, grava em `sala_state` como a tela Rotina). Data passada e fim de semana são recusados. Novas telas: **Calendário** na Gestão de Vila (mês, filtro de vila, anotações por dia, inclusive futuras) e **Histórico da rotina** no cadastro do aluno. O relatório de rotina segue igual. Os nomes dos alunos passam pela OpenAI durante a conversa |

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
| `atividades(período, pipeline?, usuário?, pular?)` | Linha do tempo: criações, movimentações, atribuições, prazos, emendas, comentários, checklists. Paginada (`truncado`, `proxima_pagina`), com hora de São Paulo e ações em lote agrupadas (0048) |
| `tempo_por_tarefa(período, pipeline?, usuário?)` | Horas do cronômetro: total, por pessoa, pipeline, dia e card; quem está cronometrando agora (0048). Sem `time:read`, só o próprio tempo |
| `produtividade_usuario(usuário?, período)` | Por pessoa: cards concluídos, movimentações, comentários, itens de checklist, cards em aberto e atrasados, tempo médio de conclusão |
| `produtividade_pipeline(período)` | Comparativo entre pipelines: vazão semanal, tempo de ciclo, gargalo (etapa com maior permanência) |
| `buscar_cards(texto, filtros)` | Cards por título, responsável, etapa, prazo |
| `detalhe_card(id ou #número)` | Card com campos, checklist, comentários, emendas, horas registradas e histórico |

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

### E.4 Enviar card para outro pipeline (código pronto em 12/11)

Botão **"Enviar para outro pipeline"** no card (painel e página). Dois passos: escolher o destino e
**conciliar campos** (para cada campo do pipeline de origem com valor, escolher o campo do destino
ou "não levar"; o sistema sugere os de mesmo nome e tipo compatível).

- O card entra na **primeira etapa** do destino, no fim da coluna, com **número novo**.
- Fica **sem responsável**; quem tem `card:assign` no pipeline de destino recebe aviso (sininho e
  push) para definir o novo dono. O solicitante é mantido.
- Comentários, checklists, anexos e histórico acompanham o card. Campos globais não mudam.
- Campo sem correspondente **não se perde**: vira um comentário no card. Opções de seleção são
  reconhecidas pelo nome.
- A priorização do pipeline de origem é arquivada. Histórico registra `card_transferred`.
- **Quem pode:** `card:move` + enxergar o card, e poder abrir demanda no destino (mesma regra do
  formulário de criação: membro do pipeline ou caixa de entrada aberta para a pessoa).
- Não passa pelo `CardService.move` (não é mudança de etapa dentro de um fluxo): as regras de fluxo
  do destino valem a partir da entrada. A troca é a função `transfer_card` (migration 0040),
  executável só pela chave de serviço.

Limitações conhecidas: quem está com o quadro de ORIGEM aberto em outra tela só vê o card sumir ao
recarregar; o relatório `atividades` do MCP mostra o evento com o nome técnico `card_transferred`.

Situação: migration 0040 aplicada; função testada em Postgres local; tela passa em typecheck e
build; **falta testar na prévia** e publicar (ainda só no ramo).

### E.5 Arquivar e reativar card (código pronto em 13/11)

- **Arquivar card:** botão no card, junto de "Enviar para outro pipeline", antes dos comentários,
  com confirmação. Usa `card.archived_at` (já existia). **Não apaga nada.**
- Card arquivado some do quadro, da Lista, do Painel e dos relatórios do MCP. Continua abrindo pelo
  link, com uma faixa "arquivado" e o botão **Reativar card**.
- **Arquivados:** botão no topo do quadro abre a lista dos arquivados do pipeline (etapa em que
  estava, data), com **Abrir** e **Reativar**. Ao reativar, o card volta para a mesma etapa, no fim
  da coluna.
- Permissão: `card:update` + enxergar o card. Histórico: `card_archived` / `card_restored`.
- Sem migration.

Situação: passa em typecheck e build; **não exercitado em navegador**; falta testar na prévia.

### E.6 Tempo por tarefa e "Minhas demandas" (código pronto em 13/11)

- **Opções do pipeline** (botão de engrenagem no topo do quadro, para quem tem `board:configure`):
  "Visão Minhas demandas" e "Controle de tempo por tarefa". Desligadas por padrão; Kanban e Lista
  não mudam.
- **Minhas demandas** (terceira visão, ao lado de Kanban e Lista): cards em que a pessoa é
  responsável, atrasados primeiro e depois por prazo; etapa, prazo, checklist, "Mover para" e o
  cronômetro. Concluídas embaixo. É a visão que abre para quem não gerencia o pipeline (sem escolha
  salva); gestores continuam abrindo no Kanban.
- **Cronômetro**: Iniciar / Pausar / Retomar no card. Uma tarefa por vez (iniciar outra pausa a
  anterior). Pausa sozinho quando o card vai para etapa de revisão ou concluído, é arquivado ou
  enviado a outro pipeline. Sem parada por tempo; acima de 10 h seguidas aparece um aviso e o botão
  "Parei em outro horário". "Meus períodos" permite corrigir início e fim (sem sobreposição, sem
  futuro, até 24 h por período); toda correção vai para o histórico do card (`time_edited`).
- **Painéis → Tempo por tarefa** (`/painel/tempo`, só `time:read`): equipe agora, horas por pessoa e
  por pipeline, cards que mais consumiram tempo, filtro por período.
- **Planilha por período** (`/api/relatorios/tempo`): detalhada (uma linha por período trabalhado)
  ou resumo por card; CSV com ";" e vírgula decimal (abre direto no Excel). Só `time:read`.
- Cada pessoa vê só o próprio tempo; `time:read` (Gestor Master e Gestor) vê o da equipe nos cards
  que enxerga (RLS). Escrita só pelo servidor.

Ainda não feito: resumo de "Minhas demandas" de todos os pipelines na tela Início; cronômetro dentro
do card aberto (hoje fica só em Minhas demandas); horas médias por tipo de material (depende de
como o pipeline da Produção Pedagógica marcar o tipo).

Situação: migration testada em Postgres local; telas passam em typecheck e build, "Minhas
demandas" conferida em navegador com dados de exemplo; **falta aplicar a 0041 e testar na prévia**.

### E.7 Visual novo, primeira etapa (13/11)

Aplicado no sistema todo, exceto o menu lateral (continua azul-marinho, `--color-brand`):

- cores da Produção Pedagógica: ação em azul-petróleo `#1E5A6E`, fundo `#F3F5F4`, texto `#16252A`;
  a escala `neutral` do Tailwind foi redefinida em `globals.css`, então todas as telas mudaram
  juntas; cores de alerta (ok, aviso, erro, info) também;
- fontes Literata (títulos), Figtree (texto) e IBM Plex Mono (números e cronômetros);
- cabeçalho de tabela em caixa alta sobre faixa cinza (`.tabela-cab`), etiqueta com ponto
  (`.chip`), face do card com título mais forte e sem sombra.

**Lista nova (13/11):** resumo clicável no topo (um número por etapa e os atrasados; clicar
filtra), filtros rápidos lado a lado (responsável, incluindo "sem responsável"; etapa; só
atrasados), coluna **Prazo** ordenável com atrasado em vermelho, e **Baixar planilha** (CSV com as
linhas e colunas na tela). Mantido tudo o que a Lista já fazia: edição na célula, colunas por
propriedade, filtro por qualquer propriedade, RICE e estrela no pipeline de demandas.

**Lista legível (13/11):** o texto não fica mais escondido: título, etapa, solicitante,
responsável e propriedades de texto ou de opção **quebram a linha** dentro da célula (a linha cresce;
Enter grava o título, Shift+Enter quebra a linha). A **largura de cada coluna** é ajustável
arrastando a borda direita do cabeçalho (ou pelo teclado: Tab até a borda e setas), entre 60 e 640 px;
fica lembrada por pipeline neste navegador, e "Larguras padrão" volta ao original. Se as colunas
somarem mais que a tela, a tabela rola de lado. Em "Minhas demandas", o seletor de etapa não passa
mais da borda do card.

Ainda não: destaque de card **parado** na Lista (o quadro ainda não carrega a data de entrada na
etapa) e o **modo escuro**, que a simulação tem e o sistema ainda não.

Também em 13/11: telas de erro com "Recarregar" (`app/global-error.tsx`, `app/(app)/error.tsx`);
quando o erro é de versão antiga depois de uma publicação, a página recarrega sozinha uma vez.

### E.8 Pipeline Produção Pedagógica e painel por pipeline (código pronto em 13/11)

- **Modelo ao criar pipeline:** em "Novo pipeline" há o campo **Modelo**. "Produção Pedagógica"
  cria as etapas Em produção → Aguardando análise (revisão) → Em emenda → Aprovado (concluído); as
  propriedades Segmento (Infantil, Fundamental 1, Fundamental 2) e Tipo de material (Básico, Up
  Grades, Escrita do Zero, Revisão Diagramado), que aparecem no card, e Início, Finalização e Link
  do autor; o prazo é o do próprio card. Já liga "Minhas demandas", o cronômetro e o painel
  próprio. Depois de criado é um pipeline comum: tudo pode mudar. Os modelos ficam em
  `lib/board/templates.ts`.
- **Emendas:** qualquer etapa pode ser marcada como **Etapa de emenda** (menu ⋯ da etapa). Cada vez
  que um card entra nela, o contador do card sobe (gatilho no banco, `card.rework_count`, vale para
  qualquer caminho que mude a etapa). O número aparece na face do card (selo âmbar) e numa coluna
  **Emendas** da Lista, ordenável e na planilha.
- **Painel por pipeline:** opção "Painel próprio em Painéis" nas opções do pipeline (engrenagem).
  Cada pipeline com a opção ganha uma aba em Painéis (`/painel/pipeline/<id>`): cards por etapa e
  atrasados; cards por responsável e por cada propriedade de opção (barras por etapa); emendas por
  opção; horas médias por opção nos cards concluídos e horas registradas hoje (só com `time:read`);
  dias da criação à conclusão e % concluídos sem emenda; lista de atrasados. É genérico: as quebras
  saem das propriedades de opção do pipeline, sem nome de campo fixo no código.
- Migration `0042_rework_and_panels.sql`. Antes dela o quadro funciona igual (sem emendas e sem a
  opção de painel); o modelo cria o pipeline sem a etapa de emenda marcada.

### E.9 Alçadas de acesso por pipeline (16/11)

Modelo (confirmado pelo David em 16/11):

| Papel | Pipelines que enxerga | Relatórios (Painéis, Tempo por tarefa) | Configura |
|---|---|---|---|
| Gestor Master | Todos | Todos | Tudo: pipelines, propriedades globais, papéis, usuários |
| Gestor | Todos | Todos | Pipelines, propriedades, usuários (não edita papéis) |
| Gestor de área | Só os marcados para ele | Só dos pipelines dele, inclusive o tempo da equipe neles | Etapas e cards dos pipelines dele |
| Membro interno | Só os marcados para ele | Visão geral e painéis dos pipelines dele; o próprio tempo | — |
| Externo | Só os cards atribuídos a ele | — | — |

- **Onde se define:** Configurações → Usuários, coluna **Pipelines**: "Todos" para quem vê tudo;
  para os demais, um botão com a contagem que abre a lista de pipelines para marcar. "Nenhum" fica
  em destaque. A mesma lista continua editável por pipeline, no seletor de pipelines.
- Pipeline novo não entra automaticamente para ninguém: o Gestor marca quem enxerga.
- Visão geral, painel próprio e Tempo por tarefa já leem com o RLS da pessoa, então mostram só o
  que ela enxerga. A 0043 dá `time:read` ao Gestor de área; a policy de `time_entry` limita aos
  cards que ele enxerga.
- Escritas conferem o escopo no servidor (ver "Segurança").

### E.10 Ajustes de 16/11 (pedido do David)

- **Lista no celular:** o botão Kanban/Lista aparece também no celular e a Lista abre de verdade
  (a tabela rola de lado). Antes o celular mostrava sempre uma etapa por vez, mesmo com "Lista"
  escolhida. O Kanban do celular continua sendo uma etapa por vez.
- **Minhas demandas sem troca de etapa:** o card mostra a etapa só para leitura. Mudar de etapa fica
  no Kanban, na Lista e com o card aberto.
- **Prazo editável (17/11):** o prazo do card (coluna "Prazo", presente em todos os quadros) era só
  leitura: nenhuma tela gravava. Agora edita-se na Lista (campo de data na célula) e no card aberto
  (seção "Prazo", com "Remover prazo"). Grava por `updateCard` (permissão `card:update` + escopo) e
  registra no histórico ("definiu/mudou/removeu o prazo").
- **Emendas editáveis (17/11):** a contagem automática continua (sobe 1 a cada ENTRADA do card numa
  etapa de emenda, venha de onde vier; reordenar dentro da etapa não conta), e o número agora pode
  ser corrigido à mão: na coluna Emendas da Lista e na seção "Emendas" do card aberto (0 a 999). A
  correção entra no histórico. O selo no card continua.
- **Prazo e emendas só pela gestão do pipeline (17/11):** os dois aparecem para todos, mas o botão
  de editar (lápis na Lista, "Editar prazo" / "Editar emendas" no card aberto) só aparece para quem
  gerencia aquele pipeline: Gestor de área que é membro dele, Gestor e Gestor Master. No servidor,
  `updateCard` exige `stage:manage` e que a pessoa enxergue o pipeline do card; os demais recebem
  recusa mesmo chamando direto.
- **Trazer propriedades de outro pipeline (17/11):** nas opções do pipeline (engrenagem), quem tem
  `field:manage` escolhe um pipeline de origem, vê o que muda e confirma. Só acrescenta no destino:
  cria as propriedades que faltam (com as opções e as marcações de aparecer no card, na criação e
  obrigatória) e as opções que faltam nas de opção; não apaga, não renomeia, não troca tipo e não
  toca nas etapas. Mesmo nome com tipo incompatível fica como está e é avisado. A regra de "mesma
  propriedade" é a do envio de card (nome igual e tipo compatível; opções pelo rótulo), em
  `core/fieldSync.ts`. Primeiro uso: Editora Pedagógico → Editora Diagramação.
- **Importar lista de usuários (17/11):** em Configurações → Usuários, "Importar lista": cola-se os
  e-mails, escolhe-se o papel e os pipelines; cria quem não existe e, para quem já existe, só
  acrescenta os pipelines. Um e-mail por chamada ao servidor (limite de subrequisições do Worker).
- **Nome da etapa no Kanban** com a mesma letra da Lista (17/11).
- **Link para o card na menção (17/11):** a mensagem que a pessoa mencionada recebe nas Conversas
  termina com a referência ao card (`/board?card=<id>`), mostrada como o link "Abrir o card"
  (`components/channels/MessageBody.tsx`). Endereços http(s) colados em mensagens também viram
  link; o resto continua texto puro. Mensagens antigas não ganham o link.
- **Limpeza do tamanho do Worker (17/11):** medido por pacote (metafile do esbuild do OpenNext). O
  Supabase entrava três vezes no bundle do Next, uma por camada do servidor; passou para
  `serverExternalPackages` e o OpenNext o empacota uma vez: **2.966 → 2.897 KiB** (limite 3.072).
  Conferido no runtime dos Workers local (`wrangler dev`): login, redirecionamento do middleware,
  `robots.txt` e a troca de código do `/auth/callback`. O que resta é quase todo do próprio Next
  (~2 MiB sem compressão), das páginas e do motor do Prisma (864 KiB comprimido, só usado por Novos
  alunos). Ganho maior daqui em diante pede separar Novos alunos em outro Worker ou o plano pago.
- **Aviso de atribuição nas Conversas (17/11):** quem é definido como responsável já recebia o
  aviso no sininho e o push; agora recebe também uma mensagem direta de quem atribuiu, com o link
  "Abrir o card", e o aviso do sininho mostra o nome do card e do pipeline.
- **Permissão `card:transfer` (17/11):** "Enviar cards para qualquer pipeline", em Configurações →
  Papéis. Com ela, o botão "Enviar para outro pipeline" lista todos os pipelines da organização;
  sem ela, só os de que a pessoa participa ou com a caixa de entrada aberta para ela (antes, só o
  Gestor, que vê todos, conseguia enviar para qualquer um). Nenhum papel a recebe por padrão.
- **Página tremendo em "Minhas demandas" (corrigido em 17/11):** com zoom no navegador, a largura
  do cabeçalho preso era calculada a partir da largura arredondada da janela e ficava alguns pixels
  maior que a área de conteúdo; isso criava uma barra de rolagem, que mudava a medida, que tirava a
  barra, em laço. Agora o cabeçalho só tem largura própria no Kanban e na Lista, medida pela
  própria área com 1px de folga, e a página reserva sempre o espaço da barra vertical
  (`scrollbar-gutter: stable`). Reproduzido e conferido com larguras fracionárias nas três visões.
- **Abrir "Novo card" e a Lista sem espera (18/11):** o clique em "Novo card" fazia três idas ao
  servidor em fila (recarregar o quadro inteiro por causa do `?novo=1`, buscar propriedades e
  pessoas, buscar modelos de checklist). Agora: (1) o endereço muda por `history.replaceState`, sem
  pedir o quadro de novo; (2) propriedades, valores, pessoas e modelos são buscados uma vez, em
  segundo plano, logo depois de o quadro aparecer (`BoardExtras`, numa chamada só) e reaproveitados
  pelos três formulários e pela Lista, que abre com as colunas prontas e confere por trás; (3) ao
  salvar, o formulário some na hora, o card aparece na primeira etapa como "salvando…" e é trocado
  pelo card de verdade quando o servidor responde; se o servidor recusar, o formulário volta com o
  erro e tudo o que foi digitado. Conferido em navegador local: janela em ~130 ms, Lista em
  ~140 ms, e o caminho de falha.
- **Modo escuro: descartado.** No lugar, a cor principal (menu e botões) passa a verde, no padrão do
  site da editora (lidas das imagens do site): menu `#092c23`; botões e links em verde mais vivo `#12703f` (a primeira versão, `#1d453a`, ficou sem contraste); item ativo do menu com o verde-limão `#a2c53e`.

### E.11 Modelos de checklist por pipeline (código pronto em 17/11)

Decidido com o David em 17/11: cada pipeline tem os seus modelos; sem checklist automático; no
formulário de criação a escolha é opcional.

- **Salvar como modelo:** em qualquer checklist de um card, a gestão do pipeline (`stage:manage` +
  enxergar o pipeline) clica em "salvar como modelo"; guarda o nome e os itens.
- **Usar modelo:** no card aberto, "Usar modelo" cria o checklist com todos os itens desmarcados
  (quem tem `card:update`). É cópia: editar o modelo depois não muda os cards.
- **Na criação:** os três formulários (simples, genérico e demandas) mostram "Checklists (opcional)"
  quando o pipeline tem modelos; o card nasce com os marcados.
- **Gerenciar modelos:** no card aberto, renomear, editar os itens (um por linha) e excluir.
- Migration `0045_checklist_templates.sql` (tabela `checklist_template`; leitura para quem enxerga o
  pipeline, escrita só pelo servidor). Antes dela, nada disso aparece e o resto funciona igual.
- A cópia para o card fica em `lib/board/checklistCopy.ts`, fora do arquivo de Server Actions,
  porque não confere permissão sozinha.

### E.12 Importação do sistema antigo "Produção Pedagógica" (roteiro pronto em 17/11)

Decidido com o David em 17/11: traz **tudo** (inclusive aprovados) para o pipeline **Editora
Pedagógico**; o diário vira texto corrido na descrição do card. Substitui o "começa do zero" de E.1.

Como eu não tenho acesso a nenhum dos dois bancos, a importação é um roteiro em três arquivos de
`infra/import/` (sem dado nenhum dentro), rodados pelo David no SQL Editor do banco atual:

1. `producao_pedagogica_1_preparo.sql`: cria tabelas de passagem (`import_pp_*`, só texto, sem
   acesso pela API) para receber os CSVs exportados do Supabase antigo.
2. `producao_pedagogica_2_importar.sql`: função `import_producao_pedagogica(pipeline, e-mail de
   quem assina, gravar)`. Com `false` **simula** e devolve o resumo (cards por etapa, responsáveis
   sem usuário, opções acrescentadas, avisos) sem gravar; com `true` grava. Rodar de novo não
   duplica (`import_pp_feito`).
3. `producao_pedagogica_3_limpeza.sql`: apaga as tabelas de passagem e a função.

Conversão: material → card; prazo → prazo; responsável pelo e-mail; etapa pela mesma regra de tela
do sistema antigo (aprovado → concluída; emenda → etapa de emenda; entregue ou reentregue →
revisão; resto → em andamento); emendas → emendas; segmento, tipo, início, finalização e link do
autor → propriedades de mesmo nome (opção inexistente é acrescentada); comentários do parecer →
comentários, assinados pelo e-mail informado, com a data original; histórico → histórico
(`legacy_note`). **Diário:** no sistema antigo é por pessoa e por dia, sem ligação com material;
entra na descrição de cada card do responsável os dias entre o início e o fim daquele material
(dia fora de qualquer material não entra; dia coberto por dois materiais entra nos dois).

**Executada em 17/11 pelo David:** 51 materiais importados (15 em produção, 6 aguardando
aprovação, 2 em emenda, 28 concluídos), 14 comentários e 228 linhas de histórico; sem avisos.
Ajustes feitos durante a simulação: início → propriedade "Data inicial"; link do autor →
"Pasta de trabalho"; tipos antigos convertidos para as opções "Básico" e "Upgrade"; sem
propriedade de finalização, a data de fim entrou no Prazo (36 cards; nenhum material tinha prazo
no sistema antigo); o diário estava vazio.

Testado em banco local com dados inventados (simulação não grava; cinco situações de etapa;
segunda execução não duplica). **Não testado com os dados reais.** Pré-requisitos: usuários
importados e propriedades do pipeline criadas.

### E.13 Acessos pontuais, Painéis da gestão e rolagem da página (código pronto em 17/11)

**Acessos (pedido do David em 17/11).** Cargo continua servindo só para as alçadas de aprovação.

| Área | Quem entra |
|---|---|
| Painéis | Só a gestão (`stage:manage`): Gestor de área (pipelines dele, pelo RLS), Gestor e Gestor Master. Membro comum não vê Painéis, nem o atalho no Início |
| Gestão de Vila | Gestor e Gestor Master (papel) ou quem tem a caixa "Gestão de Vila" marcada. A caixa dá acesso completo (ver e editar) |
| Novos alunos | Gestor e Gestor Master (papel) ou quem tem a caixa "Novos alunos" (nível atendimento). Psicólogas seguem entrando pelo cadastro no módulo; para o item aparecer no menu delas, marca-se a caixa |

- Caixas em Configurações → Usuários, coluna **Acessos**; só quem tem `user:manage` altera. O que o
  papel já dá aparece marcado e travado.
- O menu lateral mostra só o que a pessoa pode abrir.
- Migration `0046_user_access.sql`: tabela `user_grant`, função `has_access` e a leitura de
  `sala_state` passa a exigir o acesso (antes: qualquer interno). No servidor, o acesso pontual
  vira a permissão correspondente (`salas:manage`, `novos:access`) ao montar o ator.
- **Efeito ao publicar:** quem não é Gestor deixa de ver a Gestão de Vila e os Painéis até ter a
  caixa marcada (ou, nos Painéis, ser gestor do pipeline).

**Rolagem (pedido do David em 17/11).** No computador, o quadro (Kanban e Lista) não rola mais
dentro de uma caixa: a página rola, com uma barra de cada tipo. O cabeçalho do quadro fica preso no
topo e na esquerda, e o nome de cada etapa fica preso abaixo dele. O arrastar de cards continua
rolando a página sozinho perto das bordas. No celular nada mudou. A página de Configurações ficou
mais larga e o Cargo saiu da tabela de Usuários para a janela de edição (lápis).

### E.14 "Ver todos os cards" como permissão do papel (código pronto em 17/11)

Pedido do David: poder decidir, no papel (Configurações → Papéis), se o Membro interno vê todos os
cards do pipeline ou só os dele.

- Permissão nova `card:read_all`, "Ver todos os cards do pipeline", no grupo "Quadros e cards".
  **Marcada:** vê todos os cards dos pipelines a que tem acesso (como era). **Desmarcada:** vê só os
  cards em que é responsável ou solicitante. O pipeline, as etapas e as propriedades continuam
  visíveis.
- A regra fica no banco (`can_see_card`, migration `0047_card_read_all.sql`), então vale para o
  quadro, a Lista, Minhas demandas, comentários, checklists, tempo, histórico, tempo real e para as
  gravações do servidor (que consultam o mesmo RLS).
- A migration dá a permissão a todos os papéis existentes, menos o Externo: ninguém perde visão ao
  aplicar. A restrição começa quando a gestão desmarca a permissão de um papel.
- No cabeçalho do quadro, quem está restrito vê "· só os seus" ao lado da contagem.
- Papel novo criado na tela nasce sem a permissão (como as demais): marcar se for o caso.

### E.15 Importação dos quadros do Trello (roteiro pronto em 18/11)

Dois quadros exportados do Trello em JSON: DIAGRAMAÇÃO (119 cards ativos, 1.531 arquivados) e
PEDAGÓGICO (114 ativos, 77 arquivados). Decidido com o David em 18/11: trazer ativos **e**
arquivados; card ativo em lista arquivada vai para a primeira etapa; lista, etiquetas e membros do
Trello ficam no topo da descrição do card.

- Os JSON são convertidos (fora do repositório) num CSV único, `trello_cards.csv`, com uma linha
  por card. Os dados não entram no repositório.
- Roteiro em `infra/import/trello_{1_preparo,2_importar,3_limpeza}.sql`, no mesmo molde da
  importação anterior: tabela de passagem, função com simulação e gravação idempotente, limpeza.
- `import_trello(quadro, pipeline, e-mail, modo, gravar)`. Modo `'ordem'`: a N-ésima lista aberta do
  Trello vai para a N-ésima etapa do pipeline (Diagramação). Modo `'primeira'`: tudo na primeira
  etapa (Pedagógico → Backlog).
- Card arquivado no Trello entra arquivado no sistema, na etapa da lista dele. Vêm título,
  descrição, links anexados (todos do Google Drive/Docs) e checklists com o que já estava marcado.
  Comentários não vêm (não há nenhum nos arquivos). A data de criação é a do Trello.

**Executada em 18/11 pelo David:** Diagramação → Editora Diagramação por ordem (Backlog 82, Em
produção 6, Aguardando aprovação 15, Fechamento 9, Finalizado 7; 1.531 arquivados) e Pedagógico →
Backlog do Editora Pedagógico (114 ativos, 77 arquivados).

Testado em banco local com os dados reais (1.841 cards, menos de 1 segundo): contagens por etapa
conferem com os quadros, simulação não grava, segunda execução não duplica.

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
| C. WhatsApp (agente) | ~13,5 | Twilio (número + mensagens) + uso do modelo de linguagem. Sem VPS |
| **Total** | **~44** | |

**Decidido (12/11/2026):** ordem A → B → D → C; WhatsApp com um único número dedicado,
atuando como agente; gateway próprio, com os dados no Supabase da Eccoprime.

**Pendente:** (1) provedor do VPS do gateway (o Supabase não hospeda o programa);
(2) quem recebe `report:read` de início.

## Andamento

> Atualizado em **13/11/2026**. Os blocos A, B e D, a seção E até a Lista nova e o tempo por
> tarefa já estão no `main` (PR #3). O que vem depois fica no ramo `claude/fase2-quadro` (prévia
> do Cloudflare) até o próximo envio ao `main`.

> **18/11:** a seção "Trazer propriedades de outro pipeline" (Opções do pipeline) foi retirada a pedido do David, que relatou propriedades sumindo depois de salvar outras opções do mesmo diálogo. A causa não foi reproduzida: no código a cópia só acrescenta e nada no "Salvar" apaga propriedade. Saíram a tela e a action `syncFieldsFromBoard`; `planFieldSync` continua no core, sem uso.

### Banco

| Migration | O que faz | Situação |
|---|---|---|
| `0035_board_realtime_and_completion.sql` | Publica `card` e `stage` no Realtime; cria `card.completed_at` (gatilho) | ✅ Aplicada em 12/11 |
| `0036_report_overview.sql` | Função `report_pipeline_overview` (Painel e, depois, MCP) | ✅ Aplicada em 12/11 |
| `0037_push_subscription.sql` | Tabela `push_subscription` (uma linha por aparelho; RLS: cada um lê só as suas; escrita só pelo servidor) | ✅ Aplicada (conferida em 13/11). O push segue desligado até as chaves VAPID entrarem no Cloudflare |
| `0038_lock_definer_functions.sql` | Restringe `conversation_list` e `sala_state_set` (security definer) à chave de serviço | ✅ Aplicada em 12/11. Antes: executáveis por `anon` e `authenticated` (confirmado por consulta); depois: só `service_role` (confirmado) |
| `0039_mcp_reports.sql` | Permissão `report:read`; tabelas `api_token` e `api_token_call`; funções `report_*`; `mcp_call` | ✅ Aplicada em 12/11 |
| `0040_transfer_card.sql` | Função `transfer_card`: envia um card para outro pipeline numa transação | ✅ Aplicada em 12/11 |
| `0041_time_tracking.sql` | Opções `board.my_tasks` e `board.time_tracking`; tabela `time_entry` (um período aberto por pessoa); permissão `time:read`; funções `time_start` / `time_stop` | ✅ Aplicada em 13/11 (cronômetro funcionando) |
| `0042_rework_and_panels.sql` | `stage.counts_rework` (etapa de emenda), `card.rework_count` com gatilho que soma a cada entrada nela, `board.own_panel` (painel próprio) | ✅ Aplicada em 16/11 (testada na prévia) |
| `0043_area_time_read.sql` | Concede `time:read` ao papel Gestor de área (vê o tempo só nos pipelines dele) | ✅ Aplicada em 16/11 |
| `0044_user_phone.sql` | Tabela `user_phone`: telefone (E.164) por usuário, único, base do agente do WhatsApp | ✅ Aplicada em 16/11 |
| `0045_checklist_templates.sql` | Tabela `checklist_template`: modelos de checklist por pipeline | ✅ Aplicada em 17/11 |
| `0046_user_access.sql` | Acessos pontuais (`user_grant`, `has_access`) e leitura da Vila restrita a quem tem acesso | ✅ Aplicada em 17/11 |
| `0047_card_read_all.sql` | Permissão `card:read_all` nos papéis existentes e `can_see_card` passa a conferi-la | **A aplicar** |
| `0048_mcp_reports_v2.sql` | MCP: `report_time` (horas), `atividades` paginada com lotes agrupados e hora local, detalhe do card com emendas e tempo, alcance respeitando `card:read_all`. Só troca funções | **A aplicar** (depois, republicar o Worker `ecco-mcp`) |
| `0049_whatsapp_base.sql` | Tabela `whatsapp_message` (90 dias, sem leitura pelo navegador) e funções `whatsapp_inbound`/`whatsapp_outbound` (só chave de servidor) | ✅ Aplicada em 18/11 |
| `0050_whatsapp_agent.sql` | `board.whatsapp_enabled`/`whatsapp_instructions` e a função `whatsapp_agent` (porta única do agente, só chave de servidor, age como a pessoa) | ✅ Aplicada em 18/11 |
| `0051_whatsapp_audio.sql` | Função `whatsapp_set_transcript` (guarda o texto do áudio transcrito; só chave de servidor) | ✅ Aplicada em 18/11 |
| `0052_whatsapp_flow.sql` | `board.release_required` e `whatsapp_reminder_days`; fila `whatsapp_outbox` com gatilho em `activity`; funções de fila e de lembrete; `whatsapp_inbound` e `whatsapp_agent` atualizadas | **A aplicar** |
| `0053_whatsapp_reinforce.sql` | `whatsapp_agent`: o reforço de pedido entra no fim da descrição e num comentário com o nome de quem reforçou (solicitante original mantido) | **A aplicar** |
| `0054_whatsapp_same_request.sql` | `whatsapp_agent`: `reforcar_pedido` exige os campos obrigatórios e só aceita se forem iguais aos do card; com mais de um card aberto igual, devolve a lista e exige a escolha da pessoa | **A aplicar** |
| `0055_whatsapp_images.sql` | `whatsapp_message.kind` aceita 'image'; tabela `whatsapp_media`; `whatsapp_media_add` e `whatsapp_attach_media`; `whatsapp_agent` anexa fotos pendentes ao abrir/reforçar e ganha `anexar_imagens` | **A aplicar** |
| `0056_drive_archive.sql` | `board.drive_archive`; tabelas `drive_folder` e `card_drive`; fila `whatsapp_drive_take` e confirmações (`_folder`, `_card`, `_image`) para gravar evidências no Google Drive | **A aplicar** |
| `0057_whatsapp_routine.sql` | Função `whatsapp_routine` (Luix na rotina da Gestão de Vila: buscar aluno e registrar falta, atraso, +time e observação; só chave de servidor, exige `has_access('salas')`) | **A aplicar** |

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
- **Escritas sem checagem de escopo (corrigido no ramo, 16/11).** As telas já escondiam do Gestor
  de área os pipelines dos quais ele não é membro, mas as gravações do servidor (mover, editar
  card, comentar, checklist, anexo, responsável, propriedades, etapas, priorização) usavam a chave
  de serviço e só conferiam a permissão do papel, não o pipeline. Quem tivesse o id de um card ou
  de uma etapa de outro pipeline podia mexer nele. Agora toda escrita passa por
  `lib/board/scope.ts`, que consulta o mesmo RLS das telas (`can_see_board` / `can_see_card`) e
  responde "não encontrado" fora do escopo. Gestor e Gestor Master (`board:configure`) seguem vendo
  tudo. **O `main` continua com a falha até este ramo ser publicado.**
- **Revisão de segurança de 16/11.** Conferidos: login e provisionamento, middleware, rotas de API,
  todas as ações do servidor (permissão e escopo), HTML e links vindos de dados, segredos no
  repositório e dependências. Corrigido no ramo:
  - *Login só pelo Google* (`lib/auth.ts`): a sessão só vale se a identidade veio do Google. O acesso
    interno é decidido pelo domínio do e-mail; uma conta criada por e-mail e senha direto na API do
    Supabase poderia declarar um e-mail da organização. Complemento no painel do Supabase: deixar
    ligado só o provedor Google (Email e anônimo desligados).
  - *Cabeçalhos de segurança* em todas as respostas (`next.config.ts`): `X-Frame-Options: DENY` e
    `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, HSTS, `Permissions-Policy`; sem
    `X-Powered-By`.
  - *Fora dos buscadores:* `X-Robots-Tag: noindex, nofollow` em tudo, meta `robots` no layout e
    `/robots.txt` com `Disallow: /` (também no Worker do MCP).
  - *Dependências:* Next 15.5.20 → 15.5.29 (três avisos críticos de execução remota de código),
    Tiptap/ProseMirror (XSS ao colar) e zod 3 atualizados. Restam avisos "altos" só em ferramentas
    de build (glob, postcss, sharp, prisma config), que não rodam no Worker, e um do zod que só
    fecha na versão 4 (troca maior, fica para depois).
  - Sem achados: redirecionamento aberto no login (destino só interno), `dangerouslySetInnerHTML`
    (não há), segredos versionados (não há), cron (segredo com comparação em tempo constante).
  - Fica como está, por decisão anterior: imagens coladas na descrição ficam num bucket público com
    nome aleatório (quem tem o link vê a imagem sem login).
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
