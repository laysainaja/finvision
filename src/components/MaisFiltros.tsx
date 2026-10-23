import { useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { MoneyInput } from './ui';
import { FiltroChecklist, type OpcaoFiltro } from './FiltroChecklist';

/** Filtros de várias opções do extrato: cada um guarda os valores DESMARCADOS (vazio = mostra todos). */
export const LISTAS = ['tipos', 'situacoes', 'contatos', 'origens', 'recorrencias', 'baixas', 'conciliacoes', 'centros', 'formas'] as const;
export type Lista = (typeof LISTAS)[number];

/** Filtros extras do extrato. Listas = desmarcados; faixas em centavos; datas 'YYYY-MM-DD' (vazio = não filtra). */
export interface FiltrosExtras extends Record<Lista, Set<string>> {
  aberto_min: number | null;
  aberto_max: number | null;
  pago_min: number | null;
  pago_max: number | null;
  venc_de: string;
  venc_ate: string;
  prev_de: string;
  prev_ate: string;
  cad_de: string;
  cad_ate: string;
}

export const filtrosVazios = (): FiltrosExtras => ({
  ...(Object.fromEntries(LISTAS.map((k) => [k, new Set<string>()])) as Record<Lista, Set<string>>),
  aberto_min: null, aberto_max: null, pago_min: null, pago_max: null, venc_de: '', venc_ate: '', prev_de: '', prev_ate: '', cad_de: '', cad_ate: '',
});

export const OPCOES_TIPO: OpcaoFiltro[] = [
  { valor: 'receita', label: 'Receita' }, { valor: 'despesa', label: 'Despesa' }, { valor: 'transferencia', label: 'Transferência' },
];
export const OPCOES_SITUACAO: OpcaoFiltro[] = [
  { valor: 'aberto', label: 'A vencer' }, { valor: 'vencido', label: 'Vencido' }, { valor: 'realizado', label: 'Pago / recebido' },
];

/** Quantos filtros estão em uso (cada lista com algo desmarcado, cada faixa ou período preenchido). */
export function contarFiltros(f: FiltrosExtras) {
  const pares: [unknown, unknown][] = [[f.aberto_min, f.aberto_max], [f.pago_min, f.pago_max], [f.venc_de, f.venc_ate], [f.prev_de, f.prev_ate], [f.cad_de, f.cad_ate]];
  return LISTAS.filter((k) => f[k].size > 0).length + pares.filter(([a, b]) => (a !== null && a !== '') || (b !== null && b !== '')).length;
}

/** Parâmetros da URL: "sem_<lista>" com os desmarcados, mais as faixas e datas preenchidas. */
export function paramsFiltros(f: FiltrosExtras) {
  const p: Record<string, string | number> = {};
  for (const k of LISTAS) if (f[k].size) p[`sem_${k}`] = [...f[k]].sort().map(encodeURIComponent).join(',');
  for (const k of ['aberto_min', 'aberto_max', 'pago_min', 'pago_max', 'venc_de', 'venc_ate', 'prev_de', 'prev_ate', 'cad_de', 'cad_ate'] as const) {
    const v = f[k];
    if (v !== null && v !== '') p[k] = v;
  }
  return p;
}

interface Opcoes { contatos: { id: number; nome: string }[]; centros_custo: string[]; formas_pagamento: string[]; origens: Record<string, string> }

export function MaisFiltros({ valor, onChange }: { valor: FiltrosExtras; onChange: (f: FiltrosExtras) => void }) {
  const { base, versao } = useEmpresa();
  const { data: op } = useApi<Opcoes>(`${base}/movimentacoes/opcoes?v=${versao}`);
  const set = <K extends keyof FiltrosExtras>(k: K, v: FiltrosExtras[K]) => onChange({ ...valor, [k]: v });

  const listas: { k: Lista; titulo: string; opcoes: OpcaoFiltro[]; todos?: string }[] = [
    { k: 'contatos', titulo: 'Cliente/Fornecedor', opcoes: [{ valor: '0', label: 'Sem cliente/fornecedor' }, ...(op?.contatos ?? []).map((c) => ({ valor: String(c.id), label: c.nome }))] },
    { k: 'origens', titulo: 'Origem do lançamento', opcoes: Object.entries(op?.origens ?? {}).map(([valor, label]) => ({ valor, label })), todos: 'Todas' },
    { k: 'recorrencias', titulo: 'Recorrência', opcoes: [{ valor: 'com', label: 'Com recorrência / parcelas' }, { valor: 'sem', label: 'Sem recorrência' }], todos: 'Todas' },
    { k: 'baixas', titulo: 'Baixa', opcoes: [{ valor: 'manual', label: 'Baixa manual' }, { valor: 'conciliacao', label: 'Baixa pela conciliação' }, { valor: 'sem', label: 'Sem baixa (em aberto)' }], todos: 'Todas' },
    { k: 'conciliacoes', titulo: 'Situação da conciliação', opcoes: [{ valor: 'conciliado', label: 'Conciliado com o extrato do banco' }, { valor: 'nao_conciliado', label: 'Não conciliado' }], todos: 'Todas' },
    { k: 'centros', titulo: 'Centro de custo', opcoes: [{ valor: '__sem', label: 'Sem centro de custo' }, ...(op?.centros_custo ?? []).map((c) => ({ valor: c, label: c }))] },
    { k: 'formas', titulo: 'Forma de pagamento', opcoes: [{ valor: '__sem', label: 'Não informada' }, ...(op?.formas_pagamento ?? []).map((c) => ({ valor: c, label: c }))], todos: 'Todas' },
  ];
  const Periodo = (titulo: string, de: 'venc_de' | 'prev_de' | 'cad_de', ate: 'venc_ate' | 'prev_ate' | 'cad_ate') => (
    <label className="field-inline">{titulo}
      <span className="filtro-par">
        <input className="input" type="date" value={valor[de]} onChange={(e) => set(de, e.target.value)} aria-label={`${titulo}: de`} />
        <span className="muted">até</span>
        <input className="input" type="date" value={valor[ate]} onChange={(e) => set(ate, e.target.value)} aria-label={`${titulo}: até`} />
      </span>
    </label>
  );
  const Faixa = (titulo: string, min: 'aberto_min' | 'pago_min', max: 'aberto_max' | 'pago_max') => (
    <label className="field-inline">{titulo}
      <span className="filtro-par">
        <MoneyInput value={valor[min] ?? 0} onChange={(v) => set(min, v || null)} />
        <span className="muted">até</span>
        <MoneyInput value={valor[max] ?? 0} onChange={(v) => set(max, v || null)} />
      </span>
    </label>
  );

  return (
    <>
      {listas.map((l) => (
        <div key={l.k} className="field-inline">{l.titulo}
          <FiltroChecklist opcoes={l.opcoes} desmarcados={valor[l.k]} onChange={(s) => set(l.k, s)} rotuloTodos={l.todos} />
        </div>
      ))}
      {Faixa('Valor em aberto', 'aberto_min', 'aberto_max')}
      {Faixa('Valor pago/recebido', 'pago_min', 'pago_max')}
      {Periodo('Vencimento original', 'venc_de', 'venc_ate')}
      {Periodo('Previsão de pagamento/recebimento', 'prev_de', 'prev_ate')}
      {Periodo('Data de cadastro', 'cad_de', 'cad_ate')}
    </>
  );
}
