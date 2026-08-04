"use client";

import { useRouter } from "next/navigation";

import type { IntakeForm as IntakeFormData } from "@/lib/board/intake";
import { BoardProvider } from "./BoardContext";
import { CUSTOM_FORMS } from "./customForms";
import { GenericCreateForm } from "./GenericCreateForm";
import { SimpleCreate } from "./NewCardDialog";

/**
 * Formulário de criação para quem NÃO enxerga o pipeline (caixa de entrada).
 *
 * É o mesmo componente de formulário que a equipe do pipeline usa — a única
 * diferença é que os campos chegam prontos do servidor e não há quadro por
 * baixo. Nenhum formulário foi duplicado: se o pipeline mudar de modo, ou se
 * outra escola registrar um formulário próprio, esta tela acompanha sozinha.
 */
export function IntakeForm({ form }: { form: IntakeFormData }) {
  const router = useRouter();

  // Sem quadro para voltar: cancelar vai para o Início; criar leva ao card
  // recém-aberto, que a pessoa enxerga por ser a solicitante.
  const sair = () => router.push("/");
  const criado = (cardId: string) => router.push(`/card/${cardId}`);

  const customKey = form.creationForm.startsWith("custom:")
    ? form.creationForm.slice("custom:".length)
    : null;
  const CustomForm = customKey ? CUSTOM_FORMS[customKey]?.Component : null;

  return (
    <BoardProvider
      boardId={form.boardId}
      creationForm={form.creationForm}
      thresholds={form.thresholds}
    >
      <main className="min-h-dvh bg-surface-low">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <p className="text-sm font-medium uppercase tracking-wide text-secondary">
            Nova solicitação
          </p>
          <h1 className="mt-1 text-2xl">{form.boardName}</h1>
          <p className="mt-2 text-sm text-secondary">
            Você está enviando uma solicitação para outra área. Depois de enviar, poderá
            acompanhar o andamento pelo próprio pedido.
          </p>
        </div>

        {form.creationForm === "generic" ? (
          <GenericCreateForm
            boardId={form.boardId}
            initialFields={form.fields}
            onClose={sair}
            onCreated={criado}
          />
        ) : CustomForm ? (
          <CustomForm
            boardId={form.boardId}
            initialFields={form.fields}
            onClose={sair}
            onCreated={criado}
          />
        ) : (
          <SimpleCreate boardId={form.boardId} onClose={sair} onCreated={criado} />
        )}
      </main>
    </BoardProvider>
  );
}
