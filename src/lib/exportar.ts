/** Baixa uma planilha CSV que o Excel abre direto em português (separador ";", vírgula decimal, acentos ok).
 *  Números são centavos. `preambulo` são linhas de título antes da tabela (ex.: empresa e período). */
export function exportarCSV(nomeArquivo: string, cabecalho: string[], linhas: (string | number | null)[][], preambulo: string[] = []) {
  const celula = (v: string | number | null) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return (v / 100).toFixed(2).replace('.', ',');
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const topo = preambulo.length ? [...preambulo.map((p) => celula(p)), ''] : [];
  const csv = [...topo, ...[cabecalho, ...linhas].map((l) => l.map(celula).join(';'))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nomeArquivo}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Percentual já calculado (ex.: 26.49) como texto de planilha. */
export const pctCSV = (v: number | null) => (v === null ? '' : `${String(v).replace('.', ',')}%`);
