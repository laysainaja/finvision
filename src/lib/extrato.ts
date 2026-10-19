// Leitura de extratos bancários (OFX e CSV) no navegador.
// O resultado vai para o servidor, que descarta duplicados pelo `fitid`.

export interface ItemExtrato {
  data: string; // YYYY-MM-DD
  descricao: string;
  valor: number; // centavos; positivo = entrada, negativo = saída
  fitid: string;
}

/** Bancos brasileiros costumam gerar OFX/CSV em Windows-1252; tenta UTF-8 primeiro. */
export async function lerTexto(arquivo: File) {
  const buf = await arquivo.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** "1.234,56", "-1234.56", "1,234.56", "R$ 10,00", "10,00 D" → centavos */
export function parseValor(bruto: string): number | null {
  let s = bruto.trim().replace(/R\$|\s/g, '');
  let sinal = 1;
  if (/[dD-]$/.test(s) || s.startsWith('-') || /^\(.*\)$/.test(s)) sinal = -1;
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const ultimoSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  // O último separador seguido de 1–2 dígitos é o decimal; os demais são de milhar.
  const decimais = ultimoSep >= 0 && s.length - ultimoSep - 1 <= 2 ? s.slice(ultimoSep + 1) : '';
  const inteiro = decimais || ultimoSep < 0 ? s.slice(0, ultimoSep < 0 ? undefined : ultimoSep).replace(/[.,]/g, '') : s.replace(/[.,]/g, '');
  const centavos = Number(inteiro || 0) * 100 + Number(decimais.padEnd(2, '0') || 0);
  return Number.isFinite(centavos) ? sinal * centavos : null;
}

/** "31/12/2025", "31-12-25", "2025-12-31" → "2025-12-31" */
export function parseData(bruto: string): string | null {
  const s = bruto.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

// ---------- OFX ----------

export function parseOFX(texto: string): ItemExtrato[] {
  // OFX 1.x é SGML: as tags de valor muitas vezes não têm fechamento, então lemos até o próximo "<".
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  const tag = (b: string, t: string) => b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i'))?.[1].trim() ?? '';
  const vistos = new Map<string, number>();

  return blocos.flatMap((b, i) => {
    const dt = tag(b, 'DTPOSTED');
    const valor = parseValor(tag(b, 'TRNAMT').replace(/^\+/, ''));
    if (dt.length < 8 || valor === null || valor === 0) return [];
    const data = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const nome = tag(b, 'NAME');
    const memo = tag(b, 'MEMO');
    const descricao = [nome, memo && memo !== nome ? memo : ''].filter(Boolean).join(' · ') || tag(b, 'TRNTYPE');
    // Alguns bancos repetem FITID dentro do mesmo arquivo; o sufixo mantém cada transação única e estável.
    let fitid = tag(b, 'FITID') || `${data}|${valor}|${i}`;
    const n = vistos.get(fitid) ?? 0;
    vistos.set(fitid, n + 1);
    if (n) fitid += `#${n}`;
    return [{ data, descricao, valor, fitid }];
  });
}

// ---------- CSV ----------

function dividirLinha(linha: string, sep: string) {
  const out: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') (atual += '"'), i++;
      else aspas = !aspas;
    } else if (c === sep && !aspas) (out.push(atual), (atual = ''));
    else atual += c;
  }
  out.push(atual);
  return out.map((s) => s.trim());
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function parseCSV(texto: string): { itens: ItemExtrato[]; ignoradas: number } {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return { itens: [], ignoradas: 0 };
  const sep = [';', '\t', ','].sort((a, b) => linhas[0].split(b).length - linhas[0].split(a).length)[0];
  const linhasCols = linhas.map((l) => dividirLinha(l, sep));

  // Localiza o cabeçalho (algumas exportações têm linhas de título antes dele).
  const idxCab = linhasCols.findIndex((cols) => cols.some((c) => /^data/.test(normalizar(c))) && cols.some((c) => /valor|credito|debito|quantia/.test(normalizar(c))));
  let col = { data: 0, desc: 1, valor: -1, credito: -1, debito: -1 };
  let inicio = 0;
  if (idxCab >= 0) {
    const cab = linhasCols[idxCab].map(normalizar);
    const achar = (re: RegExp) => cab.findIndex((c) => re.test(c));
    col = {
      data: achar(/^data/),
      desc: achar(/hist|desc|lanc|memo|detalhe|estabelecimento|titulo/),
      valor: achar(/^valor|quantia|montante/),
      credito: achar(/credito|entrada/),
      debito: achar(/debito|saida/),
    };
    inicio = idxCab + 1;
  } else {
    col.valor = linhasCols[0].length - 1;
  }

  const itens: ItemExtrato[] = [];
  const vistos = new Map<string, number>();
  let ignoradas = 0;
  for (const cols of linhasCols.slice(inicio)) {
    const data = parseData(cols[col.data] ?? '');
    let valor: number | null = null;
    if (col.valor >= 0) valor = parseValor(cols[col.valor] ?? '');
    else {
      const cred = parseValor(cols[col.credito] ?? '') ?? 0;
      const deb = parseValor(cols[col.debito] ?? '') ?? 0;
      valor = Math.abs(cred) - Math.abs(deb);
    }
    const descricao = col.desc >= 0 ? cols[col.desc] ?? '' : '';
    // Linhas de saldo não são transações.
    if (!data || !valor || /^saldo/.test(normalizar(descricao))) {
      ignoradas++;
      continue;
    }
    // CSV não tem identificador: usamos data+valor+descrição e a ocorrência no arquivo,
    // assim importar o mesmo arquivo de novo não duplica nada.
    const chave = `csv|${data}|${valor}|${normalizar(descricao)}`;
    const n = vistos.get(chave) ?? 0;
    vistos.set(chave, n + 1);
    itens.push({ data, descricao, valor, fitid: `${chave}|${n}` });
  }
  return { itens, ignoradas };
}

export async function lerExtrato(arquivo: File) {
  const texto = await lerTexto(arquivo);
  if (/\.ofx$/i.test(arquivo.name) || /<OFX>/i.test(texto)) return { itens: parseOFX(texto), ignoradas: 0 };
  return parseCSV(texto);
}
