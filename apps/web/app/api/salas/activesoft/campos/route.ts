import { NextResponse } from "next/server";

import { provisionAndGetActor } from "@/lib/actor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Diagnóstico do ActiveSoft (SIGA): mostra QUAIS CAMPOS a API devolve e os
 * valores possíveis dos campos de classificação (situação, ano, turma…), para
 * decidir como filtrar por ano letivo e por situação da matrícula.
 *
 * Não devolve dado de aluno: só nomes de campos, contagens e, para campos com
 * poucos valores diferentes, a lista desses valores. Campos pessoais (nome,
 * documento, contato, endereço, nascimento, filiação) nunca têm valores
 * listados. Só para quem configura o sistema (Gestor / Gestor Master).
 *
 * Uso: abrir no navegador, logado, /api/salas/activesoft/campos
 *      opcional ?caminho=acesso/alunos (outro recurso da mesma API)
 */

const DEFAULT_URL = "https://siga.activesoft.com.br/api/v0";
const PERSONAL = /nome|cpf|rg|doc|email|mail|fone|celular|whats|endere|logradouro|bairro|cep|nasc|mae|pai|respons|filia|foto|login|senha|matricula$/i;
const CLASSIFIER = /turma|serie|curso|turno|ano|periodo|situa|status|unidade|segmento|nivel|etapa/i;

export async function GET(request: Request) {
  const actor = await provisionAndGetActor();
  if (!actor?.isInternal || !actor.permissions.has("board:configure")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  const token = process.env.ACTIVESOFT_API_TOKEN;
  const apiUrl = process.env.ACTIVESOFT_API_URL || DEFAULT_URL;
  if (!token) return NextResponse.json({ error: "ACTIVESOFT_API_TOKEN não configurado." }, { status: 500 });

  const asked = new URL(request.url).searchParams.get("caminho") ?? "acesso/alunos";
  // "raiz" = o endereço-base da API, que costuma listar os recursos disponíveis.
  const path = asked === "raiz" ? "" : asked;
  // Só caminhos simples da própria API (sem "..", sem outro servidor).
  if (path !== "" && !/^[a-z0-9_-]+(\/[a-z0-9_-]+){0,3}$/i.test(path)) {
    return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
  }
  // Repassa só filtros simples (?ano=2027), para testar o que a API aceita.
  const query = new URLSearchParams();
  for (const [k, v] of new URL(request.url).searchParams) {
    if (k !== "caminho" && /^[a-z_]{1,30}$/i.test(k) && /^[\w.-]{1,30}$/.test(v)) query.set(k, v);
  }
  const endpoint = `${apiUrl.replace(/\/+$/, "")}/${path ? `${path}/` : ""}${query.size ? `?${query}` : ""}`;

  try {
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ caminho: path || "raiz", erro: `ActiveSoft respondeu ${res.status}` }, { status: 502 });
    }
    const payload: unknown = await res.json();
    // Índice de recursos: um objeto cujos valores são endereços da própria API.
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const entries = Object.entries(payload as Record<string, unknown>);
      const links = entries.filter(([, v]) => typeof v === "string" && /^https?:\/\//.test(v as string));
      if (links.length > 0 && links.length === entries.length) {
        const base = apiUrl.replace(/\/+$/, "");
        return NextResponse.json({
          caminho: path || "raiz",
          recursos: Object.fromEntries(links.map(([k, v]) => [k, String(v).replace(base, "").replace(/^\/+|\/+$/g, "")])),
        });
      }
    }
    const envelope = payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : null;
    const list: Record<string, unknown>[] = Array.isArray(payload)
      ? (payload as Record<string, unknown>[])
      : (Object.values((payload ?? {}) as Record<string, unknown>).find(Array.isArray) as Record<string, unknown>[]) ?? [];

    const stats = new Map<string, { preenchidos: number; tipos: Set<string>; valores: Map<string, number> }>();
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      for (const [key, value] of Object.entries(row)) {
        const s = stats.get(key) ?? { preenchidos: 0, tipos: new Set<string>(), valores: new Map<string, number>() };
        if (value !== null && value !== undefined && value !== "") {
          s.preenchidos++;
          s.tipos.add(Array.isArray(value) ? "lista" : typeof value);
          if (typeof value !== "object" && s.valores.size <= 200) {
            const v = String(value).slice(0, 60);
            s.valores.set(v, (s.valores.get(v) ?? 0) + 1);
          }
        }
        stats.set(key, s);
      }
    }

    const campos = [...stats.entries()].map(([campo, s]) => {
      const limite = CLASSIFIER.test(campo) ? 120 : 25;
      // "nome_turma…" e afins são classificação, não dado pessoal.
      const pessoal = PERSONAL.test(campo) && !/turma|curso|serie/i.test(campo);
      const listar = !pessoal && s.valores.size > 0 && s.valores.size <= limite;
      return {
        campo,
        preenchidos: s.preenchidos,
        tipos: [...s.tipos],
        valores_diferentes: s.valores.size > 200 ? "mais de 200" : s.valores.size,
        ...(listar
          ? { valores: Object.fromEntries([...s.valores.entries()].sort((a, b) => b[1] - a[1])) }
          : {}),
      };
    });

    return NextResponse.json({ caminho: path, filtros: Object.fromEntries(query), envelope, registros: list.length, campos });
  } catch (err) {
    return NextResponse.json(
      { caminho: path, erro: `Falha ao consultar: ${err instanceof Error ? err.name : "erro"}` },
      { status: 502 },
    );
  }
}
