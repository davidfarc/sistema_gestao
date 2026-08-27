"use client";

import { useMemo, useState } from "react";

import { donutGeometry } from "@/lib/charts/donut";
import type { Bucket, DemandRow, SpendData } from "@/lib/demandas/spendTypes";
import { MESES } from "@/lib/planejamento/types";

/*
 * Paleta validada com scripts/validate_palette.js (modo claro, superfície #fff):
 * os três estados da fila usam os slots 1–3 do tema categórico, que passam em
 * todos os pares (CVD ΔE 9.2 · visão normal 24.0). O tipo usa os slots 1–4, cuja
 * pior adjacência passa (9.1 / 22.9) — inclusive a "volta" da pizza, onde o
 * amarelo encosta no azul (31.5 / 37.5).
 *
 * Três dessas cores ficam abaixo de 3:1 contra o branco, o que obriga "relevo":
 * por isso todo valor aparece rotulado na legenda E existe a visão em tabela.
 *
 * O cinza do "saldo livre" NÃO é um slot categórico: é ausência de valor. Fica
 * de propósito fora da faixa de luminosidade das séries (bem mais claro), para
 * não competir com elas — com contorno próprio, já que sozinho não se vê no
 * branco.
 */
const COR: Record<Bucket | "saldo" | "excedente", string> = {
  analise: "#2a78d6",
  priorizada: "#eb6834",
  realizado: "#1baf7a",
  fora: "#8a8980",
  saldo: "#e5e4dd",
  excedente: "#e34948",
};
const COR_TIPO = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

const ROTULO: Record<"analise" | "priorizada" | "realizado", string> = {
  analise: "Em análise",
  priorizada: "Priorizadas",
  realizado: "Realizado",
};

function brl(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function pct(part: number, total: number): string {
  if (total <= 0) return "—";
  return (Math.round((part / total) * 1000) / 10).toLocaleString("pt-BR") + "%";
}

interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  stroke?: string;
}

/**
 * Texto do `<title>` da fatia. React 19 trata `<title>` como elemento especial e
 * exige UM único filho de texto — montar em pedaços no JSX gera vários nós e
 * quebra a hidratação. Por isso a string vem pronta.
 */
function rotuloFatia(s: Slice, unidade: string, percentual?: string): string {
  const valor = unidade === "R$" ? brl(s.value) : String(s.value);
  return percentual ? s.label + ": " + valor + " (" + percentual + ")" : s.label + ": " + valor;
}

/**
 * Rosca. O buraco carrega o total — o número que dá sentido a todas as fatias.
 * Fatias separadas por 2px da superfície, como manda o guia de marcas.
 */
function Donut({ slices, total, unidade }: { slices: Slice[]; total: number; unidade: string }) {
  const soma = slices.reduce((s, x) => s + x.value, 0);
  const R = 78;
  const r = 50;
  const C = 100;

  if (soma <= 0) {
    return (
      <div className="flex h-52 items-center justify-center text-sm text-secondary">
        Sem dados para este filtro.
      </div>
    );
  }

  const geo = donutGeometry(
    slices.map((x) => x.value),
    { outer: R, inner: r, center: C },
  );
  const unica = geo.singleIndex != null ? slices[geo.singleIndex] : null;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 200 200" className="h-52 w-52 shrink-0" role="img">
        {unica ? (
          <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke={unica.color} strokeWidth={R - r}>
            <title>{rotuloFatia(unica, unidade)}</title>
          </circle>
        ) : (
          geo.arcs.map((a) => {
            const s = slices[a.index]!;
            return (
              <path key={s.key} d={a.d} fill={s.color} stroke={s.stroke ?? "#ffffff"} strokeWidth={2}>
                <title>{rotuloFatia(s, unidade, pct(s.value, soma))}</title>
              </path>
            );
          })
        )}
        <text
          x={C}
          y={C - 6}
          textAnchor="middle"
          className="fill-neutral-500"
          style={{ fontSize: 11 }}
        >
          total
        </text>
        <text
          x={C}
          y={C + 14}
          textAnchor="middle"
          className="fill-neutral-900"
          style={{ fontSize: 15, fontWeight: 600 }}
        >
          {unidade === "R$" ? brl(total) : total}
        </text>
      </svg>

      {/* Legenda com valor: identidade nunca fica só na cor, e é o "relevo"
          exigido pelas cores de baixo contraste. */}
      <ul className="grid min-w-52 gap-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ background: s.color, boxShadow: s.stroke ? `inset 0 0 0 1px ${s.stroke}` : undefined }}
            />
            <span className="text-neutral-700">{s.label}</span>
            <span className="ml-auto tabular-nums font-medium text-neutral-900">
              {unidade === "R$" ? brl(s.value) : s.value}
            </span>
            <span className="w-12 text-right tabular-nums text-secondary">
              {pct(s.value, soma)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Largura em %, travada em 100 — nenhuma barra escapa da caixa. */
function pctLargura(valor: number, max: number): string {
  if (!(max > 0)) return "0%";
  return Math.min(100, Math.max(0, (valor / max) * 100)) + "%";
}

/**
 * Previsto x realizado por área. Barras agrupadas exigiriam duas cores
 * concorrentes — e o validador reprovou o par cinza/aqua (ΔE 4.5 para deuteranopia).
 * Então o previsto é uma TRILHA de fundo com marca de alvo, e o realizado é a
 * barra preenchida: uma cor só em jogo, e o estouro salta em vermelho.
 */
function BarrasPrevistoRealizado({
  itens,
}: {
  itens: { id: string; label: string; previsto: number; realizado: number }[];
}) {
  const max = Math.max(...itens.map((i) => Math.max(i.previsto, i.realizado)), 1);
  if (itens.length === 0) {
    return <p className="py-8 text-center text-sm text-secondary">Sem dados para este filtro.</p>;
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-secondary">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: COR.realizado }} />
          Realizado
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-3 w-3 rounded-sm border border-neutral-300"
            style={{ background: COR.saldo }}
          />
          Previsto
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: COR.excedente }} />
          Acima do previsto
        </span>
      </div>

      {itens.map((i) => {
        const dentro = Math.min(i.realizado, i.previsto);
        const acima = Math.max(0, i.realizado - i.previsto);
        return (
          <div key={i.id} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-neutral-800">{i.label}</span>
              <span className="tabular-nums text-secondary">
                <span className="font-medium text-neutral-900">{brl(i.realizado)}</span>
                {" de "}
                {i.previsto > 0 ? brl(i.previsto) : "sem previsão"}
                {acima > 0 && (
                  <span className="ml-2 font-medium" style={{ color: COR.excedente }}>
                    +{brl(acima)}
                  </span>
                )}
              </span>
            </div>
            {/* A extensão do cinza É o previsto — se a trilha fosse sempre 100%,
                áreas com orçamentos diferentes ficariam com a mesma barra. */}
            <div className="relative h-5 w-full rounded bg-neutral-50">
              {i.previsto > 0 && (
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{ width: pctLargura(i.previsto, max), background: COR.saldo }}
                />
              )}
              <div
                className="absolute inset-y-0 left-0 rounded"
                style={{ width: pctLargura(dentro, max), background: COR.realizado }}
              />
              {acima > 0 && (
                <div
                  className="absolute inset-y-0 rounded-r"
                  style={{
                    left: pctLargura(dentro, max),
                    width: pctLargura(acima, max),
                    background: COR.excedente,
                    borderLeft: "2px solid #ffffff",
                  }}
                />
              )}
              {i.previsto > 0 && (
                <div
                  aria-hidden
                  title={"Previsto: " + brl(i.previsto)}
                  className="absolute inset-y-0 border-r-2 border-neutral-500"
                  style={{ width: pctLargura(i.previsto, max) }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Painel({
  titulo,
  hint,
  children,
}: {
  titulo: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">{titulo}</h3>
      {hint && <p className="mt-0.5 text-xs text-secondary">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SpendCharts({ data }: { data: SpendData }) {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(data.anos.includes(anoAtual) ? anoAtual : (data.anos.at(-1) ?? anoAtual));
  const [mes, setMes] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [tipoId, setTipoId] = useState<string | null>(null);
  const [tabela, setTabela] = useState(false);

  const calc = useMemo(() => {
    const casaFiltro = (r: DemandRow) =>
      (areaId === null || r.areaId === areaId) && (tipoId === null || r.tipoId === tipoId);
    const noPeriodo = (r: DemandRow) =>
      r.year === ano && (mes === null || r.month === mes);

    const consideradas = data.rows.filter(
      (r) => casaFiltro(r) && noPeriodo(r) && r.bucket !== "fora",
    );

    // Fora do gráfico, mas contados à parte — o número fica limpo sem que nada
    // desapareça em silêncio.
    const semData = data.rows.filter((r) => casaFiltro(r) && r.year === null && r.bucket !== "fora");
    const antesDaFila = data.rows.filter((r) => casaFiltro(r) && r.bucket === "fora");

    const soma = (b: Bucket) =>
      consideradas.filter((r) => r.bucket === b).reduce((s, r) => s + (r.valor ?? 0), 0);
    const conta = (b: Bucket) => consideradas.filter((r) => r.bucket === b).length;

    const valores = {
      analise: soma("analise"),
      priorizada: soma("priorizada"),
      realizado: soma("realizado"),
    };
    const usado = valores.analise + valores.priorizada + valores.realizado;

    const planejado = data.plan
      .filter(
        (p) =>
          p.year === ano &&
          (mes === null || p.month === mes) &&
          (areaId === null || p.categoryId === areaId),
      )
      .reduce((s, p) => s + p.amount, 0);

    const saldo = Math.max(0, planejado - usado);
    const excedente = Math.max(0, usado - planejado);

    const porArea = data.areas
      .filter((a) => areaId === null || a.id === areaId)
      .map((a) => ({
        id: a.id,
        label: a.label,
        previsto: data.plan
          .filter((p) => p.year === ano && (mes === null || p.month === mes) && p.categoryId === a.id)
          .reduce((s, p) => s + p.amount, 0),
        realizado: consideradas
          .filter((r) => r.bucket === "realizado" && r.areaId === a.id)
          .reduce((s, r) => s + (r.valor ?? 0), 0),
      }))
      .filter((a) => a.previsto > 0 || a.realizado > 0);

    const porTipo = data.tipos.map((t, i) => ({
      key: t.id,
      label: t.label,
      value: consideradas
        .filter((r) => r.tipoId === t.id)
        .reduce((s, r) => s + (r.valor ?? 0), 0),
      color: COR_TIPO[i % COR_TIPO.length] ?? COR.fora,
    }));
    const semTipo = consideradas
      .filter((r) => r.tipoId === null)
      .reduce((s, r) => s + (r.valor ?? 0), 0);
    if (semTipo > 0) {
      porTipo.push({ key: "sem", label: "Sem tipo", value: semTipo, color: COR.fora });
    }

    return {
      consideradas,
      valores,
      usado,
      planejado,
      saldo,
      excedente,
      conta: { analise: conta("analise"), priorizada: conta("priorizada"), realizado: conta("realizado") },
      porArea,
      porTipo,
      semData,
      antesDaFila,
      semValor: consideradas.filter((r) => r.valor == null).length,
    };
  }, [data, ano, mes, areaId, tipoId]);

  const fatiasValor: Slice[] = [
    { key: "analise", label: ROTULO.analise, value: calc.valores.analise, color: COR.analise },
    { key: "priorizada", label: ROTULO.priorizada, value: calc.valores.priorizada, color: COR.priorizada },
    { key: "realizado", label: ROTULO.realizado, value: calc.valores.realizado, color: COR.realizado },
  ];
  if (calc.saldo > 0) {
    fatiasValor.push({
      key: "saldo",
      label: "Saldo livre",
      value: calc.saldo,
      color: COR.saldo,
      stroke: "#b4b3aa",
    });
  }

  const fatiasQtd: Slice[] = [
    { key: "analise", label: ROTULO.analise, value: calc.conta.analise, color: COR.analise },
    { key: "priorizada", label: ROTULO.priorizada, value: calc.conta.priorizada, color: COR.priorizada },
    { key: "realizado", label: ROTULO.realizado, value: calc.conta.realizado, color: COR.realizado },
  ];

  const totalValor = calc.planejado > 0 ? Math.max(calc.planejado, calc.usado) : calc.usado;
  const selectCls =
    "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800";

  return (
    <div className="grid gap-4">
      {/* Filtros numa linha só, acima dos gráficos. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-secondary">
          Ano
          <select className={selectCls} value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {data.anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-secondary">
          Mês
          <select
            className={selectCls}
            value={mes ?? ""}
            onChange={(e) => setMes(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">Ano inteiro</option>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-secondary">
          Área
          <select
            className={selectCls}
            value={areaId ?? ""}
            onChange={(e) => setAreaId(e.target.value || null)}
          >
            <option value="">Todas</option>
            {data.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-secondary">
          Tipo
          <select
            className={selectCls}
            value={tipoId ?? ""}
            onChange={(e) => setTipoId(e.target.value || null)}
          >
            <option value="">Todos</option>
            {data.tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setTabela((v) => !v)}
          className="ml-auto rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          {tabela ? "Ver gráficos" : "Ver como tabela"}
        </button>
      </div>

      {data.semEtapaDeCompra && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Este pipeline não tem etapa de &ldquo;compra realizada&rdquo; marcada, então o realizado
          aparece como zero.
        </p>
      )}
      {calc.planejado === 0 && (
        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
          Sem planejamento para este período — as pizzas mostram a divisão entre as filas, sem
          saldo. Preencha em <strong>Planejamento de gastos</strong> para comparar com o orçamento.
        </p>
      )}
      {calc.excedente > 0 && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          Excedeu o planejado em {brl(calc.excedente)} — {brl(calc.usado)} em demandas contra{" "}
          {brl(calc.planejado)} previstos.
        </p>
      )}

      {tabela ? (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="min-w-full text-sm">
            <caption className="px-4 py-3 text-left text-xs text-secondary">
              As mesmas demandas dos gráficos, em texto.
            </caption>
            <thead className="bg-neutral-50 text-left">
              <tr>
                <th className="px-4 py-2 font-semibold">#</th>
                <th className="px-4 py-2 font-semibold">Demanda</th>
                <th className="px-4 py-2 font-semibold">Fila</th>
                <th className="px-4 py-2 font-semibold">Área</th>
                <th className="px-4 py-2 font-semibold">Tipo</th>
                <th className="px-4 py-2 text-right font-semibold">Valor</th>
              </tr>
            </thead>
            <tbody>
              {calc.consideradas.map((r) => (
                <tr key={r.cardId} className="border-t border-neutral-100">
                  <td className="px-4 py-2 tabular-nums text-secondary">{r.number}</td>
                  <td className="px-4 py-2">{r.title}</td>
                  <td className="px-4 py-2">
                    {ROTULO[r.bucket as "analise" | "priorizada" | "realizado"] ?? r.bucket}
                  </td>
                  <td className="px-4 py-2">
                    {data.areas.find((a) => a.id === r.areaId)?.label ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    {data.tipos.find((t) => t.id === r.tipoId)?.label ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.valor == null ? "—" : brl(r.valor)}
                  </td>
                </tr>
              ))}
              {calc.consideradas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-secondary">
                    Nenhuma demanda neste filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Painel
            titulo="Valor por fila"
            hint={
              calc.planejado > 0
                ? "Quanto do orçamento do período já está comprometido."
                : "Divisão do valor entre as filas."
            }
          >
            <Donut slices={fatiasValor} total={totalValor} unidade="R$" />
          </Painel>

          <Painel titulo="Quantidade por fila" hint="Quantas demandas em cada fila.">
            <Donut
              slices={fatiasQtd}
              total={calc.conta.analise + calc.conta.priorizada + calc.conta.realizado}
              unidade="un"
            />
          </Painel>

          <Painel titulo="Previsto × realizado por área" hint="A trilha é o previsto; a barra, o realizado.">
            <BarrasPrevistoRealizado itens={calc.porArea} />
          </Painel>

          <Painel titulo="Valor por tipo de demanda" hint="RUN e KEEP mantêm; GROW e TRANSFORM mudam o patamar.">
            <Donut slices={calc.porTipo} total={calc.usado} unidade="R$" />
          </Painel>
        </div>
      )}

      {/* O que ficou fora, dito em voz alta. */}
      {(calc.semData.length > 0 || calc.antesDaFila.length > 0 || calc.semValor > 0) && (
        <ul className="grid gap-1 text-xs text-secondary">
          {calc.semData.length > 0 && (
            <li>
              <strong>{calc.semData.length}</strong>{" "}
              {calc.semData.length === 1 ? "demanda" : "demandas"} fora dos gráficos por falta de
              &ldquo;Data pretendida&rdquo; (
              {brl(calc.semData.reduce((s, r) => s + (r.valor ?? 0), 0))}):{" "}
              {calc.semData.map((r) => "#" + r.number).join(", ")}
            </li>
          )}
          {calc.antesDaFila.length > 0 && (
            <li>
              <strong>{calc.antesDaFila.length}</strong>{" "}
              {calc.antesDaFila.length === 1 ? "demanda" : "demandas"} ainda antes da fila de
              priorização ({brl(calc.antesDaFila.reduce((s, r) => s + (r.valor ?? 0), 0))}) — entram
              nos gráficos quando chegarem a &ldquo;Aguardando priorização&rdquo;.
            </li>
          )}
          {calc.semValor > 0 && (
            <li>
              <strong>{calc.semValor}</strong> contam na quantidade mas somam zero em valor: sem
              &ldquo;Orçamento estimado&rdquo; preenchido.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
