/** View-models do planejamento de gastos (fora do arquivo "use server"). */

export interface PlanCategory {
  id: string;
  label: string;
}

export interface PlanGrid {
  boardId: string;
  boardName: string;
  year: number;
  /** Linhas da grade — vêm das opções do campo, não de lista fixa no código. */
  categories: PlanCategory[];
  /** amounts[categoryId][1..12]. Célula ausente = zero. */
  amounts: Record<string, Record<number, number>>;
}

export const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
] as const;
