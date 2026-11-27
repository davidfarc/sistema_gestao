import "server-only";

/**
 * Leitura do ActiveSoft (SIGA) para a Gestão de Vila.
 *
 * Fonte de matrícula: `/enturmacao_com_detalhes/`, o único recurso que traz a
 * SITUAÇÃO de cada aluno na turma (cursando, transferido, cancelado,
 * pré-matrícula…). O `/acesso/alunos/`, usado antes, só lista quem está ativo
 * no ano corrente: quem saía simplesmente sumia.
 *
 * Particularidades conferidas na API em 23 e 24/11/2026:
 *  - o período se pede com `periodo=AAAA` na enturmação e com
 *    `periodo_sigla=AAAA` em /lista_turmas/ (nomes diferentes, nenhum
 *    documentado); sem ele vem o ano corrente, e `turma=<id>` sozinho não
 *    alcança outro ano (volta vazio, sem erro);
 *  - a paginação só liga com `limit`; aí a resposta vem em `{count, results}`;
 *  - a mesma chave tem três nomes: `id` / `id_aluno` / `aluno_id` (e turma idem);
 *  - `sigla_periodo` vem com espaços à direita;
 *  - 502 passageiro acontece: uma nova tentativa resolve.
 */

export interface SigaStudent {
  id: string;
  name: string;
  birthDate: string | null;
  roomName: string;
  period: string;
  /** Texto da situação no ActiveSoft ("Cursando", "Transferido"…). */
  status: string;
  /** A = ativo, I = inativo, P = pré-matrícula, S = seleção (lista de espera). */
  statusType: string;
}

export interface SigaResult {
  year: string;
  currentYear: string;
  students: SigaStudent[];
  rooms: number;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export class SigaError extends Error {}

async function get(base: string, token: string, path: string): Promise<unknown> {
  const url = `${base}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "manual", // caminho desconhecido redireciona para o login
    });
    if (res.status === 502 && attempt < 2) continue;
    if (!res.ok) throw new SigaError(`ActiveSoft respondeu ${res.status} em ${path.split("?")[0]}`);
    return res.json();
  }
}

/** Lista completa de um recurso, paginando com limit/offset e confiando em `count`. */
async function getAll(base: string, token: string, path: string): Promise<Row[]> {
  const sep = path.includes("?") ? "&" : "?";
  const out: Row[] = [];
  for (let offset = 0, page = 0; page < 20; page++) {
    const body = (await get(base, token, `${path}${sep}limit=1000&offset=${offset}`)) as
      | { count?: number; results?: Row[] }
      | Row[];
    if (Array.isArray(body)) return body;
    const rows = body.results ?? [];
    out.push(...rows);
    offset += rows.length;
    if (rows.length === 0 || offset >= (body.count ?? 0)) break;
  }
  return out;
}

// Situações que significam "não está mais na turma". "Aprovado" e "Concluído"
// são inativos para o ActiveSoft, mas o aluno cumpriu o ano: não é uma saída
// (no fim do ano letivo a turma inteira fica "Aprovado").
const LEFT = new Set(["transferido", "cancelado", "desistente", "evadido", "inativo", "não efetivado", "nao efetivado"]);
export const isLeftStatus = (status: string) => LEFT.has(status.trim().toLowerCase());

// Cursos que não são a turma regular do aluno: só valem como turma dele quando
// ele não tem nenhuma matrícula na educação básica.
const SIDE_COURSE = /^(oficinas?|eccolonia|col[oô]nia)\b/i;

/** Quanto menor, melhor candidata a "turma do aluno" neste ano. */
function rank(e: { statusType: string; status: string; side: boolean }): number {
  const byType = e.statusType === "A" ? 0 : !isLeftStatus(e.status) && e.statusType === "I" ? 1 : e.statusType === "P" ? 2 : e.statusType === "S" ? 3 : 4;
  return byType * 2 + (e.side ? 1 : 0);
}

export async function loadSigaStudents(base: string, token: string, askedYear?: string): Promise<SigaResult> {
  const root = base.replace(/\/+$/, "");

  // Turmas do ano corrente: dizem qual é o ano corrente e dão os nomes.
  const currentRooms = (await get(root, token, "/lista_turmas/")) as Row[];
  const currentYear = str(currentRooms[0]?.sigla_periodo) || String(new Date().getFullYear());
  const year = askedYear && /^\d{4}$/.test(askedYear) ? askedYear : currentYear;
  const isCurrent = year === currentYear;

  const roomsOfYear = isCurrent
    ? currentRooms
    : ((await get(root, token, `/lista_turmas/?periodo_sigla=${year}`)) as Row[]);
  const roomById = new Map(roomsOfYear.map((r) => [str(r.id), r]));

  // Nome da turma: no ano corrente, o mesmo que a importação antiga usava
  // (`nome_turma` de /acesso/alunos/), para não criar sala duplicada.
  const legacyRoomName = new Map<string, string>();
  if (isCurrent) {
    for (const a of (await get(root, token, "/acesso/alunos/")) as Row[]) {
      const id = str(a.id_turma);
      if (id && str(a.nome_turma)) legacyRoomName.set(id, str(a.nome_turma));
    }
  }
  const roomName = (id: string) => legacyRoomName.get(id) || str(roomById.get(id)?.nome) || "Sem Turma";

  // Matrículas com situação, SEMPRE com o período explícito: sem ele a API
  // devolve o ano corrente, e o filtro por turma sozinho não alcança outro
  // ano (volta vazio, sem erro). Neste recurso o parâmetro é `periodo`; em
  // /lista_turmas/ é `periodo_sigla`.
  const enrollments = await getAll(root, token, `/enturmacao_com_detalhes/?periodo=${year}`);

  // Nomes e nascimento (a enturmação só traz o id do aluno).
  const people = new Map<string, { name: string; birthDate: string | null }>();
  if (enrollments.length > 0) {
    for (const a of await getAll(root, token, "/lista_alunos/")) {
      const id = str(a.id);
      if (id && str(a.nome)) people.set(id, { name: str(a.nome), birthDate: str(a.data_nascimento) || null });
    }
  }

  // Uma turma por aluno: a melhor matrícula dele no ano.
  const best = new Map<string, { turma: string; status: string; statusType: string; score: number }>();
  for (const e of enrollments) {
    if (e.cursos_oficiais === false) continue; // alunos de escolas parceiras
    const aluno = str(e.aluno_id);
    const turma = str(e.turma_id);
    if (!aluno || !roomById.has(turma)) continue;
    const status = str(e.situacao_aluno_turma) || "Cursando";
    const statusType = str(e.situacao_aluno_turma_tipo) || "A";
    const side = SIDE_COURSE.test(str(roomById.get(turma)?.curso_nome));
    const score = rank({ status, statusType, side });
    const cur = best.get(aluno);
    if (!cur || score < cur.score) best.set(aluno, { turma, status, statusType, score });
  }

  const students: SigaStudent[] = [];
  for (const [id, e] of best) {
    const person = people.get(id);
    if (!person) continue; // sem cadastro legível: não inventa nome
    students.push({
      id,
      name: person.name,
      birthDate: person.birthDate,
      roomName: roomName(e.turma),
      period: year,
      status: e.status,
      statusType: e.statusType,
    });
  }
  return { year, currentYear, students, rooms: roomById.size };
}

// ── Responsáveis (migration 0063) ───────────────────────────────────────────

export interface SigaGuardian {
  studentId: string;
  slot: 1 | 2 | 3 | 4;
  name: string;
  /** "Filiação 1", "Filiação 2", "Responsável financeiro" ou "Responsável pedagógico". */
  relation: string;
  /** "+55…" só com dígitos, ou "" se o cadastro não tiver um celular válido. */
  phone: string;
  email: string;
}

/** Celular do ActiveSoft em "+55DDDNÚMERO". Cinco máscaras convivem na base. */
export function normalizeSigaPhone(raw: unknown): string {
  const d = str(raw).replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return `+${d}`;
  return "";
}

/**
 * Responsáveis de cada aluno, na ordem do relatório do ActiveSoft: filiação 1,
 * filiação 2 e, só quando forem outras pessoas, o responsável financeiro
 * (`responsavel_id`) e o pedagógico (`responsavel_secundario_id`). A ligação
 * mora no aluno (`/lista_alunos/`); o celular, em `/lista_responsaveis/`. Só
 * para os alunos informados (os atuais): a lista de responsáveis tem muitos
 * ex-alunos.
 */
export async function loadSigaGuardians(base: string, token: string, studentIds: Set<string>): Promise<SigaGuardian[]> {
  const root = base.replace(/\/+$/, "");
  const [alunos, responsaveis] = await Promise.all([
    getAll(root, token, "/lista_alunos/"),
    getAll(root, token, "/lista_responsaveis/"),
  ]);
  const byId = new Map(responsaveis.map((r) => [str(r.id), r]));
  const out: SigaGuardian[] = [];
  for (const a of alunos) {
    const studentId = str(a.id);
    if (!studentIds.has(studentId)) continue;
    const links: [unknown, string][] = [
      [a.filiacao_1_id, "Filiação 1"],
      [a.filiacao_2_id, "Filiação 2"],
      [a.responsavel_id, "Responsável financeiro"],
      [a.responsavel_secundario_id, "Responsável pedagógico"],
    ];
    const seen = new Set<string>();
    let slot = 0;
    for (const [rawId, relation] of links) {
      const id = str(rawId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const r = byId.get(id);
      if (!r || !str(r.nome)) continue;
      slot++;
      out.push({
        studentId,
        slot: slot as 1 | 2 | 3 | 4,
        name: str(r.nome),
        relation,
        phone: normalizeSigaPhone(r.celular),
        email: str(r.email).includes("@") ? str(r.email) : "",
      });
    }
  }
  return out;
}
