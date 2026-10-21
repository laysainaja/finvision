import { Fragment, useState } from 'react';
import { qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { addMeses, brl, dataBR, fimMes, hoje, inicioMes, mesCurto, num } from '../lib/format';
import { exportarCSV, pctCSV } from '../lib/exportar';
import type { Regime, RelatorioAnalise, RelatorioDRE, RelatorioVencidos, TipoLancamento } from '../types';
import { Icon } from '../components/ui';

// ---------- Catálogo ----------

type Segmento = 'servico' | 'produto';
export const RELATORIOS: { id: string; nome: string; descricao: string; grupo: string; segmento?: Segmento }[] = [
  { id: 'forecast', nome: 'Forecast', descricao: 'Investimento e ROAS, vendas, retenção e churn, receita, custos fixos e variáveis, lucro e caixa: realizado e projeção.', grupo: 'Resultado' },
  { id: 'dre', nome: 'DRE gerencial', descricao: 'Receita, custos, despesas e resultado (lucro ou prejuízo) mês a mês.', grupo: 'Resultado' },
  { id: 'margem', nome: 'Margem bruta e CMV', descricao: 'Quanto sobra das vendas depois do custo das mercadorias, mês a mês.', grupo: 'Resultado', segmento: 'produto' },
  { id: 'recebimentos', nome: 'Análise de recebimentos', descricao: 'Recebimentos por categoria (ou por cliente) em cada mês, com participação no total.', grupo: 'Análise financeira' },
  { id: 'pagamentos', nome: 'Análise de pagamentos', descricao: 'Pagamentos por categoria (ou por fornecedor) em cada mês, com participação no total.', grupo: 'Análise financeira' },
  { id: 'clientes', nome: 'Receita por cliente', descricao: 'Quanto cada cliente pagou em cada mês e o peso de cada um no faturamento.', grupo: 'Análise financeira', segmento: 'servico' },
  { id: 'fornecedores', nome: 'Gastos por fornecedor', descricao: 'Quanto foi pago a cada fornecedor em cada mês.', grupo: 'Análise financeira', segmento: 'produto' },
  { id: 'vencidos', nome: 'Contas vencidas e inadimplência', descricao: 'Valores em atraso por cliente ou fornecedor, separados por faixa de dias.', grupo: 'Análise financeira' },
];
export const relatoriosDoSegmento = (s: Segmento) => RELATORIOS.filter((r) => !r.segmento || r.segmento === s);

// ---------- Peças comuns ----------

type Periodo = { de: string; ate: string };
const ultimos12 = (): Periodo => ({ de: addMeses(inicioMes(hoje()), -11), ate: fimMes(hoje()) });
const PRESETS: { id: string; nome: string; calc: () => Periodo }[] = [
  { id: '12m', nome: 'Últimos 12 meses', calc: ultimos12 },
  { id: 'ano', nome: 'Este ano', calc: () => ({ de: hoje().slice(0, 4) + '-01-01', ate: hoje().slice(0, 4) + '-12-31' }) },
  { id: 'anterior', nome: 'Ano passado', calc: () => { const a = Number(hoje().slice(0, 4)) - 1; return { de: `${a}-01-01`, ate: `${a}-12-31` }; } },
  { id: '3m', nome: 'Últimos 3 meses', calc: () => ({ de: addMeses(inicioMes(hoje()), -2), ate: fimMes(hoje()) }) },
];

function BarraFiltros({ periodo, setPeriodo, regime, setRegime, extra, onExportar }: {
  periodo: Periodo; setPeriodo: (p: Periodo) => void; regime?: Regime; setRegime?: (r: Regime) => void; extra?: React.ReactNode; onExportar?: () => void;
}) {
  const [preset, setPreset] = useState('12m');
  return (
    <div className="toolbar">
      <div className="tabs">
        {PRESETS.map((p) => (
          <button key={p.id} className={'tab' + (preset === p.id ? ' ativo' : '')} onClick={() => (setPreset(p.id), setPeriodo(p.calc()))}>{p.nome}</button>
        ))}
      </div>
      <label className="field-inline">De
        <input className="input" type="month" value={periodo.de.slice(0, 7)} onChange={(e) => e.target.value && (setPreset(''), setPeriodo({ ...periodo, de: e.target.value + '-01' }))} />
      </label>
      <label className="field-inline">Até
        <input className="input" type="month" value={periodo.ate.slice(0, 7)} onChange={(e) => e.target.value && (setPreset(''), setPeriodo({ ...periodo, ate: fimMes(e.target.value + '-01') }))} />
      </label>
      {regime && setRegime && (
        <div className="tabs" title="Caixa: pela data do pagamento, só o realizado. Competência: pela data de vencimento, incluindo o que está em aberto.">
          <button className={'tab' + (regime === 'caixa' ? ' ativo' : '')} onClick={() => setRegime('caixa')}>Regime de caixa</button>
          <button className={'tab' + (regime === 'competencia' ? ' ativo' : '')} onClick={() => setRegime('competencia')}>Competência</button>
        </div>
      )}
      {extra}
      {onExportar && <button className="btn" style={{ marginLeft: 'auto' }} onClick={onExportar}><Icon name="upload" /> Exportar planilha</button>}
    </div>
  );
}

const Valor = ({ v, forte }: { v: number; forte?: boolean }) => (
  <td className={'r num ' + (v < 0 ? 'saida' : '') + (v === 0 ? ' muted' : '')} style={forte ? { fontWeight: 650 } : undefined}>{v === 0 ? '–' : num(v)}</td>
);
const Pct = ({ v }: { v: number | null }) => <td className="r num muted small">{v === null ? '' : `${v.toLocaleString('pt-BR')}%`}</td>;

function Cabecalho({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div className="page-header">
      <div>
        <a href="#/relatorios" className="small muted">← Relatórios</a>
        <h1>{titulo}</h1>
        <p>{descricao}</p>
      </div>
    </div>
  );
}

// ---------- Página inicial de relatórios ----------

export function RelatoriosInicio() {
  const { empresa } = useEmpresa();
  const lista = relatoriosDoSegmento(empresa?.segmento ?? 'servico');
  const grupos = [...new Set(lista.map((r) => r.grupo))];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Relatórios</h1>
          <p>Escolha um relatório. Todos podem ser exportados para planilha.</p>
        </div>
      </div>
      {grupos.map((g) => (
        <div key={g} className="card">
          <div className="card-header"><h2>{g}</h2></div>
          <div className="relatorios-grade">
            {lista.filter((r) => r.grupo === g).map((r) => (
              <a key={r.id} className="relatorio-cartao" href={`#/relatorios/${r.id}`}>
                <b>{r.nome}</b>
                <span className="muted small">{r.descricao}</span>
                {r.segmento && <span className={'badge badge-segmento-' + r.segmento} style={{ alignSelf: 'flex-start' }}>Exclusivo {r.segmento === 'servico' ? 'serviço' : 'produto'}</span>}
              </a>
            ))}
            {g === 'Resultado' && (
              <a className="relatorio-cartao" href="#/fluxo">
                <b>Fluxo de caixa</b>
                <span className="muted small">Entradas, saídas e saldo realizado e previsto, por dia, semana ou mês.</span>
              </a>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// ---------- DRE ----------

function useDRE(periodo: Periodo, regime: Regime) {
  const { base, versao } = useEmpresa();
  return useApi<RelatorioDRE>(`${base}/relatorios/dre${qs({ de: periodo.de, ate: periodo.ate, regime, v: versao })}`);
}

export function DRE() {
  const [periodo, setPeriodo] = useState(ultimos12);
  const [regime, setRegime] = useState<Regime>('caixa');
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const { data, erro } = useDRE(periodo, regime);
  const { empresa } = useEmpresa();

  const alternar = (id: string) => setAbertos((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exportar = () => {
    if (!data) return;
    const linhas: (string | number | null)[][] = [];
    for (const l of data.linhas) {
      linhas.push([l.nome, ...data.meses.map((m) => l.valores[m]), l.total, pctCSV(l.av)]);
      for (const c of l.categorias ?? []) linhas.push([`    ${c.nome}`, ...data.meses.map((m) => c.valores[m]), c.total, pctCSV(c.av)]);
    }
    exportarCSV(`DRE ${empresa?.nome} ${data.de} a ${data.ate} (${regime})`, ['Descrição', ...data.meses.map(mesCurto), 'Total', 'AV%'], linhas);
  };

  return (
    <>
      <Cabecalho titulo="DRE gerencial" descricao="Demonstração do resultado: quanto entrou, quanto custou e quanto sobrou em cada mês." />
      <div className="card">
        <BarraFiltros periodo={periodo} setPeriodo={setPeriodo} regime={regime} setRegime={setRegime} onExportar={exportar}
          extra={<button className="btn btn-ghost btn-sm" onClick={() => setAbertos(abertos.size ? new Set() : new Set(data?.linhas.filter((l) => l.categorias?.length).map((l) => l.id)))}>{abertos.size ? 'Recolher tudo' : 'Expandir tudo'}</button>} />
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && (
          <div className="table-wrap">
            <table className="tabela-relatorio">
              <thead>
                <tr>
                  <th className="col-fixa">Descrição</th>
                  {data.meses.map((m) => <th key={m} className="r">{mesCurto(m + '-01')}</th>)}
                  <th className="r">Total</th>
                  <th className="r">AV%</th>
                </tr>
              </thead>
              <tbody>
                {data.linhas.map((l) => (
                  <Fragment key={l.id}>
                    <tr className={l.tipo === 'resultado' ? 'linha-resultado' : 'linha-grupo'}>
                      <td className="col-fixa">
                        {l.categorias?.length ? (
                          <button className="btn-texto" onClick={() => alternar(l.id)} aria-expanded={abertos.has(l.id)}>
                            <span className={'seta-expandir' + (abertos.has(l.id) ? ' aberta' : '')}>▸</span> {l.nome}
                          </button>
                        ) : <span style={{ paddingLeft: l.tipo === 'resultado' ? 0 : 18 }}>{l.nome}</span>}
                      </td>
                      {data.meses.map((m) => <Valor key={m} v={l.valores[m]} forte={l.tipo === 'resultado'} />)}
                      <Valor v={l.total} forte />
                      <Pct v={l.av} />
                    </tr>
                    {abertos.has(l.id) && l.categorias?.map((c) => (
                      <tr key={l.id + c.nome} className="linha-categoria">
                        <td className="col-fixa" style={{ paddingLeft: 40 }}>{c.nome}</td>
                        {data.meses.map((m) => <Valor key={m} v={c.valores[m]} />)}
                        <Valor v={c.total} />
                        <Pct v={c.av} />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Cada categoria entra numa linha da DRE conforme a classificação em <a href="#/cadastros">Cadastros → Categorias</a>. AV% é o peso de cada linha sobre a receita bruta.
        {regime === 'caixa' ? ' Regime de caixa: só o que já foi pago ou recebido, na data do pagamento.' : ' Competência: tudo, pela data de vencimento, inclusive o que está em aberto.'}
      </p>
    </>
  );
}

// ---------- Margem bruta e CMV (produto) ----------

export function Margem() {
  const [periodo, setPeriodo] = useState(ultimos12);
  const [regime, setRegime] = useState<Regime>('competencia');
  const { data, erro } = useDRE(periodo, regime);
  const { empresa } = useEmpresa();
  const linha = (id: string) => data?.linhas.find((l) => l.id === id);
  const rl = linha('receita_liquida'), custo = linha('custo'), lb = linha('lucro_bruto');
  const margem = (m?: string) => {
    const r = m ? rl?.valores[m] ?? 0 : rl?.total ?? 0;
    const b = m ? lb?.valores[m] ?? 0 : lb?.total ?? 0;
    return r ? Math.round((b / r) * 1000) / 10 : null;
  };
  const exportar = () => data && exportarCSV(`Margem bruta ${empresa?.nome} ${data.de} a ${data.ate}`, ['Mês', 'Receita líquida', 'Custos (CMV)', 'Lucro bruto', 'Margem bruta %'],
    data.meses.map((m) => [mesCurto(m + '-01'), rl!.valores[m], custo!.valores[m], lb!.valores[m], pctCSV(margem(m))]));
  const maxReceita = Math.max(1, ...(data?.meses.map((m) => rl?.valores[m] ?? 0) ?? [1]));

  return (
    <>
      <Cabecalho titulo="Margem bruta e CMV" descricao="Receita líquida menos o custo das mercadorias vendidas (CMV): quanto sobra para pagar as despesas e gerar lucro." />
      <div className="grid grid-4">
        <div className="card kpi"><div className="kpi-label">Receita líquida</div><div className="kpi-valor">{brl(rl?.total ?? 0)}</div></div>
        <div className="card kpi"><div className="kpi-label">Custos (CMV)</div><div className="kpi-valor saida">{brl(custo?.total ?? 0)}</div></div>
        <div className="card kpi"><div className="kpi-label">Lucro bruto</div><div className={'kpi-valor ' + ((lb?.total ?? 0) < 0 ? 'alerta' : '')}>{brl(lb?.total ?? 0)}</div></div>
        <div className="card kpi"><div className="kpi-label">Margem bruta</div><div className="kpi-valor">{margem() === null ? '–' : `${margem()!.toLocaleString('pt-BR')}%`}</div></div>
      </div>
      <div className="card">
        <BarraFiltros periodo={periodo} setPeriodo={setPeriodo} regime={regime} setRegime={setRegime} onExportar={exportar} />
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && rl && custo && lb && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Mês</th><th className="r">Receita líquida</th><th className="r">Custos (CMV)</th><th className="r">Lucro bruto</th><th className="r">Margem bruta</th><th style={{ width: '28%' }}>Receita × lucro bruto</th></tr></thead>
              <tbody>
                {data.meses.map((m) => (
                  <tr key={m}>
                    <td>{mesCurto(m + '-01')}</td>
                    <Valor v={rl.valores[m]} />
                    <Valor v={custo.valores[m]} />
                    <Valor v={lb.valores[m]} forte />
                    <td className="r num">{margem(m) === null ? '–' : `${margem(m)!.toLocaleString('pt-BR')}%`}</td>
                    <td>
                      <div className="barra-dupla" title={`Receita ${brl(rl.valores[m])} · Lucro bruto ${brl(lb.valores[m])}`}>
                        <div style={{ width: `${(Math.max(0, rl.valores[m]) / maxReceita) * 100}%`, background: 'var(--serie-entrada)', opacity: 0.35 }} />
                        <div style={{ width: `${(Math.max(0, lb.valores[m]) / maxReceita) * 100}%`, background: 'var(--serie-entrada)' }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        CMV = categorias classificadas como <b>Custos</b> (ex.: Compra de mercadorias, Fretes, Embalagens). Ajuste em Cadastros → Categorias. Competência é o mais indicado para margem.
      </p>
    </>
  );
}

// ---------- Análises (recebimentos / pagamentos / por cliente / por fornecedor) ----------

export function Analise({ tipo, agruparInicial, fixo, titulo, descricao }: {
  tipo: TipoLancamento; agruparInicial: 'categoria' | 'contato'; fixo?: boolean; titulo: string; descricao: string;
}) {
  const { base, versao, empresa } = useEmpresa();
  const [periodo, setPeriodo] = useState(ultimos12);
  const [regime, setRegime] = useState<Regime>('caixa');
  const [agrupar, setAgrupar] = useState(agruparInicial);
  const { data, erro } = useApi<RelatorioAnalise>(`${base}/relatorios/analise${qs({ tipo, agrupar, de: periodo.de, ate: periodo.ate, regime, v: versao })}`);
  const nomeContato = tipo === 'receber' ? 'Cliente' : 'Fornecedor';
  const cor = tipo === 'receber' ? 'var(--serie-entrada)' : 'var(--serie-saida)';
  const top = data?.itens.slice(0, 10) ?? [];
  const exportar = () => data && exportarCSV(`${titulo} ${empresa?.nome} ${data.de} a ${data.ate}`, [agrupar === 'categoria' ? 'Categoria' : nomeContato, ...data.meses.map((m) => mesCurto(m + '-01')), 'Total', 'AV%'],
    [...data.itens.map((i) => [i.nome, ...data.meses.map((m) => i.valores[m]), i.total, pctCSV(i.av)]), ['Total', ...data.meses.map((m) => data.totais[m]), data.total, '100%']]);

  return (
    <>
      <Cabecalho titulo={titulo} descricao={descricao} />
      <div className="card">
        <BarraFiltros periodo={periodo} setPeriodo={setPeriodo} regime={regime} setRegime={setRegime} onExportar={exportar}
          extra={!fixo && (
            <div className="tabs">
              <button className={'tab' + (agrupar === 'categoria' ? ' ativo' : '')} onClick={() => setAgrupar('categoria')}>Por categoria</button>
              <button className={'tab' + (agrupar === 'contato' ? ' ativo' : '')} onClick={() => setAgrupar('contato')}>Por {nomeContato.toLowerCase()}</button>
            </div>
          )} />
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && (
          <>
            <div className="card-pad">
              <div className="kpi-label" style={{ marginBottom: 10 }}>
                Total no período: <b className="num" style={{ color: 'var(--text)' }}>{brl(data.total)}</b>
                {data.itens.length > 10 && <span className="muted"> · maiores 10 de {data.itens.length}</span>}
              </div>
              <div className="barras-h">
                {top.map((i) => (
                  <div key={i.nome} className="barra-h" title={`${i.nome}: ${brl(i.total)} (${i.av.toLocaleString('pt-BR')}%)`}>
                    <span className="barra-h-nome">{i.nome}</span>
                    <span className="barra-h-trilho"><span style={{ width: `${(i.total / (top[0]?.total || 1)) * 100}%`, background: cor }} /></span>
                    <span className="num small">{brl(i.total)}</span>
                    <span className="num small muted" style={{ width: 52, textAlign: 'right' }}>{i.av.toLocaleString('pt-BR')}%</span>
                  </div>
                ))}
                {top.length === 0 && <div className="vazio">Nenhum {tipo === 'receber' ? 'recebimento' : 'pagamento'} no período.</div>}
              </div>
            </div>
            {data.itens.length > 0 && (
              <div className="table-wrap">
                <table className="tabela-relatorio">
                  <thead>
                    <tr>
                      <th className="col-fixa">{agrupar === 'categoria' ? 'Categoria' : nomeContato}</th>
                      <th className="r">Total</th>
                      <th className="r">AV%</th>
                      {data.meses.map((m) => <th key={m} className="r">{mesCurto(m + '-01')}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.itens.map((i) => (
                      <tr key={i.nome}>
                        <td className="col-fixa">{i.nome}</td>
                        <Valor v={i.total} forte />
                        <Pct v={i.av} />
                        {data.meses.map((m) => <Valor key={m} v={i.valores[m]} />)}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="col-fixa">Total</td>
                      <Valor v={data.total} forte />
                      <Pct v={100} />
                      {data.meses.map((m) => <Valor key={m} v={data.totais[m]} forte />)}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ---------- Contas vencidas ----------

export function Vencidos() {
  const { base, versao, empresa } = useEmpresa();
  const [tipo, setTipo] = useState<TipoLancamento>('receber');
  const [aberto, setAberto] = useState<string | null>(null);
  const { data, erro } = useApi<RelatorioVencidos>(`${base}/relatorios/vencidos${qs({ tipo, v: versao })}`);
  const nomeContato = tipo === 'receber' ? 'Cliente' : 'Fornecedor';
  const exportar = () => data && exportarCSV(`Contas vencidas a ${tipo} ${empresa?.nome} ${data.hoje}`, [nomeContato, ...data.faixas.map((f) => f.nome), 'Total', 'Qtd.', 'Maior atraso (dias)'],
    data.contatos.map((c) => [c.nome, ...data.faixas.map((f) => c[f.id] as number), c.total, String(c.qtd), String(c.maior_atraso)]));

  return (
    <>
      <Cabecalho titulo="Contas vencidas e inadimplência" descricao="O que está em atraso hoje, por quanto tempo e com quem." />
      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            <button className={'tab' + (tipo === 'receber' ? ' ativo' : '')} onClick={() => setTipo('receber')}>A receber (inadimplência)</button>
            <button className={'tab' + (tipo === 'pagar' ? ' ativo' : '')} onClick={() => setTipo('pagar')}>A pagar (atrasadas)</button>
          </div>
          {data && <span className="muted small">Posição em {dataBR(data.hoje)}</span>}
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={exportar}><Icon name="upload" /> Exportar planilha</button>
        </div>
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && (
          <>
            <div className="cartoes-extrato">
              {data.faixas.map((f) => (
                <div key={f.id} className="cartao-extrato" style={{ cursor: 'default' }}>
                  <span className="kpi-label">{f.nome}</span>
                  <span className={'cartao-valor num ' + (data.totais[f.id] ? 'alerta' : 'muted')}>{brl(data.totais[f.id])}</span>
                </div>
              ))}
              <div className="cartao-extrato total" style={{ cursor: 'default' }}>
                <span className="kpi-label">Total vencido</span>
                <span className="cartao-valor num">{brl(data.total)}</span>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{nomeContato}</th>
                    {data.faixas.map((f) => <th key={f.id} className="r">{f.nome}</th>)}
                    <th className="r">Total</th>
                    <th className="r">Maior atraso</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contatos.map((c) => (
                    <Fragment key={c.nome}>
                      <tr>
                        <td>
                          <button className="btn-texto" onClick={() => setAberto(aberto === c.nome ? null : c.nome)} aria-expanded={aberto === c.nome}>
                            <span className={'seta-expandir' + (aberto === c.nome ? ' aberta' : '')}>▸</span> <b>{c.nome}</b>
                          </button>
                          <div className="desc-sub" style={{ paddingLeft: 18 }}>{c.qtd} conta(s)</div>
                        </td>
                        {data.faixas.map((f) => <Valor key={f.id} v={c[f.id] as number} />)}
                        <Valor v={c.total} forte />
                        <td className="r num">{c.maior_atraso} dias</td>
                      </tr>
                      {aberto === c.nome && c.lancamentos.map((l) => (
                        <tr key={l.id} className="linha-categoria">
                          <td style={{ paddingLeft: 36 }}>{l.descricao}<div className="desc-sub">{l.categoria_nome ?? 'Sem categoria'}</div></td>
                          <td colSpan={data.faixas.length} className="muted small">venceu em {dataBR(l.vencimento)} · {l.dias} dias de atraso</td>
                          <Valor v={l.valor} />
                          <td />
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {data.contatos.length === 0 && <div className="vazio">Nenhuma conta {tipo === 'receber' ? 'a receber' : 'a pagar'} vencida. 🎉</div>}
            </div>
          </>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>Para cobrar ou pagar, abra <a href={`#/${tipo}`}>{tipo === 'receber' ? 'Contas a receber' : 'Contas a pagar'}</a> e filtre por "Vencidos".</p>
    </>
  );
}
