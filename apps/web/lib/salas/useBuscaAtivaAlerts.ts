"use client";

import type { BuscaAtivaAlert } from "@/lib/salas/types";

/**
 * Alertas da Busca Ativa.
 *
 * ⚠️ PENDENTE (combinado: Busca Ativa fica para o fim). No sistema de origem,
 * estes alertas NÃO eram calculados pelo app: vinham prontos de um nó do
 * Firebase alimentado por uma automação em Python que não está no repositório.
 *
 * Como a chamada diária (`dailyRoutine`) agora vive no nosso banco, o caminho
 * natural é calcular os níveis aqui mesmo — faltas consecutivas ⇒ verde (3),
 * laranja (5), vermelho (7) — em vez de depender de um job externo. Por ora
 * devolve vazio para não exibir dado inventado.
 */
export function useBuscaAtivaAlerts(): { alerts: BuscaAtivaAlert[]; loading: boolean } {
  return { alerts: [], loading: false };
}

export default useBuscaAtivaAlerts;
