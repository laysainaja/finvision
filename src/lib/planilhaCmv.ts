// Leitura da aba de CMV da planilha da loja (.xlsx), direto no navegador e sem biblioteca externa:
// um .xlsx é um arquivo zip com XMLs dentro. Descompacta com o DecompressionStream do próprio navegador
// e lê só o necessário (lista de abas, textos compartilhados e as células da aba).

export type Celula = string | number;
export type Grade = Celula[][];

// ---------- Zip ----------

interface EntradaZip { metodo: number; tamanho: number; inicio: number }

function entradasZip(buf: ArrayBuffer): Map<string, EntradaZip> {
  const v = new DataView(buf);
  let fim = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('O arquivo não é uma planilha .xlsx.');
  const total = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  const mapa = new Map<string, EntradaZip>();
  for (let n = 0; n < total; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Planilha corrompida.');
    const metodo = v.getUint16(p + 10, true), tamanho = v.getUint32(p + 20, true);
    const lNome = v.getUint16(p + 28, true), lExtra = v.getUint16(p + 30, true), lComent = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = dec.decode(new Uint8Array(buf, p + 46, lNome));
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    mapa.set(nome, { metodo, tamanho, inicio });
    p += 46 + lNome + lExtra + lComent;
  }
  return mapa;
}

async function lerEntrada(buf: ArrayBuffer, e: EntradaZip): Promise<string> {
  const dados = new Uint8Array(buf, e.inicio, e.tamanho);
  if (e.metodo === 0) return new TextDecoder().decode(dados);
  if (e.metodo !== 8) throw new Error('Formato de compactação não suportado.');
  const stream = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

// ---------- XML ----------

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e] ?? m);
const atributo = (tag: string, nome: string) => {
  const m = new RegExp(`(?:^|\\s)${nome}="([^"]*)"`).exec(tag);
  return m ? texto(m[1]) : null;
};
const sem = (s: string) => s.replace(/<(\/?)[\w-]+:/g, '<$1'); // tira prefixos (x:c → c)
const textosDe = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => texto(m[1])).join('');

function coluna(ref: string) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Abre o .xlsx e devolve cada aba como grade de células (texto ou número). */
export async function lerPlanilha(buf: ArrayBuffer): Promise<Record<string, Grade>> {
  const zip = entradasZip(buf);
  const ler = async (nome: string) => { const e = zip.get(nome); return e ? sem(await lerEntrada(buf, e)) : ''; };
  const wb = await ler('xl/workbook.xml');
  const rels = await ler('xl/_rels/workbook.xml.rels');
  const alvo = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [atributo(m[1], 'Id'), atributo(m[1], 'Target')]));
  const compartilhados = [...(await ler('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textosDe(m[1]));
  const abas: Record<string, Grade> = {};
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const nome = atributo(m[1], 'name') ?? '';
    const t = alvo.get(atributo(m[1], 'r:id') ?? atributo(m[1], 'id'));
    if (!t) continue;
    const caminho = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
    const xml = await ler(caminho);
    const grade: Grade = [];
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = atributo(c[1], 'r');
      if (!ref || !c[2]) continue;
      const tipo = atributo(c[1], 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2])?.[1];
      let valor: Celula | null = null;
      if (tipo === 's') valor = compartilhados[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = textosDe(c[2]);
      else if (tipo === 'str' || tipo === 'e') valor = v === undefined ? '' : texto(v);
      else if (tipo === 'b') valor = v === '1' ? 1 : 0;
      else if (v !== undefined && v !== '') valor = Number(v);
      if (valor === null || valor === '' || (typeof valor === 'number' && !Number.isFinite(valor))) continue;
      const linha = Number(ref.replace(/^[A-Z]+/, '')) - 1;
      (grade[linha] ??= [])[coluna(ref)] = valor;
    }
    abas[nome] = Array.from({ length: grade.length }, (_, i) => Array.from({ length: grade[i]?.length ?? 0 }, (_, j) => grade[i]?.[j] ?? ''));
  }
  return abas;
}

// ---------- Aba de CMV ----------

export interface ItemCmv {
  unidade: string | null; item: string; valor_unit: number | null;
  est_ini_qtd: number | null; est_ini_valor: number; compras: number; est_fin_qtd: number | null; est_fin_valor: number;
}
export interface SemanaCmv {
  inicio: string; fim: string; itens: ItemCmv[];
  cmv_pct_planilha: number | null; // o "CMV %" que a própria planilha calculou, para conferir
  estoque_inicial: number; compras: number; estoque_final: number; cmv: number;
  preenchida: boolean; // semana sem compras e sem estoque final ainda não foi preenchida
}

const centavos = (v: Celula | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : 0);
const numero = (v: Celula | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dois = (n: number) => String(n).padStart(2, '0');

/** Ano da semana: a planilha só traz dia/mês. Usa o ano da data de referência; mês muito à frente é do ano anterior. */
function datasDaSemana(d1: number, m1: number, d2: number, m2: number, ref: Date) {
  let ano = ref.getFullYear();
  if (m1 > ref.getMonth() + 2) ano -= 1;
  const ano2 = m2 < m1 ? ano + 1 : ano;
  return { inicio: `${ano}-${dois(m1)}-${dois(d1)}`, fim: `${ano2}-${dois(m2)}-${dois(d2)}` };
}

/**
 * Acha os blocos "SEMANA: dd/mm A dd/mm" na aba de CMV. Em cada bloco as colunas são: unidade, item, valor,
 * estoque inicial (qtd, R$), compras (R$), estoque final (qtd, R$), CMV. O total no fim do bloco não é lido:
 * os totais saem da soma dos itens.
 */
export function semanasDaAbaCmv(grade: Grade, ref = new Date()): SemanaCmv[] {
  const semanas: SemanaCmv[] = [];
  grade.forEach((linha, r) => linha.forEach((cel, c) => {
    const m = typeof cel === 'string' ? /SEMANA\s*:?\s*(\d{1,2})\/(\d{1,2})\s*A\s*(\d{1,2})\/(\d{1,2})/i.exec(cel) : null;
    if (!m) return;
    const { inicio, fim } = datasDaSemana(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), ref);
    // "CMV %" que a planilha calculou (número entre 0 e 1 logo depois do rótulo, na mesma linha), só para conferir.
    let pctPlanilha: number | null = null;
    const rot = linha.findIndex((x, j) => j > c && j <= c + 13 && typeof x === 'string' && /CMV\s*%/i.test(x));
    if (rot >= 0) {
      const v = linha.slice(rot + 1, c + 14).find((x) => typeof x === 'number');
      if (typeof v === 'number' && v > 0 && v < 1) pctPlanilha = Math.round(v * 10_000) / 100;
    }
    const itens: ItemCmv[] = [];
    for (let i = r + 2; i < grade.length; i++) {
      const l = grade[i] ?? [];
      const nome = typeof l[c + 1] === 'string' ? String(l[c + 1]).trim() : '';
      const vazio = (x: Celula | undefined) => x === undefined || x === '';
      if (!nome && vazio(l[c]) && typeof l[c + 4] === 'number') break; // linha de total
      if (typeof l[c] === 'string' && /SEMANA/i.test(l[c] as string)) break;
      if (!nome) continue;
      itens.push({
        unidade: typeof l[c] === 'string' && l[c] ? String(l[c]).trim() : null, item: nome,
        valor_unit: numero(l[c + 2]) === null ? null : centavos(l[c + 2]),
        est_ini_qtd: numero(l[c + 3]), est_ini_valor: centavos(l[c + 4]), compras: centavos(l[c + 5]),
        est_fin_qtd: numero(l[c + 6]), est_fin_valor: centavos(l[c + 7]),
      });
    }
    const soma = (k: 'est_ini_valor' | 'compras' | 'est_fin_valor') => itens.reduce((s, i) => s + i[k], 0);
    const estoque_inicial = soma('est_ini_valor'), compras = soma('compras'), estoque_final = soma('est_fin_valor');
    semanas.push({ inicio, fim, cmv_pct_planilha: pctPlanilha, itens, estoque_inicial, compras, estoque_final, cmv: estoque_inicial + compras - estoque_final, preenchida: compras > 0 || estoque_final > 0 });
  }));
  return semanas.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** Acha a aba de CMV (nome começando por "CMV") e lê as semanas. */
export async function lerCmvDoArquivo(arquivo: File, ref = new Date()) {
  const abas = await lerPlanilha(await arquivo.arrayBuffer());
  const nome = Object.keys(abas).find((n) => /^\s*CMV/i.test(n));
  if (!nome) throw new Error('Não achei a aba de CMV nesta planilha.');
  const semanas = semanasDaAbaCmv(abas[nome], ref);
  if (!semanas.length) throw new Error('Não achei nenhuma semana ("SEMANA: dd/mm A dd/mm") na aba de CMV.');
  return semanas;
}
