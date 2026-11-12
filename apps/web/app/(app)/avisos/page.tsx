import { NotificationsList } from "@/components/avisos/NotificationsList";
import { InstallHint } from "@/components/shell/InstallHint";

export const dynamic = "force-dynamic";

/** Avisos (o "sininho" em tela cheia): item da barra inferior no celular. */
export default function AvisosPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-10">
      <h1 className="text-2xl">Avisos</h1>
      <p className="mt-1 text-sm text-secondary">Menções e cards atribuídos a você.</p>
      <div className="mt-5 grid gap-4">
        <InstallHint dismissible={false} />
        <NotificationsList />
      </div>
    </main>
  );
}
