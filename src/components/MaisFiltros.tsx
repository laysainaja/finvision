import { useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { MoneyInput } from './ui';

/** Filtros extras do extrato (todos opcionais; vazio = não filtra). Valores em centavos, datas 'YYYY-MM-DD'. */
export interface FiltrosExtras {
  contato_id: string;
  origem: string;
  recorrencia: '' | 'com' | 'sem';
  conciliacao: '' | 'conciliado' | 'nao_conciliado';
  baixa: '' | 'manual' | 'conciliacao' | 'sem';
  centro_custo: string;
  forma_pagamento: string;
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

export const FILTROS_VAZIOS: FiltrosExtras = {
  contato_id: '', origem: '', recorrencia: '', conciliacao: '', baixa: '', centro_custo: '', forma_pagamento: '',
  aberto_min: null, aberto_max: null, pago_min: null, pago_max: null, venc_de: '', venc_ate: '', prev_de: '', prev_ate: '', cad_de: '', cad_ate: '',
};

/** Quantos filtros extras estão em uso (cada par de/até ou mín/máx conta como um). */
export function contarFiltros(f: FiltrosExtras) {
  const pares: [unknown, unknown][] = [[f.aberto_min, f.aberto_max], [f.pago_min, f.pago_max], [f.venc_de, f.venc_ate], [f.prev_de, f.prev_ate], [f.cad_de, f.cad_ate]];
  const simples = [f.contato_id, f.origem, f.recorrencia, f.conciliacao, f.baixa, f.centro_custo, f.forma_pagamento].filter(Boolean).length;
  return simples + pares.filter(([a, b]) => (a !== null && a !== '') || (b !== null && b !== '')).length;
}

/** Parâmetros da URL (só os preenchidos). */
export function paramsFiltros(f: FiltrosExtras) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== '')) as Record<string, string | number>;
}

interface Opcoes { contatos: { id: number; nome: string }[]; centros_custo: string[]; formas_pagamento: string[]; origens: Record<string, string> }

export function MaisFiltros({ valor, onChange }: { valor: FiltrosExtras; onChange: (f: FiltrosExtras) => void }) {
  const { base, versao } = useEmpresa();
  const { data: op } = useApi<Opcoes>(`${base}/movimentacoes/opcoes?v=${versao}`);
  const set = <K extends keyof FiltrosExtras>(k: K, v: FiltrosExtras[K]) => onChange({ ...valor, [k]: v });
  const Periodo = ({ titulo, de, ate }: { titulo: string; de: 'venc_de' | 'prev_de' | 'cad_de'; ate: 'venc_ate' | 'prev_ate' | 'cad_ate' }) => (
    <label className="field-inline">{titulo}
      <span className="filtro-par">
        <input className="input" type="date" value={valor[de]} onChange={(e) => set(de, e.target.value)} aria-label={`${titulo}: de`} />
        <span className="muted">até</span>
        <input className="input" type="date" value={valor[ate]} onChange={(e) => set(ate, e.target.value)} aria-label={`${titulo}: até`} />
      </span>
    </label>
  );
  const Faixa = ({ titulo, min, max }: { titulo: string; min: 'aberto_min' | 'pago_min'; max: 'aberto_max' | 'pago_max' }) => (
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
      <label className="field-inline">Cliente/Fornecedor
        <select className="select input" value={valor.contato_id} onChange={(e) => set('contato_id', e.target.value)}>
          <option value="">Todos</option>
          {op?.contatos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </label>
      <label className="field-inline">Origem do lançamento
        <select className="select input" value={valor.origem} onChange={(e) => set('origem', e.target.value)}>
          <option value="">Todas</option>
          {op && Object.entries(op.origens).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="field-inline">Recorrência
        <select className="select input" value={valor.recorrencia} onChange={(e) => set('recorrencia', e.target.value as FiltrosExtras['recorrencia'])}>
          <option value="">Todas</option>
          <option value="com">Com recorrência / parcelas</option>
          <option value="sem">Sem recorrência</option>
        </select>
      </label>
      <label className="field-inline">Baixa
        <select className="select input" value={valor.baixa} onChange={(e) => set('baixa', e.target.value as FiltrosExtras['baixa'])}>
          <option value="">Todas</option>
          <option value="manual">Baixa manual</option>
          <option value="conciliacao">Baixa pela conciliação</option>
          <option value="sem">Sem baixa (em aberto)</option>
        </select>
      </label>
      <label className="field-inline">Situação da conciliação
        <select className="select input" value={valor.conciliacao} onChange={(e) => set('conciliacao', e.target.value as FiltrosExtras['conciliacao'])}>
          <option value="">Todas</option>
          <option value="conciliado">Conciliado com o extrato do banco</option>
          <option value="nao_conciliado">Não conciliado</option>
        </select>
      </label>
      <label className="field-inline">Centro de custo
        <select className="select input" value={valor.centro_custo} onChange={(e) => set('centro_custo', e.target.value)}>
          <option value="">Todos</option>
          <option value="__sem">Sem centro de custo</option>
          {op?.centros_custo.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="field-inline">Forma de pagamento
        <select className="select input" value={valor.forma_pagamento} onChange={(e) => set('forma_pagamento', e.target.value)}>
          <option value="">Todas</option>
          <option value="__sem">Não informada</option>
          {op?.formas_pagamento.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      {Faixa({ titulo: 'Valor em aberto', min: 'aberto_min', max: 'aberto_max' })}
      {Faixa({ titulo: 'Valor pago/recebido', min: 'pago_min', max: 'pago_max' })}
      {Periodo({ titulo: 'Vencimento original', de: 'venc_de', ate: 'venc_ate' })}
      {Periodo({ titulo: 'Previsão de pagamento/recebimento', de: 'prev_de', ate: 'prev_ate' })}
      {Periodo({ titulo: 'Data de cadastro', de: 'cad_de', ate: 'cad_ate' })}
    </>
  );
}
