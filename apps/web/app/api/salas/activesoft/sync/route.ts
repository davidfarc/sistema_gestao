import { NextResponse } from "next/server";

import { provisionAndGetActor } from "@/lib/actor";
import { loadSigaStudents, SigaError } from "@/lib/salas/activesoftApi";
import { importGuardians } from "@/lib/salas/guardians";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Importa a lista de alunos do ActiveSoft (SIGA), o ERP da escola. O token é
// server-only (`ACTIVESOFT_API_TOKEN`) — nunca vai para o cliente. O merge com
// os dados atuais acontece no cliente (`applyActivesoftSync`), para reaproveitar
// o roteador de escrita real/simulado.
//
// GET {apiUrl}/acesso/alunos/ → [{ id_aluno, nome, nome_turma?, serie_nome?,
// data_nascimento? }] ou { data: [...] }
//
// Opcional: sem o token configurado, o botão apenas informa o erro e o resto
// do módulo segue funcionando.

const DEFAULT_URL = "https://siga.activesoft.com.br/api/v0";

export async function POST(request: Request) {
  const actor = await provisionAndGetActor();
  if (!actor?.isInternal) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const token = process.env.ACTIVESOFT_API_TOKEN;
  const apiUrl = process.env.ACTIVESOFT_API_URL || DEFAULT_URL;
  if (!token) {
    return NextResponse.json(
      { error: "ACTIVESOFT_API_TOKEN não configurado no ambiente." },
      { status: 500 },
    );
  }

  // Ano letivo pedido (opcional): { "ano": "2027" }. Sem ele, o ano corrente do ActiveSoft.
  let ano: string | undefined;
  try {
    const body = (await request.json()) as { ano?: unknown };
    if (typeof body?.ano === "string" && /^\d{4}$/.test(body.ano)) ano = body.ano;
  } catch {
    // sem corpo: ano corrente
  }

  try {
    const result = await loadSigaStudents(apiUrl, token, ano);
    // No ano corrente, atualiza também o cadastro de responsáveis (migration 0063).
    // Falhar aqui não impede a importação dos alunos.
    let guardians: { guardians: number; studentsWithoutPhone: number } | { error: string } | null = null;
    if (result.year === result.currentYear) {
      try {
        guardians = await importGuardians(apiUrl, token, actor.organizationId as string, result.students);
      } catch (e) {
        guardians = { error: e instanceof Error ? e.message : "erro" };
      }
    }
    return NextResponse.json({ ...result, guardians });
  } catch (err) {
    const msg = err instanceof SigaError ? err.message : `Falha ao consultar ActiveSoft: ${err instanceof Error ? err.name : "erro"}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
