"use client";

import { useEffect, useState } from "react";

import { setMyPhone } from "@/lib/profile/actions";

const SNOOZE_KEY = "ecco_telefone_depois";
const SNOOZE_DAYS = 7;

/**
 * Convite para cadastrar o telefone, mostrado a quem ainda não tem (primeiro
 * acesso em diante). "Agora não" adia por alguns dias neste navegador.
 */
export function PhonePrompt() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let until = 0;
    try {
      until = Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0);
    } catch {
      // Sem armazenamento: mostra o convite.
    }
    if (!(until > Date.now())) setOpen(true);
  }, []);

  if (!open) return null;

  function later() {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000));
    } catch {
      // Vale só até recarregar.
    }
    setOpen(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await setMyPhone(value);
      if (res.ok && res.phone) setOpen(false);
      else setError(res.ok ? "Informe o telefone com o DDD." : res.error);
    } catch {
      setError("Não foi possível salvar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:pt-24">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-prompt-title"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
      >
        <div className="border-b border-neutral-200 p-5">
          <h2 id="phone-prompt-title" className="text-lg font-semibold text-neutral-800">
            Complete seu cadastro
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Informe o seu telefone com WhatsApp. É por ele que o assistente do sistema reconhece você
            para abrir pedidos e mandar as atualizações. Só a gestão do sistema vê este número.
          </p>
        </div>
        <div className="p-5">
          <label className="grid gap-1 text-sm text-neutral-700">
            Telefone com DDD
            <input
              autoFocus
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="(84) 99999-8888"
              className="min-h-11 rounded-lg border border-neutral-300 px-3 text-base outline-none focus:border-neutral-500"
            />
          </label>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 p-4">
          <button type="button" onClick={later} className="min-h-10 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700">
            Agora não
          </button>
          <button type="submit" disabled={busy || !value.trim()} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50">
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
