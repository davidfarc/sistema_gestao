// Contrato de nomes das propriedades da demanda no board (migration 0016).
// Fonte única entre o formulário de criação e o painel de resumo/aprovação.
export const DF = {
  tipo: "Tipo de demanda",
  area: "Área beneficiada",
  urgencia: "Urgência",
  risco: "Risco percebido",
  orcamento: "Orçamento estimado (R$)",
  custoAnual: "Custo anualizado (R$/ano)",
  data: "Data pretendida",
  recorrente: "Compra recorrente",
  fornecedorUnico: "Fornecedor único",
  foraOrcamento: "Fora do orçamento planejado",
  reversibilidade: "Reversibilidade baixa",
  fracionamento: "Fracionamento (30 dias)",
  isList: "É lista de compras?",
  justificativa: "Justificativa",
  cotacoes: "Cotações / evidências",
  riceAlcance: "RICE - Alcance",
  riceImpacto: "RICE - Impacto",
  riceConfianca: "RICE - Confiança (%)",
  // Esforço = Tempo + Complexidade + Orçamento (o score do orçamento é derivado
  // do valor da demanda, por isso não tem campo próprio).
  riceTempo: "RICE - Tempo (meses)",
  riceComplexidade: "RICE - Complexidade",
} as const;
