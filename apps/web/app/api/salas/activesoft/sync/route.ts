import { NextResponse } from "next/server";

import { provisionAndGetActor } from "@/lib/actor";

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

interface RawStudent {
  id_aluno?: number | string;
  nome?: string;
  nome_turma?: string;
  serie_nome?: string;
  data_nascimento?: string;
}

const DEFAULT_URL = "https://siga.activesoft.com.br/api/v0";

export async function POST() {
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

  const endpoint = `${apiUrl.replace(/\/+$/, "")}/acesso/alunos/`;
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `ActiveSoft ${res.status}: ${body.slice(0, 240)}` },
        { status: 502 },
      );
    }

    const payload: unknown = await res.json();
    const list: RawStudent[] = Array.isArray(payload)
      ? (payload as RawStudent[])
      : Array.isArray((payload as { data?: unknown })?.data)
        ? (payload as { data: RawStudent[] }).data
        : [];

    const students = list
      .filter((s) => s?.id_aluno && s?.nome)
      .map((s) => ({
        id: String(s.id_aluno),
        name: s.nome!,
        roomName: s.nome_turma || s.serie_nome || "Sem Turma",
        birthDate: s.data_nascimento ?? null,
      }));

    return NextResponse.json({ students });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Falha ao consultar ActiveSoft: ${msg}` }, { status: 502 });
  }
}
