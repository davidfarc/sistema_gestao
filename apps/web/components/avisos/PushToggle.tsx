"use client";

import { BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";

import {
  deletePushSubscription,
  getPushPublicKey,
  savePushSubscription,
  sendTestPush,
} from "@/lib/push/actions";

type State =
  | "loading"
  | "unsupported" // navegador sem push (ou iPhone fora do app instalado)
  | "unconfigured" // o sistema ainda não tem as chaves de envio
  | "off" // disponível, ainda não ativado neste aparelho
  | "on"
  | "blocked"; // a pessoa negou a permissão no navegador

function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  let bin = "";
  for (const b of new Uint8Array(buffer)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Liga e desliga as notificações push NESTE aparelho (menção, card atribuído e
 * mensagem direta). Cada aparelho é ativado separadamente.
 */
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return active && setState("unsupported");
      const key = await getPushPublicKey().catch(() => null);
      if (!active) return;
      if (!key) return setState("unconfigured");
      setPublicKey(key);
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (active) setState(sub ? "on" : "off");
    })().catch(() => active && setState("unsupported"));
    return () => {
      active = false;
    };
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toBytes(publicKey),
        }));
      const saved = await savePushSubscription({
        endpoint: sub.endpoint,
        p256dh: toBase64Url(sub.getKey("p256dh")),
        auth: toBase64Url(sub.getKey("auth")),
      });
      if (!saved.ok) {
        await sub.unsubscribe().catch(() => null);
        setNote(saved.error);
        return;
      }
      setState("on");
      const delivered = await sendTestPush();
      setNote(
        delivered > 0
          ? "Pronto. Enviamos uma notificação de teste para este aparelho."
          : "Ativado, mas a notificação de teste não saiu. Tente “Enviar teste” em instantes.",
      );
    } catch {
      setNote("Não foi possível ativar neste navegador. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const delivered = await sendTestPush();
      setNote(
        delivered > 0
          ? "Notificação de teste enviada."
          : "O envio não saiu. Desative e ative de novo neste aparelho.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Sem as chaves no servidor não há o que oferecer: fica invisível.
  if (state === "loading" || state === "unconfigured") return null;

  const primary =
    "min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50";
  const secondary =
    "min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";

  return (
    <section
      aria-label="Notificações neste aparelho"
      className="rounded-xl border border-neutral-200 bg-white p-4"
    >
      <div className="flex items-start gap-3">
        <div
          className={
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg " +
            (state === "on" ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-600")
          }
        >
          {state === "on" ? (
            <BellRing className="h-5 w-5" aria-hidden="true" />
          ) : (
            <BellOff className="h-5 w-5" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-neutral-800">Notificações neste aparelho</p>
          {state === "on" && (
            <p className="mt-1 text-sm text-neutral-600">
              Ativadas. Você é avisado quando alguém menciona você, lhe atribui um card ou manda
              uma mensagem direta.
            </p>
          )}
          {state === "off" && (
            <p className="mt-1 text-sm text-neutral-600">
              Receba um aviso no aparelho, mesmo com o sistema fechado, quando alguém mencionar
              você, lhe atribuir um card ou mandar uma mensagem direta.
            </p>
          )}
          {state === "blocked" && (
            <p className="mt-1 text-sm text-neutral-600">
              As notificações deste site estão bloqueadas no navegador. Para liberar, toque no
              cadeado ao lado do endereço, abra as permissões do site e permita “Notificações”.
              Depois recarregue esta tela.
            </p>
          )}
          {state === "unsupported" && (
            <p className="mt-1 text-sm text-neutral-600">
              Este navegador não oferece notificações. No iPhone, elas só funcionam com o sistema
              instalado na Tela de Início e aberto pelo ícone (iOS 16.4 ou mais novo).
            </p>
          )}

          {(state === "on" || state === "off") && (
            <div className="mt-3 flex flex-wrap gap-2">
              {state === "off" ? (
                <button type="button" onClick={enable} disabled={busy} className={primary}>
                  {busy ? "Ativando…" : "Ativar notificações"}
                </button>
              ) : (
                <>
                  <button type="button" onClick={test} disabled={busy} className={secondary}>
                    Enviar teste
                  </button>
                  <button type="button" onClick={disable} disabled={busy} className={secondary}>
                    Desativar neste aparelho
                  </button>
                </>
              )}
            </div>
          )}
          {note && (
            <p role="status" className="mt-2 text-sm text-neutral-700">
              {note}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
