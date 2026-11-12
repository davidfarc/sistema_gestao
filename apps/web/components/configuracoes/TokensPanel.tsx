"use client";

import { Check, Copy } from "lucide-react";
import { useState, type FormEvent } from "react";

import { createToken, listTokens, revokeToken, type TokenView } from "@/lib/integrations/actions";

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
}

function status(t: TokenView): { label: string; cls: string } {
  if (t.revokedAt) return { label: "Revogado", cls: "bg-neutral-100 text-neutral-600" };
  if (t.expiresAt && new Date(t.expiresAt) < new Date()) {
    return { label: "Vencido", cls: "bg-amber-100 text-amber-800" };
  }
  return { label: "Ativo", cls: "bg-emerald-100 text-emerald-800" };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          window.prompt("Copie:", text);
        }
      }}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-neutral-300 px-3 text-sm text-neutral-700 hover:bg-neutral-50"
    >
      {done ? <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      {done ? "Copiado" : label}
    </button>
  );
}

/**
 * Tokens pessoais do servidor MCP: deixam um assistente de IA (Claude, por
 * exemplo) consultar o sistema em nome da pessoa. Somente leitura, e só o que
 * ela já enxerga nos quadros.
 */
export function TokensPanel({
  initialTokens,
  mcpUrl,
}: {
  initialTokens: TokenView[] | null;
  mcpUrl: string;
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [validity, setValidity] = useState("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  async function reload() {
    setTokens(await listTokens());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFresh(null);
    try {
      const res = await createToken(name, validity === "nunca" ? null : Number(validity));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFresh(res.token);
      setName("");
      await reload();
    } catch {
      setError("Não foi possível criar o token. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(t: TokenView) {
    if (!window.confirm(`Revogar o token “${t.name}”? O assistente que o usa para de funcionar na hora.`)) return;
    await revokeToken(t.id);
    await reload();
  }

  if (tokens === null) {
    return (
      <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Não foi possível carregar os tokens. Se esta tela acabou de ser publicada, falta aplicar a
        atualização do banco (migration 0039).
      </p>
    );
  }

  return (
    <div className="mt-6 grid gap-6">
      <section>
        <h1 className="text-xl">Assistentes de IA (MCP)</h1>
        <p className="mt-1 max-w-2xl text-sm text-secondary">
          Um token pessoal permite que um assistente como o Claude responda perguntas sobre os
          pipelines: o que a equipe fez na semana, o que está atrasado, onde o fluxo trava. Ele só
          lê, nunca altera, e enxerga exatamente os pipelines que você enxerga. Gestão de Vila e
          Novos alunos ficam de fora.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-neutral-600">Endereço do servidor</p>
            <p className="truncate font-mono text-sm text-neutral-800">{mcpUrl}</p>
          </div>
          <CopyButton text={mcpUrl} label="Copiar endereço" />
        </div>
      </section>

      {fresh && (
        <section role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">
            Token criado. Copie agora: ele não será mostrado de novo.
          </p>
          <p className="mt-2 break-all rounded-lg bg-white p-3 font-mono text-sm text-neutral-800">
            {fresh}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton text={fresh} label="Copiar token" />
            <button
              type="button"
              onClick={() => setFresh(null)}
              className="min-h-9 rounded-lg px-3 text-sm text-emerald-900 hover:bg-emerald-100"
            >
              Já copiei
            </button>
          </div>
          <p className="mt-3 text-sm text-emerald-900">
            Trate como uma senha: quem tiver este token lê os seus pipelines. Não envie por e-mail
            nem cole em conversas.
          </p>
        </section>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-base font-semibold text-neutral-800">Novo token</h2>
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid min-w-48 flex-1 gap-1">
            <span className="text-sm text-neutral-700">Nome (onde vai ser usado)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Ex.: Claude no notebook"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-neutral-700">Validade</span>
            <select
              value={validity}
              onChange={(e) => setValidity(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500"
            >
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
              <option value="365">1 ano</option>
              <option value="nunca">Sem vencimento</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-high disabled:opacity-50"
          >
            {busy ? "Criando…" : "Gerar token"}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold text-neutral-800">Seus tokens</h2>
        {tokens.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">Você ainda não criou nenhum token.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">Começa com</th>
                  <th className="px-3 py-2 font-medium">Criado</th>
                  <th className="px-3 py-2 font-medium">Último uso</th>
                  <th className="px-3 py-2 font-medium">Vence</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {tokens.map((t) => {
                  const st = status(t);
                  return (
                    <tr key={t.id}>
                      <td className="px-3 py-2 text-neutral-800">{t.name}</td>
                      <td className="px-3 py-2 font-mono text-neutral-700">{t.prefix}…</td>
                      <td className="whitespace-nowrap px-3 py-2 text-neutral-700">{day(t.createdAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-neutral-700">
                        {t.lastUsedAt ? day(t.lastUsedAt) : "nunca"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-neutral-700">
                        {t.expiresAt ? day(t.expiresAt) : "não vence"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!t.revokedAt && (
                          <button
                            type="button"
                            onClick={() => revoke(t)}
                            className="min-h-9 rounded-lg px-2 text-sm font-medium text-red-700 hover:bg-red-50"
                          >
                            Revogar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
        <h2 className="text-base font-semibold text-neutral-800">Como conectar</h2>
        <p className="mt-2">
          No assistente, adicione um servidor MCP do tipo <strong>HTTP</strong> com o endereço acima e
          o cabeçalho <span className="font-mono">Authorization: Bearer SEU_TOKEN</span>.
        </p>
        <p className="mt-2">No Claude Code, por exemplo:</p>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-neutral-100 p-3 font-mono text-xs text-neutral-800">
          {`claude mcp add --transport http ecco ${mcpUrl} --header "Authorization: Bearer SEU_TOKEN"`}
        </pre>
        <p className="mt-2">
          Depois é só perguntar em linguagem normal: “o que a equipe fez esta semana?”, “quais
          cards estão atrasados no Editorial?”, “onde o pipeline de Compras está travando?”.
        </p>
      </section>
    </div>
  );
}
