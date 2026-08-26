/** View-models dos gráficos de gasto (fora do arquivo "use server"). */

/** Em qual fila a demanda está, para efeito dos gráficos. */
export type Bucket =
  | "analise" // parada no checkpoint, ainda sem prioridade
  | "priorizada" // prioridade definida, compra ainda não feita
  | "realizado" // já entrou na etapa de compra realizada (ou passou dela)
  | "fora"; // antes do checkpoint — não entra nos gráficos

export interface DemandRow {
  cardId: string;
  number: number;
  title: string;
  valor: number | null;
  areaId: string | null;
  tipoId: string | null;
  /** Mês/ano da "Data pretendida". Null quando o campo está vazio. */
  year: number | null;
  month: number | null;
  bucket: Bucket;
}

export interface PlanCell {
  year: number;
  month: number;
  categoryId: string;
  amount: number;
}

export interface Categoria {
  id: string;
  label: string;
}

export interface SpendData {
  boardId: string;
  boardName: string;
  rows: DemandRow[];
  plan: PlanCell[];
  areas: Categoria[];
  tipos: Categoria[];
  /** Anos com dado (planejamento ou data pretendida), para o seletor. */
  anos: number[];
  /** true = o quadro não tem etapa de compra marcada; o gráfico avisa. */
  semEtapaDeCompra: boolean;
}
