/**
 * Geometria da rosca, separada da UI para poder ser conferida sozinha —
 * arco em SVG é onde erram: fatia de 360° virando path degenerado, `largeArcFlag`
 * trocado acima de meia volta, NaN quando o total é zero.
 */

export interface Arc {
  /** Índice da fatia na lista de entrada. */
  index: number;
  /** Path do anel (setor com furo no meio). */
  d: string;
  /** Fração do total, 0..1. */
  frac: number;
}

export interface DonutGeometry {
  /** Uma fatia sozinha não vira path: o chamador desenha um anel. */
  singleIndex: number | null;
  arcs: Arc[];
}

/**
 * Fatias a partir dos valores. Valores <= 0 são descartados (fatia invisível
 * ainda consumiria ângulo e deslocaria as outras).
 */
export function donutGeometry(
  values: readonly number[],
  opts: { outer: number; inner: number; center: number },
): DonutGeometry {
  const { outer: R, inner: r, center: C } = opts;
  const positivos = values.map((v, i) => ({ i, v })).filter((x) => Number.isFinite(x.v) && x.v > 0);
  const soma = positivos.reduce((s, x) => s + x.v, 0);

  if (soma <= 0) return { singleIndex: null, arcs: [] };
  if (positivos.length === 1) return { singleIndex: positivos[0]!.i, arcs: [] };

  const ponto = (ang: number, rad: number): [number, number] => [
    C + rad * Math.cos(ang),
    C + rad * Math.sin(ang),
  ];

  let ang = -Math.PI / 2; // 12 horas
  const arcs: Arc[] = [];
  for (const { i, v } of positivos) {
    const frac = v / soma;
    const a0 = ang;
    const a1 = ang + frac * 2 * Math.PI;
    ang = a1;
    const grande = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = ponto(a0, R);
    const [x1, y1] = ponto(a1, R);
    const [x2, y2] = ponto(a1, r);
    const [x3, y3] = ponto(a0, r);
    arcs.push({
      index: i,
      frac,
      d: [
        `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
        `A ${R} ${R} 0 ${grande} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
        `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
        `A ${r} ${r} 0 ${grande} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}`,
        "Z",
      ].join(" "),
    });
  }
  return { singleIndex: null, arcs };
}
