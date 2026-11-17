"use client";

import { Check, Link2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { createCard } from "@/lib/board/actions";
import { TemplatePicker } from "./TemplatePicker";
import { newCardHref, NOVO_PARAM } from "@/lib/board/newCardLink";
import { useBoardId, useCreationForm } from "./BoardContext";
import { CUSTOM_FORMS } from "./customForms";
import { GenericCreateForm } from "./GenericCreateForm";

/**
 * Botão "Novo card" que abre o formulário conforme o modo do pipeline.
 *
 * O "está aberto" mora na URL (`?novo=1`), não em estado local, para que o
 * formulário tenha endereço próprio e possa virar atalho no portal. Quem decide
 * QUAL formulário aparece continua sendo o `creation_form` do pipeline — o link
 * não carrega essa informação, então segue valendo se o modo mudar depois.
 */
export function NewCardDialog({
  canCreate = true,
  optimistic,
}: {
  canCreate?: boolean;
  /**
   * Criação sem espera, fornecida pelo quadro: `begin` mostra o card na coluna
   * assim que a gravação começa, `commit` troca pelo card de verdade e `abort`
   * o retira se o servidor recusar. Sem isto, a tela recarrega ao criar.
   */
  optimistic?: {
    begin: (title: string) => string;
    commit: (tempId: string, cardId: string) => void;
    abort: (tempId: string) => void;
  };
}) {
  const router = useRouter();
  const params = useSearchParams();
  // Gravando: o formulário some da tela (continua montado, com o que foi
  // digitado) e volta só se o servidor recusar.
  const [saving, setSaving] = useState(false);
  const tempId = useRef<string | null>(null);
  const boardId = useBoardId();
  const mode = useCreationForm();

  const open = params.get(NOVO_PARAM) === "1";

  function setOpen(next: boolean) {
    const q = new URLSearchParams(window.location.search);
    if (next) q.set(NOVO_PARAM, "1");
    else q.delete(NOVO_PARAM);
    const qs = q.toString();
    // `history.replaceState` (e não `router.replace`): muda o endereço sem
    // pedir o quadro de novo ao servidor, então o formulário abre na hora. O
    // Next mantém `useSearchParams` em dia com ele. "Replace" porque abrir e
    // fechar o formulário não deve empilhar histórico.
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }

  function saving_(title: string) {
    if (!optimistic) return;
    tempId.current = optimistic.begin(title);
    setSaving(true);
  }

  function failed() {
    if (tempId.current && optimistic) optimistic.abort(tempId.current);
    tempId.current = null;
    setSaving(false);
  }

  function done(cardId: string) {
    setOpen(false);
    setSaving(false);
    if (optimistic && tempId.current) optimistic.commit(tempId.current, cardId);
    else router.refresh();
    tempId.current = null;
  }

  const customKey = mode.startsWith("custom:") ? mode.slice("custom:".length) : null;
  const CustomForm = customKey ? CUSTOM_FORMS[customKey]?.Component : null;

  return (
    <>
      <CopyLinkButton boardId={boardId} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={saving}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-high disabled:opacity-60"
      >
        {saving ? "Criando…" : "+ Novo card"}
      </button>

      {open && (
        <div hidden={saving}>
          {!canCreate ? (
            <SemPermissao onClose={() => setOpen(false)} />
          ) : mode === "generic" ? (
            <GenericCreateForm boardId={boardId} onClose={() => setOpen(false)} onCreated={done} onSaving={saving_} onFailed={failed} />
          ) : CustomForm ? (
            <CustomForm boardId={boardId} onClose={() => setOpen(false)} onCreated={done} onSaving={saving_} onFailed={failed} />
          ) : (
            <SimpleCreate boardId={boardId} onClose={() => setOpen(false)} onCreated={done} onSaving={saving_} onFailed={failed} />
          )}
        </div>
      )}
    </>
  );
}

/** Copia o endereço do formulário, para colar em e-mail/WhatsApp. */
function CopyLinkButton({ boardId }: { boardId: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    const url = `${window.location.origin}${newCardHref(boardId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de área de transferência: mostra o link para copiar à mão.
      window.prompt("Copie o link do formulário:", url);
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      title="Copiar link do formulário de criação"
      aria-label="Copiar link do formulário de criação"
      className="rounded-lg border border-neutral-200 p-1.5 text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800"
    >
      {copiado ? (
        <Check className="h-4 w-4 text-emerald-600" />
      ) : (
        <Link2 className="h-4 w-4" />
      )}
    </button>
  );
}

/**
 * Quem chega pelo link sem permissão de criar merece uma explicação, não um
 * formulário que só falha ao enviar. A action já barra no servidor.
 */
function SemPermissao({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold text-neutral-800">Sem permissão para criar</h2>
        <p className="mt-2 text-sm text-neutral-500">
          Seu perfil não pode criar cards neste pipeline. Fale com a gestão para pedir acesso.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-high"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

/** Formulário simples: só o título (modo 'simple' e fallback). */
export function SimpleCreate({
  boardId,
  onClose,
  onCreated,
  onSaving,
  onFailed,
}: {
  boardId: string;
  onClose: () => void;
  onCreated: (cardId: string) => void;
  onSaving?: (title: string) => void;
  onFailed?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Dê um nome ao card.");
      return;
    }
    setError(null);
    onSaving?.(title.trim());
    startTransition(async () => {
      try {
        onCreated(await createCard(boardId, title, templateIds));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao criar o card.");
        onFailed?.();
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => !pending && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold text-neutral-800">Novo card</h2>
        <p className="mt-0.5 text-xs text-neutral-600">
          Só o nome. O #ID é automático; as propriedades você preenche depois.
        </p>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nome do card"
          className="mt-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />

        <TemplatePicker boardId={boardId} value={templateIds} onChange={setTemplateIds} className="mt-4" />

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-60"
          >
            {pending ? "Criando…" : "Criar card"}
          </button>
        </div>
      </form>
    </div>
  );
}
