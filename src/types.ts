export type TipoLancamento = 'pagar' | 'receber';
export type Status = 'aberto' | 'vencido' | 'pago';

export type Papel = 'dono' | 'membro';

export interface Empresa {
  id: number;
  nome: string;
  documento: string | null;
  papel: Papel;
}

export interface Membro {
  user_id: string;
  email: string;
  papel: Papel;
  criado_em: string;
  voce: boolean;
}

export interface Convite {
  id: number;
  email: string;
  papel: Papel;
  token: string;
  criado_em: string;
  expira_em: string;
  expirado: boolean;
}

export interface InfoConvite {
  empresa_nome: string;
  email: string;
  papel: Papel;
  expirado: boolean;
  aceito: boolean;
}

export interface ContaBancaria {
  id: number;
  nome: string;
  banco: string | null;
  saldo_inicial: number;
  data_saldo_inicial: string;
  ativa: number;
  saldo_atual: number;
  pendentes_conciliacao: number;
}

export interface Categoria {
  id: number;
  nome: string;
  tipo: 'receita' | 'despesa';
}

export interface Lancamento {
  id: number;
  tipo: TipoLancamento;
  descricao: string;
  contato: string | null;
  categoria_id: number | null;
  categoria_nome: string | null;
  conta_bancaria_id: number | null;
  conta_nome: string | null;
  valor: number;
  vencimento: string;
  documento: string | null;
  observacao: string | null;
  data_pagamento: string | null;
  valor_pago: number | null;
  origem_baixa: 'manual' | 'conciliacao' | null;
  grupo_parcelas: string | null;
  parcela: number | null;
  total_parcelas: number | null;
  status: Status;
  extrato_id: number | null;
}

export interface Sugestao extends Lancamento {
  score: number;
  valor_exato: boolean;
  dias: number;
}

export interface ExtratoItem {
  id: number;
  conta_bancaria_id: number;
  conta_nome: string;
  data: string;
  descricao: string | null;
  valor: number;
  fitid: string;
  lancamento_id: number | null;
  lancamento_descricao: string | null;
  lancamento_contato: string | null;
  lancamento_vencimento: string | null;
  lancamento_valor: number | null;
  ignorado: number;
}

export interface ResumoTipo {
  vencido: number;
  qtd_vencido: number;
  hoje: number;
  qtd_hoje: number;
  semana: number;
  mes: number;
}

export interface Resumo {
  hoje: string;
  saldo_total: number;
  contas: ContaBancaria[];
  pagar: ResumoTipo;
  receber: ResumoTipo;
  proximos: Lancamento[];
  pendentes_conciliacao: number;
}

export type Agrupamento = 'dia' | 'semana' | 'mes';

export interface PeriodoFluxo {
  inicio: string;
  fim: string;
  entradas_realizadas: number;
  saidas_realizadas: number;
  entradas_previstas: number;
  saidas_previstas: number;
  saldo_final: number;
}

export interface Fluxo {
  de: string;
  ate: string;
  agrupar: Agrupamento;
  hoje: string;
  saldo_inicial: number;
  saldo_final: number;
  totais: Omit<PeriodoFluxo, 'inicio' | 'fim' | 'saldo_final'>;
  menor_saldo_futuro: { inicio: string; saldo: number } | null;
  periodos: PeriodoFluxo[];
  por_categoria: { categoria_id: number | null; nome: string; tipo: TipoLancamento; realizado: number; previsto: number }[];
}
