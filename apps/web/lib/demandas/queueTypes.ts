/** View-models da fila de priorização (fora do arquivo "use server"). */

export interface QueueItem {
  cardId: string;
  number: number;
  title: string;
  stageId: string;
  stageName: string;
  /** Está parada na etapa cuja saída depende da priorização. */
  awaitingPrioritization: boolean;
  rice: number | null;
  riceComplete: boolean;
  tipo: string | null;
  area: string | null;
  orcamento: number | null;
  urgencia: string | null;
  risco: string | null;
  responsavel: string | null;
  /** Abertura do card — base do prazo (SLA) por urgência. */
  createdAt: string;
  prioritized: { by: string; at: string; rank: number } | null;
}

export interface QueueData {
  boardId: string;
  boardName: string;
  items: QueueItem[];
}
