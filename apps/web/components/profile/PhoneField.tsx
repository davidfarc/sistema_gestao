"use client";

import { useEffect, useState } from "react";

import { loadMyPhone, setMyPhone } from "@/lib/profile/actions";

/** "Meu telefone" (em Avisos): o número pelo qual o agente do WhatsApp me reconhece. */
export function PhoneField() {
  const [state, setState] = useState<{ phone: string | null; available: boolean } | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadMyPhone()
      .then((s) => {
        setState(s);
        setValue(s.phone ?? "");
      })
      .catch(() => setState({ phone: null, available: false }));
  }, []);

  if (!state?.available) return null;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await setMyPhone(value);
      if (res.ok) {
        setValue(res.phone ?? "");
        setState({ phone: res.phone, available: true });
        setMessage({ ok: true, text: res.phone ? "Telefone salvo." : "Telefone removido." });
      } else setMessage({ ok: false, text: res.error });
    } catch {
      setMessage({ ok: false, text: "Não foi possível salvar. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="text-base font-semibold text-neutral-800">Meu telefone (WhatsApp)</h2>
      <p className="mt-1 text-sm text-neutral-600">
        É por este número que o assistente do WhatsApp reconhece você para abrir e acompanhar pedidos.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 gap-1 text-sm text-neutral-700">
          <span className="sr-only">Telefone com DDD</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="(84) 99999-8888"
            className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-base outline-none focus:border-neutral-500"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={busy || value === (state.phone ?? "")}
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
        >
          {busy ? "Salvando…" : "Salvar"}
        </button>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={"mt-2 text-sm " + (message.ok ? "text-emerald-700" : "text-red-700")}>
          {message.text}
        </p>
      )}
    </section>
  );
}
