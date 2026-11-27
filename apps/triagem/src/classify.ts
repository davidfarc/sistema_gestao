import { CLASSIFIER_PROMPT, CLASSIFIER_SCHEMA } from "./prompt.ts";

export interface Label {
  assunto: string[];
  acao: string;
  gravidade: string;
  risco_escalar: string;
  queixa_formal: boolean;
  confianca: string;
  motivo_direcao: string;
}

/**
 * Classifica uma conversa. Devolve null em qualquer falha (a conversa fica para
 * a próxima rodada). O texto vai só na chamada; a OpenAI não o guarda para treino.
 */
export async function classify(
  apiKey: string,
  model: string,
  episode: { canal?: unknown; turma?: unknown; turnos?: unknown },
  fetcher: typeof fetch = fetch,
): Promise<Label | null> {
  try {
    const res = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: CLASSIFIER_PROMPT },
          { role: "user", content: JSON.stringify({ canal: episode.canal, turma: episode.turma ?? null, turnos: episode.turnos }) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "classificacao", strict: true, schema: CLASSIFIER_SCHEMA } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error("openai HTTP", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string | null; refusal?: string | null } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return null;
    const label = JSON.parse(content) as Label;
    return typeof label?.acao === "string" && Array.isArray(label.assunto) ? label : null;
  } catch (e) {
    console.error("classificação", e instanceof Error ? e.name : "erro");
    return null;
  }
}
