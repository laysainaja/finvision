export type TipoLancamento = 'pagar' | 'receber';
export type Status = 'aberto' | 'vencido' | 'pago';

export type Papel = 'dono' | 'membro';

export type Segmento = 'servico' | 'produto';
export const NOME_SEGMENTO: Record<Segmento, string> = { servico: 'Serviço', produto: 'Produto' };

export interface Empresa {
  id: number;
  nome: string;
  documento: string | null;
  papel: Papel;
  segmento: Segmento;
  escritorio_id: number | null;
  escritorio_nome: string | null;
  /** true quando o acesso vem do escritório (gestão), não de um convite direto. */
  via_escritorio: boolean;
}

export interface Escritorio {
  id: number;
  nome: string;
  papel: 'admin' | 'colaborador';
}

export interface EmpresaGestao {
  id: number;
  nome: string;
  documento: string | null;
  segmento: Segmento;
  saldo: number;
  receber_vencido: number;
  pagar_vencido: number;
  pagar_hoje: number;
  pendentes_conciliacao: number;
  usuarios: number;
}

export type LinhaDRE = 'receita_bruta' | 'deducao' | 'custo' | 'despesa_operacional' | 'receita_financeira' | 'despesa_financeira' | 'outra_receita' | 'outra_despesa' | 'fora_resultado';
export const NOME_LINHA_DRE: Record<LinhaDRE, string> = {
  receita_bruta: 'Receita bruta',
  deducao: 'Deduções / impostos sobre o faturamento',
  custo: 'Custos (mercadorias e serviços)',
  despesa_operacional: 'Despesas operacionais',
  receita_financeira: 'Receitas financeiras',
  despesa_financeira: 'Despesas financeiras',
  outra_receita: 'Outras receitas',
  outra_despesa: 'Outras despesas',
  fora_resultado: 'Fora do resultado (transferências, empréstimos)',
};

export type Regime = 'caixa' | 'competencia';
type PorMes = Record<string, number>;

export interface RelatorioDRE {
  de: string;
  ate: string;
  regime: Regime;
  meses: string[];
  linhas: {
    id: string;
    nome: string;
    tipo: 'grupo' | 'resultado';
    valores: PorMes;
    total: number;
    av: number | null;
    categorias?: { id: number | null; nome: string; valores: PorMes; total: number; av: number | null }[];
  }[];
}

export interface RelatorioAnalise {
  de: string;
  ate: string;
  regime: Regime;
  tipo: TipoLancamento;
  agrupar: 'categoria' | 'contato';
  meses: string[];
  itens: { nome: string; valores: PorMes; total: number; av: number }[];
  totais: PorMes;
  total: number;
}

export interface RelatorioVencidos {
  hoje: string;
  tipo: TipoLancamento;
  faixas: { id: 'ate30' | 'ate60' | 'ate90' | 'mais90'; nome: string }[];
  totais: Record<string, number>;
  total: number;
  contatos: ({ nome: string; total: number; qtd: number; maior_atraso: number; lancamentos: { id: number; descricao: string; vencimento: string; valor: number; dias: number; categoria_nome: string | null }[] } & Record<string, number | string | unknown>)[];
}

export type SituacaoExtrato = 'recebido' | 'pago' | 'aberto' | 'vencido';

export interface ItemExtrato {
  id: number;
  tipo: TipoLancamento;
  descricao: string;
  contato: string | null;
  contato_id: number | null;
  tipo_receita: TipoReceita | null;
  documento: string | null;
  valor: number;
  valor_pago: number | null;
  vencimento: string;
  data_pagamento: string | null;
  data: string;
  parcela: number | null;
  total_parcelas: number | null;
  categoria_id: number | null;
  categoria_nome: string | null;
  conta_bancaria_id: number | null;
  conta_nome: string | null;
  extrato_id: number | null;
  transferencia_id: string | null;
  situacao: SituacaoExtrato;
  valor_extrato: number;
  saldo: number | null;
}

export interface Movimentacoes {
  de: string;
  ate: string;
  hoje: string;
  saldo_inicial: number;
  saldo_final: number;
  resumo: { receitas_aberto: number; receitas_realizadas: number; despesas_aberto: number; despesas_realizadas: number; total_periodo: number };
  itens: ItemExtrato[];
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
  /** Link público do convite, montado pelo servidor com o endereço oficial do site. */
  link: string;
  /** Só vem logo após criar o convite. */
  email_enviado?: boolean;
  email_motivo?: 'nao_configurado' | 'modo_teste' | 'erro' | null;
}

export interface InfoConvite {
  empresa_nome: string;
  email: string;
  papel: Papel;
  expirado: boolean;
  aceito: boolean;
  tem_conta?: boolean;
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

export type GrupoForecast = 'investimento' | 'imposto_anuncio' | 'variavel' | 'fixo';
export const NOME_GRUPO_FORECAST: Record<GrupoForecast, string> = {
  investimento: 'Investimento em anúncios',
  imposto_anuncio: 'Imposto de anúncio',
  variavel: 'Custo variável',
  fixo: 'Custo fixo',
};

export interface Categoria {
  id: number;
  nome: string;
  tipo: 'receita' | 'despesa';
  dre: LinhaDRE | null;
  grupo_forecast: GrupoForecast | null;
}

export type TipoReceita = 'recorrente' | 'nova' | 'avulsa';
export const NOME_TIPO_RECEITA: Record<TipoReceita, string> = { recorrente: 'Recorrente', nova: 'Nova venda', avulsa: 'Avulsa' };

export interface Contato {
  id: number;
  nome: string;
  tipo: 'cliente' | 'fornecedor' | 'ambos';
  documento: string | null;
  email: string | null;
  telefone: string | null;
  observacao: string | null;
  total_receber: number;
  total_pagar: number;
  lancamentos: number;
  ultimo_movimento: string | null;
}

export type FormatoForecast = 'moeda' | 'numero' | 'pct' | 'roas';
export interface LinhaForecast {
  id: string;
  nome: string;
  formato: FormatoForecast;
  valores: Record<string, number | null>;
  total: number | null;
  /** Linha que aceita valor informado à mão (clientes totais). */
  editavel?: boolean;
  calculados?: Record<string, number>;
  ajustados?: string[];
}
export interface RelatorioForecast {
  de: string;
  ate: string;
  hoje: string;
  meses: { mes: string; status: 'realizado' | 'atual' | 'projecao' }[];
  blocos: { id: string; titulo: string; linhas: LinhaForecast[]; destaque?: LinhaForecast }[];
  sem_tipo: number;
}

export interface Lancamento {
  id: number;
  tipo: TipoLancamento;
  descricao: string;
  contato: string | null;
  contato_id: number | null;
  tipo_receita: TipoReceita | null;
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
  juros: number;
  multa: number;
  desconto: number;
  restante_de: number | null;
  centro_custo: string | null;
  forma_pagamento: string | null;
  data_prevista: string | null;
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
