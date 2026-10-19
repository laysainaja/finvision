export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function check(cond, message, status = 400) {
  if (!cond) throw new HttpError(status, message);
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export const isCents = (n) => Number.isInteger(n);
export const optText = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);
export const optId = (v) => (v === null || v === undefined || v === '' ? null : idParam(v));

/** Id vindo da URL ou do corpo: precisa ser inteiro positivo (evita erro 500 do Postgres com "abc"). */
export function idParam(v) {
  const n = Number(v);
  check(Number.isSafeInteger(n) && n > 0, 'Identificador inválido.');
  return n;
}

/** Literal de array do Postgres ({"a","b"}), com aspas e barras escapadas — para usar com `:param::tipo[]`. */
export function pgArray(valores) {
  return '{' + valores.map((v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';
}

// Datas trafegam como 'YYYY-MM-DD'; as contas abaixo são feitas em UTC para não sofrer com fuso/horário de verão.
const toUTC = (s) => new Date(s + 'T00:00:00Z');
const fromUTC = (d) => d.toISOString().slice(0, 10);

export function addDays(s, n) {
  const d = toUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

// Soma meses mantendo o dia, limitado ao último dia do mês (31/01 + 1 mês = 28 ou 29/02).
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + n, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return fromUTC(alvo);
}

export function diffDays(a, b) {
  return Math.round((toUTC(a) - toUTC(b)) / 86400000);
}

export function inicioPeriodo(s, agrupar) {
  if (agrupar === 'mes') return s.slice(0, 8) + '01';
  if (agrupar === 'semana') {
    const dow = toUTC(s).getUTCDay(); // 0 = domingo
    return addDays(s, -((dow + 6) % 7)); // semana começa na segunda
  }
  return s;
}

export function proximoPeriodo(s, agrupar) {
  if (agrupar === 'mes') return addMonths(s, 1);
  if (agrupar === 'semana') return addDays(s, 7);
  return addDays(s, 1);
}
