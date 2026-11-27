"use client";

import { useState, type FormEvent } from "react";

import { answerSurvey } from "./actions";

const NOTAS = [1, 2, 3, 4, 5];
const RESOLVIDO = ["Sim", "Em parte", "Não"];

export function SurveyForm({ token }: { token: string }) {
  const [nota, setNota] = useState<number | null>(null);
  const [resolvido, setResolvido] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (nota === null) return setError("Escolha uma nota de 1 a 5.");
    if (resolvido === null) return setError("Diga se o assunto foi resolvido.");
    setSending(true);
    setError(null);
    const res = await answerSurvey(token, nota, resolvido, comentario).catch(() => ({
      ok: false as const,
      error: "Não foi possível registrar agora. Tente de novo em instantes.",
    }));
    setSending(false);
    if (res.ok) setDone(true);
    else setError(res.error);
  }

  if (done) {
    return (
      <p role="status" className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-lg text-neutral-800">
        Resposta registrada. Obrigado pela sua opinião!
      </p>
    );
  }

  const chip = (on: boolean) =>
    "min-h-12 rounded-xl border px-4 text-base font-medium transition-colors " +
    (on ? "border-primary bg-primary text-white" : "border-neutral-300 bg-white text-neutral-800 hover:border-primary");

  return (
    <form onSubmit={submit} className="grid gap-6 rounded-2xl border border-neutral-200 bg-white p-5">
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold text-neutral-900">1. Que nota você dá para a reunião?</legend>
        <div className="grid grid-cols-5 gap-2">
          {NOTAS.map((n) => (
            <button key={n} type="button" aria-pressed={nota === n} onClick={() => setNota(n)} className={chip(nota === n)}>
              {n}
            </button>
          ))}
        </div>
        <p className="flex justify-between text-xs text-neutral-500">
          <span>1 = muito ruim</span>
          <span>5 = excelente</span>
        </p>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold text-neutral-900">2. O assunto da reunião foi resolvido?</legend>
        <div className="grid grid-cols-3 gap-2">
          {RESOLVIDO.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={resolvido === r}
              onClick={() => setResolvido(r)}
              className={chip(resolvido === r)}
            >
              {r}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="grid gap-2">
        <span className="font-semibold text-neutral-900">3. Quer deixar um comentário? (opcional)</span>
        <textarea
          id="comentario"
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          maxLength={1000}
          rows={4}
          className="rounded-xl border border-neutral-300 p-3 text-base outline-none focus:border-primary"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={sending}
        className="min-h-12 rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-high disabled:opacity-60"
      >
        {sending ? "Enviando…" : "Enviar resposta"}
      </button>
    </form>
  );
}
