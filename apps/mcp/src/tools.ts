/**
 * As 8 ferramentas do MCP (SPEC-FASE2 §D.2). Aqui fica só a "vitrine": nome,
 * descrição e formato dos argumentos, que é o que o assistente lê para decidir
 * qual usar. As contas ficam no banco (funções `report_*`, migrations 0039 e 0048).
 */

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

const periodo = {
  dias: {
    type: "integer",
    minimum: 1,
    maximum: 366,
    description: "Olhar os últimos N dias (padrão 30). Ignorado se 'de' for informado.",
  },
  de: { type: "string", description: "Início do período, AAAA-MM-DD (dia de São Paulo)." },
  ate: { type: "string", description: "Fim do período (inclusive), AAAA-MM-DD. Padrão: hoje." },
};

const pipeline = {
  type: "string",
  description: "Nome do pipeline (ou parte dele). Use listar_pipelines para ver os nomes.",
};

const usuario = {
  type: "string",
  description: "Nome (ou parte), e-mail ou id da pessoa.",
};

function tool(
  name: string,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): ToolDef {
  return {
    name,
    title,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
  };
}

export const TOOLS: ToolDef[] = [
  tool(
    "listar_pipelines",
    "Listar pipelines",
    "Lista os pipelines (quadros) que a pessoa enxerga, com as etapas de cada um e quantos cards há em cada etapa. Bom ponto de partida para descobrir os nomes.",
    {},
  ),
  tool(
    "resumo_pipeline",
    "Resumo de um pipeline",
    "Situação de um pipeline: cards em aberto, atrasados e parados agora; criados e concluídos no período; tempo médio do início ao fim; e, por etapa, quantos cards há e quanto tempo em média ficam nela. Use para 'como está o pipeline X?' e 'onde está travando?'.",
    { pipeline, ...periodo },
    ["pipeline"],
  ),
  tool(
    "atividades",
    "Atividades no período",
    "Linha do tempo do que aconteceu: cards criados, movimentações entre etapas, trocas de responsável, prazos e emendas alterados, itens de checklist e comentários, do mais recente para o mais antigo. Cada evento traz 'quando' (UTC) e 'quando_local' (São Paulo). Ações em lote (ex.: importação de muitos cards no mesmo instante) vêm como UMA linha com 'lote' e 'quantidade'. Sempre confira 'truncado': se for verdadeiro, chame de novo com pular = 'proxima_pagina' até acabar antes de contar ou resumir. 'total_de_acoes' conta cada lote uma vez; 'total_de_eventos' conta card a card. Filtrar por outra pessoa exige permissão de gestão.",
    {
      ...periodo,
      pipeline,
      usuario,
      limite: { type: "integer", minimum: 1, maximum: 300, description: "Máximo de linhas por página (padrão 100)." },
      pular: { type: "integer", minimum: 0, description: "Quantas linhas pular (use o 'proxima_pagina' da resposta anterior)." },
      agrupar_lotes: {
        type: "boolean",
        description: "Juntar ações em lote numa linha só (padrão: sim). Use false para ver card a card.",
      },
    },
  ),
  tool(
    "tempo_por_tarefa",
    "Horas registradas (cronômetro)",
    "Horas apontadas no cronômetro dos cards, no período: total, por pessoa, por pipeline, por dia e por card (os 50 com mais horas), além de quem está com o cronômetro ligado agora. Use para 'quantas horas a equipe trabalhou?' e 'em que card foi gasto mais tempo?'. Só conta pipelines com o controle de tempo ligado e o que as pessoas de fato cronometraram; não é folha de ponto. Quem não tem a permissão de ver o tempo da equipe vê só o próprio.",
    { ...periodo, pipeline, usuario },
  ),
  tool(
    "produtividade_usuario",
    "Produtividade por pessoa",
    "Números por pessoa no período: cards concluídos, tempo médio de conclusão, movimentações, cards criados, comentários, itens de checklist, e quantos cards tem em aberto e atrasados agora. Quem não é gestor vê só os próprios números.",
    { usuario, ...periodo },
  ),
  tool(
    "produtividade_pipeline",
    "Comparativo entre pipelines",
    "Compara os pipelines no período: criados, concluídos, vazão por semana, tempo de ciclo médio e o gargalo (etapa onde os cards ficam mais tempo).",
    { ...periodo },
  ),
  tool(
    "buscar_cards",
    "Buscar cards",
    "Procura cards por texto do título ou número, com filtros opcionais de pipeline, etapa, responsável, só em aberto ou só atrasados. Devolve etapa, responsável, prazo e há quantos dias está na etapa.",
    {
      texto: { type: "string", description: "Parte do título, ou o número do card (ex.: '142' ou '#142')." },
      pipeline,
      etapa: { type: "string", description: "Nome da etapa (ou parte)." },
      usuario: { ...usuario, description: "Responsável pelo card: nome (ou parte), e-mail ou id." },
      so_em_aberto: { type: "boolean", description: "Só cards não concluídos." },
      so_atrasados: { type: "boolean", description: "Só cards em aberto com prazo vencido." },
      limite: { type: "integer", minimum: 1, maximum: 100, description: "Máximo de cards (padrão 30)." },
    },
  ),
  tool(
    "detalhe_card",
    "Detalhe de um card",
    "Tudo de um card: etapa, responsável, solicitante, prazo, descrição, propriedades, checklists, comentários recentes, emendas, horas registradas no cronômetro e histórico (movimentações e alterações). Informe o id (vem de buscar_cards) ou o número com o pipeline.",
    {
      card: { type: "string", description: "Id do card, ou o número (ex.: '#142')." },
      pipeline: { ...pipeline, description: "Necessário quando 'card' é um número que existe em mais de um pipeline." },
    },
    ["card"],
  ),
];

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export const INSTRUCTIONS =
  "Servidor de consulta (somente leitura) do Sistema de Gestão Ecco Prime: pipelines (quadros Kanban), cards, atividades e produtividade da equipe. " +
  "Você enxerga exatamente os pipelines que o dono do token enxerga. Comece por listar_pipelines para conhecer os nomes. " +
  "Períodos usam 'dias' (padrão 30) ou 'de'/'ate' em AAAA-MM-DD, no fuso de São Paulo. " +
  "'Parado' significa mais de 7 dias na mesma etapa; 'atrasado' é prazo vencido em card não concluído. " +
  "Em 'atividades', horários vêm em UTC ('quando') e em São Paulo ('quando_local'); use o local para dizer o dia. Se 'truncado' vier verdadeiro, pagine com 'pular' antes de tirar conclusões. Linhas com 'lote' são ações automáticas (importações): não as conte como trabalho de uma pessoa. " +
  "Horas trabalhadas vêm de tempo_por_tarefa (cronômetro dos cards), não da contagem de eventos. " +
  "Cards de teste podem existir misturados aos reais: na dúvida, pergunte. " +
  "Tempos por etapa de movimentações antigas são reconstruídos pelo histórico e podem ser aproximados. " +
  "Dados de alunos e famílias (Gestão de Vila, Novos alunos) não estão disponíveis aqui.";
