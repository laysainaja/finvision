import { Fragment, useState } from 'react';
import { qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { addMeses, brl, dataBR, fimMes, hoje, inicioMes, mesCurto, num } from '../lib/format';
import { exportarCSV, pctCSV } from '../lib/exportar';
import type { AgruparAnalise, Regime, RelatorioAnalise, RelatorioDRE, RelatorioVencidos, TipoLancamento } from '../types';
import { Icon, Modal } from '../components/ui';
import { SeletorPeriodo, periodoDe, nomePeriodo, type Periodo as PeriodoSel } from '../components/SeletorPeriodo';
import { TopoRelatorio } from '../components/LogoEmpresa';

// ---------- Catálogo ----------

type Segmento = 'servico' | 'produto';
export const RELATORIOS: { id: string; nome: string; descricao: string; grupo: string; segmento?: Segmento }[] = [
  { id: 'dashboard', nome: 'Dashboard', descricao: 'Serviço: novos clientes, churn, LTV, ticket médio e ARPU. Produto: faturamento, CMV, markup, ponto de equilíbrio. Nos dois: margens e lucro.', grupo: 'Resultado' },
  { id: 'mensal', nome: 'Relatório semanal', descricao: 'O que foi realizado no período: receitas, despesas, total, receita por cliente e análise de pagamentos.', grupo: 'Resultado' },
  { id: 'forecast', nome: 'Forecast', descricao: 'Investimento e ROAS, vendas, retenção e churn, receita, custos fixos e variáveis, lucro e caixa: realizado e projeção.', grupo: 'Resultado' },
  { id: 'dre', nome: 'DRE gerencial', descricao: 'Receita, custos, despesas e resultado (lucro ou prejuízo) mês a mês.', grupo: 'Resultado' },
  { id: 'recebimentos', nome: 'Análise de recebimentos', descricao: 'Recebimentos por categoria (ou por cliente) em cada mês, com participação no total.', grupo: 'Análise financeira' },
  { id: 'pagamentos', nome: 'Análise de pagamentos', descricao: 'Pagamentos por categoria (ou por fornecedor) em cada mês, com participação no total.', grupo: 'Análise financeira' },
  { id: 'tipos', nome: 'Receita por tipo', descricao: 'Nova venda, recorrente e avulsa: quanto entrou de cada tipo e quem são os clientes, mês a mês.', grupo: 'Análise financeira' },
  { id: 'ltv', nome: 'LTV por cliente', descricao: 'Quanto cada cliente já pagou desde o começo, há quanto tempo é cliente e se continua ativo.', grupo: 'Análise financeira' },
  { id: 'centros', nome: 'Centro de custo', descricao: 'Despesas (ou receitas) por centro de custo em cada mês, com participação no total.', grupo: 'Análise financeira' },
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
  { id: 'mes', nome: 'Este mês', calc: () => ({ de: inicioMes(hoje()), ate: fimMes(hoje()) }) },
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
  <td className={'r num ' + (v < 0 ? 'saida' : '') + (v === 0 ? ' muted' : '')} style={forte ? { fontWeight: 650 } : undefined} data-soma={v} data-formato="moeda">{v === 0 ? '–' : num(v)}</td>
);
const Pct = ({ v }: { v: number | null }) => <td className="r num muted small" data-soma={v ?? undefined} data-formato="pct">{v === null ? '' : `${v.toLocaleString('pt-BR')}%`}</td>;

function Cabecalho({ titulo, descricao }: { titulo: string; descricao: string }) {
  return <TopoRelatorio titulo={titulo} descricao={descricao} />;
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

// ---------- Análises (recebimentos / pagamentos / por cliente / por fornecedor) ----------

interface LancamentoAnalise { id: number; data: string; descricao: string; contato: string | null; categoria: string | null; conta: string | null; valor: number; juros: number; multa: number; desconto: number }

/** Lista dos lançamentos por trás de uma linha da análise (e, se escolhido, de um mês). */
function DetalheAnalise({ filtro, titulo, onClose }: { filtro: { tipo: TipoLancamento; agrupar: string; nome: string; mes?: string; de: string; ate: string; regime: Regime; tipo_receita?: string }; titulo?: string; onClose: () => void }) {
  const { base } = useEmpresa();
  const { data, erro } = useApi<LancamentoAnalise[]>(`${base}/relatorios/analise/lancamentos${qs(filtro)}`);
  const total = data?.reduce((s, l) => s + l.valor, 0) ?? 0;
  const outraColuna = filtro.agrupar === 'categoria' ? (filtro.tipo === 'receber' ? 'Cliente' : 'Fornecedor') : 'Categoria';
  return (
    <Modal titulo={`${titulo ?? filtro.nome}${filtro.mes ? ` · ${mesCurto(filtro.mes + '-01')}` : ''}`} onClose={onClose} largura={860}
      rodape={<button className="btn" onClick={onClose}>Fechar</button>}>
      <div className="muted small">
        {filtro.tipo === 'receber' ? 'Recebimentos' : 'Pagamentos'} {filtro.regime === 'caixa' ? 'pela data do pagamento' : 'pela data de vencimento'}
        {!filtro.mes && <> de {dataBR(filtro.de)} a {dataBR(filtro.ate)}</>}
        {data && <> · {data.length} lançamento(s) · total <b className="num">{brl(total)}</b></>}
      </div>
      {erro && <div className="erro-box">{erro}</div>}
      {data && (
        <div className="table-wrap" style={{ maxHeight: 440 }}>
          <table>
            <thead>
              <tr><th>Data</th><th>Descrição</th><th>{outraColuna}</th><th>Conta</th><th className="r">Valor</th></tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id}>
                  <td className="num muted">{dataBR(l.data)}</td>
                  <td>{l.descricao}{(l.juros > 0 || l.multa > 0 || l.desconto > 0) && <div className="small muted">{[l.juros > 0 && `juros ${brl(l.juros)}`, l.multa > 0 && `multa ${brl(l.multa)}`, l.desconto > 0 && `desconto ${brl(l.desconto)}`].filter(Boolean).join(' · ')}</div>}</td>
                  <td>{(filtro.agrupar === 'categoria' ? l.contato : l.categoria) ?? '—'}</td>
                  <td className="muted">{l.conta ?? '—'}</td>
                  <td className="r num">{brl(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export function Analise({ tipo: tipoInicial, agruparInicial, fixo, alternarTipo, titulo, descricao }: {
  tipo: TipoLancamento; agruparInicial: AgruparAnalise; fixo?: boolean; alternarTipo?: boolean; titulo: string; descricao: string;
}) {
  const { base, versao, empresa } = useEmpresa();
  const [periodo, setPeriodo] = useState(ultimos12);
  const [regime, setRegime] = useState<Regime>('caixa');
  const [agrupar, setAgrupar] = useState(agruparInicial);
  const [tipo, setTipo] = useState(tipoInicial);
  const { data, erro } = useApi<RelatorioAnalise>(`${base}/relatorios/analise${qs({ tipo, agrupar, de: periodo.de, ate: periodo.ate, regime, v: versao })}`);
  const nomeContato = tipo === 'receber' ? 'Cliente' : 'Fornecedor';
  const cor = tipo === 'receber' ? 'var(--serie-entrada)' : 'var(--serie-saida)';
  const rotulo = agrupar === 'categoria' ? 'Categoria' : agrupar === 'centro' ? 'Centro de custo' : nomeContato;
  const top = data?.itens.slice(0, 10) ?? [];
  const [detalhe, setDetalhe] = useState<{ nome: string; mes?: string } | null>(null);
  const exportar = () => data && exportarCSV(`${titulo} ${empresa?.nome} ${data.de} a ${data.ate}`, [rotulo, ...data.meses.map((m) => mesCurto(m + '-01')), 'Total', 'AV%'],
    [...data.itens.map((i) => [i.nome, ...data.meses.map((m) => i.valores[m]), i.total, pctCSV(i.av)]), ['Total', ...data.meses.map((m) => data.totais[m]), data.total, '100%']]);

  return (
    <>
      <Cabecalho titulo={titulo} descricao={descricao} />
      <div className="card">
        <BarraFiltros periodo={periodo} setPeriodo={setPeriodo} regime={regime} setRegime={setRegime} onExportar={exportar}
          extra={alternarTipo ? (
            <div className="tabs">
              <button className={'tab' + (tipo === 'pagar' ? ' ativo' : '')} onClick={() => setTipo('pagar')}>Despesas</button>
              <button className={'tab' + (tipo === 'receber' ? ' ativo' : '')} onClick={() => setTipo('receber')}>Receitas</button>
            </div>
          ) : !fixo && (
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
                  <div key={i.nome} className="barra-h clicavel" title={`${i.nome}: ${brl(i.total)} (${i.av.toLocaleString('pt-BR')}%) · clique para ver os lançamentos`} onClick={() => setDetalhe({ nome: i.nome })}>
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
                      <th className="col-fixa">{rotulo}</th>
                      <th className="r">Total</th>
                      <th className="r">AV%</th>
                      {data.meses.map((m) => <th key={m} className="r">{mesCurto(m + '-01')}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.itens.map((i) => (
                      <tr key={i.nome} className="linha-clicavel">
                        <td className="col-fixa"><button className="link-botao" onClick={() => setDetalhe({ nome: i.nome })} title="Ver os lançamentos">{i.nome}</button></td>
                        <Valor v={i.total} forte />
                        <Pct v={i.av} />
                        {data.meses.map((m) => (
                          <td key={m} className={'r num clicavel' + (i.valores[m] === 0 ? ' muted' : '')} data-soma={i.valores[m]} data-formato="moeda"
                            onDoubleClick={() => i.valores[m] !== 0 && setDetalhe({ nome: i.nome, mes: m })} title={i.valores[m] ? 'Clique para somar · clique duas vezes para ver os lançamentos do mês' : undefined}>
                            {i.valores[m] === 0 ? '–' : num(i.valores[m])}
                          </td>
                        ))}
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
      {detalhe && <DetalheAnalise filtro={{ tipo, agrupar, nome: detalhe.nome, mes: detalhe.mes, de: periodo.de, ate: periodo.ate, regime }} onClose={() => setDetalhe(null)} />}
      {data && data.itens.length > 0 && <p className="muted small" style={{ margin: 0 }}>Clique no nome de {agrupar === 'categoria' ? 'uma categoria' : agrupar === 'centro' ? 'um centro de custo' : (tipo === 'receber' ? 'um cliente' : 'um fornecedor')} para ver os lançamentos (no valor de um mês: dois cliques). Um clique nos valores vai somando.</p>}
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

// ---------- Relatório do mês (realizado) ----------

interface RelMensal {
  de: string; ate: string; receitas: number; despesas: number; total: number; n_receitas: number; n_despesas: number;
  clientes: { nome: string; total: number; n: number }[]; pagamentos: { nome: string; total: number; n: number }[];
  referencia: string; caixa: number; contas: { nome: string; saldo: number }[];
  inadimplencia: number; inadimplentes: { nome: string; total: number; n: number; maior_atraso: number }[];
}

/** Tabela com barra e participação no total (receita por cliente / pagamentos por categoria). */
function TabelaParticipacao({ titulo, coluna, itens, total, cor }: { titulo: string; coluna: string; itens: RelMensal['clientes']; total: number; cor: string }) {
  const maior = itens[0]?.total || 1;
  return (
    <div className="card">
      <div className="card-header"><h2>{titulo}</h2><span className="muted small">{itens.length} {itens.length === 1 ? 'item' : 'itens'} · {brl(total)}</span></div>
      {itens.length === 0 ? <div className="vazio">Nada realizado neste período.</div> : (
        <div className="table-wrap">
          <table className="tabela-relatorio">
            <thead><tr><th className="col-fixa">{coluna}</th><th className="r">Lançamentos</th><th className="r">Total</th><th className="r">AV%</th><th style={{ width: '28%' }} /></tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.nome}>
                  <td className="col-fixa">{i.nome}</td>
                  <td className="r num muted">{i.n}</td>
                  <td className="r num" data-soma={i.total} data-formato="moeda"><b>{num(i.total)}</b></td>
                  <td className="r num muted small" data-soma={total ? Math.round((i.total / total) * 10000) / 100 : 0} data-formato="pct">{total ? `${(Math.round((i.total / total) * 1000) / 10).toLocaleString('pt-BR')}%` : ''}</td>
                  <td><span className="barra-h-trilho"><span style={{ width: `${(i.total / maior) * 100}%`, background: cor }} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function RelatorioMensal() {
  const { base, versao, empresa } = useEmpresa();
  const [periodo, setPeriodo] = useState<PeriodoSel>(() => periodoDe('mes'));
  const { data, erro } = useApi<RelMensal>(`${base}/relatorios/mensal${qs({ de: periodo.de, ate: periodo.ate, v: versao })}`);
  const exportar = () => data && exportarCSV(`Relatório semanal ${empresa?.nome} ${data.de} a ${data.ate}`, ['', 'Lançamentos', 'Valor (R$)'], [
    ['Receitas realizadas', data.n_receitas, data.receitas], ['Despesas realizadas', data.n_despesas, data.despesas], ['Total do período', null, data.total], [],
    ['RECEITA POR CLIENTE'], ...data.clientes.map((c) => [c.nome, c.n, c.total]), [],
    ['ANÁLISE DE PAGAMENTOS (por categoria)'], ...data.pagamentos.map((c) => [c.nome, c.n, c.total]), [],
    [`SALDO EM CAIXA em ${dataBR(data.referencia)}`, null, data.caixa], ...data.contas.map((c) => [c.nome, null, c.saldo]), [],
    [`INADIMPLÊNCIA em ${dataBR(data.referencia)} (cobranças vencidas)`, null, data.inadimplencia],
    ...data.inadimplentes.map((c) => [`${c.nome} (maior atraso: ${c.maior_atraso} dias)`, c.n, c.total]),
  ], [`Relatório semanal · ${empresa?.nome ?? ''}`, `Período: ${dataBR(data.de)} a ${dataBR(data.ate)} · o que foi pago e recebido`]);

  // PDF pelo próprio navegador: a janela de impressão já vem pronta (sem menu e botões), é só escolher "Salvar como PDF".
  const baixarPDF = () => {
    const anterior = document.title;
    document.title = `Relatório semanal - ${empresa?.nome ?? ''} - ${nomePeriodo(periodo).replace(/\//g, '-')}`;
    window.print();
    document.title = anterior;
  };

  return (
    <>
      <TopoRelatorio titulo="Relatório semanal" periodo={nomePeriodo(periodo)}
        descricao="O que já foi realizado no período: receitas recebidas, despesas pagas, receita por cliente e para onde foi o dinheiro." />
      <div className="card">
        <div className="toolbar">
          <SeletorPeriodo valor={periodo} onChange={setPeriodo} />
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={baixarPDF} disabled={!data}><Icon name="extrato" /> Baixar PDF</button>
          <button className="btn" onClick={exportar} disabled={!data}><Icon name="upload" /> Exportar planilha</button>
        </div>
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && (
          <div className="cartoes-extrato rel-cartoes ltv-cartoes">
            <div className="cartao-extrato"><span className="kpi-label">Saldo em caixa (R$)</span><span className={'cartao-valor num ' + (data.caixa < 0 ? 'alerta' : '')}>{brl(data.caixa)}</span><span className="small muted">em {dataBR(data.referencia)} · {data.contas.length} conta(s)</span></div>
            <div className="cartao-extrato"><span className="kpi-label">Receitas realizadas (R$)</span><span className="cartao-valor num entrada">{brl(data.receitas)}</span><span className="small muted">{data.n_receitas} recebimento(s)</span></div>
            <div className="cartao-extrato"><span className="kpi-label">Despesas realizadas (R$)</span><span className="cartao-valor num saida">{brl(data.despesas)}</span><span className="small muted">{data.n_despesas} pagamento(s)</span></div>
            <div className="cartao-extrato total"><span className="kpi-label">Total do período (R$)</span><span className={'cartao-valor num ' + (data.total < 0 ? 'alerta' : '')}>{brl(data.total)}</span><span className="small muted">receitas − despesas</span></div>
          </div>
        )}
      </div>
      {data && (
        <>
          <TabelaParticipacao titulo="Receita por cliente" coluna="Cliente" itens={data.clientes} total={data.receitas} cor="var(--serie-entrada)" />
          <TabelaParticipacao titulo="Análise de pagamentos" coluna="Categoria" itens={data.pagamentos} total={data.despesas} cor="var(--serie-saida)" />
          <div className="card">
            <div className="card-header"><h2>Inadimplência</h2><span className="muted small">cobranças vencidas em {dataBR(data.referencia)} · {brl(data.inadimplencia)}</span></div>
            {data.inadimplentes.length === 0 ? <div className="vazio">Nenhuma cobrança vencida. 🎉</div> : (
              <div className="table-wrap">
                <table className="tabela-relatorio">
                  <thead><tr><th className="col-fixa">Cliente</th><th className="r">Cobranças</th><th className="r">Maior atraso</th><th className="r">Valor</th></tr></thead>
                  <tbody>
                    {data.inadimplentes.map((c) => (
                      <tr key={c.nome}>
                        <td className="col-fixa">{c.nome}</td>
                        <td className="r num muted">{c.n}</td>
                        <td className="r num muted">{c.maior_atraso} dia(s)</td>
                        <td className="r num" data-soma={c.total} data-formato="moeda"><b>{num(c.total)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        Conta só o que já foi pago ou recebido, na data do pagamento. Toda despesa entra (inclusive empréstimos e reserva); transferências entre as contas da própria empresa ficam de fora, porque se anulam.
        Saldo em caixa e inadimplência são do fim do período (ou de hoje, se o período ainda não acabou): inadimplência = recebimentos vencidos que ainda não tinham sido pagos nessa data.
      </p>
    </>
  );
}

// ---------- LTV por cliente ----------

interface ClienteLTV { nome: string; desde: string; ultimo: string; meses: number; recebimentos: number; total: number; ticket_mensal: number; ltv_margem: number | null; situacao: 'ativo' | 'perdido'; perdido_desde: string | null }
type OrdemLTV = 'total' | 'ltv_margem' | 'meses' | 'ticket_mensal' | 'desde' | 'nome';

/** Todo o histórico de cada cliente: quanto já pagou (LTV), há quanto tempo é cliente e se ainda está ativo. */
export function LtvClientes() {
  const { base, versao, empresa } = useEmpresa();
  const { data, erro } = useApi<{ hoje: string; margem_contribuicao_pct: number | null; clientes: ClienteLTV[] }>(`${base}/relatorios/ltv?v=${versao}`);
  const [situacao, setSituacao] = useState<'todos' | 'ativo' | 'perdido'>('todos');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<{ col: OrdemLTV; desc: boolean }>({ col: 'total', desc: true });
  const [detalhe, setDetalhe] = useState<ClienteLTV | null>(null);

  const todos = data?.clientes ?? [];
  const termo = busca.trim().toLowerCase();
  const lista = todos
    .filter((c) => (situacao === 'todos' || c.situacao === situacao) && (!termo || c.nome.toLowerCase().includes(termo)))
    .sort((a, b) => {
      const va = a[ordem.col] ?? 0, vb = b[ordem.col] ?? 0;
      const r = typeof va === 'string' ? va.localeCompare(String(vb)) : (va as number) - (vb as number);
      return ordem.desc ? -r : r;
    });
  const n = lista.length;
  const media = (fn: (c: ClienteLTV) => number) => (n ? Math.round(lista.reduce((s, c) => s + fn(c), 0) / n) : 0);
  const ativos = todos.filter((c) => c.situacao === 'ativo').length;

  const Col = ({ col, children, r = true }: { col: OrdemLTV; children: string; r?: boolean }) => (
    <th className={(r ? 'r ' : '') + 'clicavel'} onClick={() => setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : col !== 'nome' && col !== 'desde' }))} title="Ordenar">
      {children}{ordem.col === col ? (ordem.desc ? ' ↓' : ' ↑') : ''}
    </th>
  );
  const exportar = () => exportarCSV(`LTV por cliente ${empresa?.nome}`, ['Cliente', 'Situação', 'Desde', 'Último pagamento', 'Meses pagando', 'Ticket mensal', 'Total recebido (LTV)', 'LTV de margem'],
    lista.map((c) => [c.nome, c.situacao === 'ativo' ? 'Ativo' : `Perdido desde ${mesCurto(c.perdido_desde + '-01')}`, dataBR(c.desde), dataBR(c.ultimo), String(c.meses), c.ticket_mensal, c.total, c.ltv_margem]),
    [`LTV por cliente · ${empresa?.nome ?? ''}`, `Todo o histórico, pelo que foi recebido · margem de contribuição usada: ${pctCSV(data?.margem_contribuicao_pct ?? null)}`]);

  return (
    <>
      <TopoRelatorio titulo="LTV por cliente" descricao="Quanto cada cliente já pagou desde o primeiro recebimento, há quanto tempo é cliente e se continua ativo." />
      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            {([['todos', `Todos (${todos.length})`], ['ativo', `Ativos (${ativos})`], ['perdido', `Perdidos (${todos.length - ativos})`]] as const).map(([v, label]) => (
              <button key={v} className={'tab' + (situacao === v ? ' ativo' : '')} onClick={() => setSituacao(v)}>{label}</button>
            ))}
          </div>
          <input className="input grow" placeholder="Buscar cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button className="btn" onClick={exportar} disabled={!data}><Icon name="upload" /> Exportar planilha</button>
        </div>
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && (
          <div className="cartoes-extrato rel-cartoes ltv-cartoes">
            <div className="cartao-extrato"><span className="kpi-label">LTV médio (R$)</span><span className="cartao-valor num">{brl(media((c) => c.total))}</span><span className="small muted">total recebido por cliente</span></div>
            <div className="cartao-extrato"><span className="kpi-label">LTV de margem médio (R$)</span><span className="cartao-valor num">{data.margem_contribuicao_pct === null ? '—' : brl(media((c) => c.ltv_margem ?? 0))}</span><span className="small muted">com margem de contribuição de {data.margem_contribuicao_pct?.toLocaleString('pt-BR') ?? '—'}%</span></div>
            <div className="cartao-extrato"><span className="kpi-label">Permanência média</span><span className="cartao-valor num">{n ? (lista.reduce((s, c) => s + c.meses, 0) / n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0'} meses</span><span className="small muted">meses em que pagou</span></div>
            <div className="cartao-extrato"><span className="kpi-label">Ticket mensal médio (R$)</span><span className="cartao-valor num">{brl(media((c) => c.ticket_mensal))}</span><span className="small muted">{n} cliente(s) na lista</span></div>
          </div>
        )}
        {data && (
          <div className="table-wrap">
            <table className="tabela-relatorio">
              <thead>
                <tr>
                  <Col col="nome" r={false}>Cliente</Col>
                  <th>Situação</th>
                  <Col col="desde" r={false}>Desde</Col>
                  <th>Último pagamento</th>
                  <Col col="meses">Meses</Col>
                  <Col col="ticket_mensal">Ticket mensal</Col>
                  <Col col="total">Total recebido (LTV)</Col>
                  <Col col="ltv_margem">LTV de margem</Col>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.nome} className="linha-clicavel">
                    <td><button className="link-botao" onClick={() => setDetalhe(c)} title="Ver os recebimentos">{c.nome}</button></td>
                    <td>{c.situacao === 'ativo' ? <span className="badge badge-pago">Ativo</span> : <span className="badge badge-neutro">Perdido desde {mesCurto(c.perdido_desde + '-01')}</span>}</td>
                    <td className="num">{mesCurto(c.desde)}</td>
                    <td className="num muted">{dataBR(c.ultimo)}</td>
                    <td className="r num" data-soma={c.meses} data-formato="numero">{c.meses}</td>
                    <td className="r num" data-soma={c.ticket_mensal} data-formato="moeda">{num(c.ticket_mensal)}</td>
                    <td className="r num" data-soma={c.total} data-formato="moeda"><b>{num(c.total)}</b></td>
                    <td className="r num" data-soma={c.ltv_margem ?? 0} data-formato="moeda">{c.ltv_margem === null ? '—' : num(c.ltv_margem)}</td>
                  </tr>
                ))}
              </tbody>
              {n > 0 && (
                <tfoot>
                  <tr>
                    <td>Total</td><td /><td /><td /><td /><td />
                    <Valor v={lista.reduce((s, c) => s + c.total, 0)} forte />
                    <Valor v={lista.reduce((s, c) => s + (c.ltv_margem ?? 0), 0)} forte />
                  </tr>
                </tfoot>
              )}
            </table>
            {n === 0 && <div className="vazio">Nenhum cliente {termo ? 'com essa busca' : 'nessa situação'}.</div>}
          </div>
        )}
      </div>
      {detalhe && data && (
        <DetalheAnalise filtro={{ tipo: 'receber', agrupar: 'contato', nome: detalhe.nome, de: detalhe.desde, ate: data.hoje, regime: 'caixa' }} onClose={() => setDetalhe(null)} />
      )}
      <p className="muted small" style={{ margin: 0 }}>
        Total recebido = tudo o que o cliente já pagou (menos transferências entre contas). LTV de margem = total × margem de contribuição da empresa.
        Ativo = pagou do mês passado para cá ou tem cobrança em aberto; perdido = desde o mês seguinte ao último pagamento. Clique no nome para ver os recebimentos.
      </p>
    </>
  );
}

// ---------- Receita por tipo ----------

type TipoReceitaRel = 'nova' | 'recorrente' | 'avulsa' | 'sem';
const NOME_TIPO_REL: Record<TipoReceitaRel, string> = { nova: 'Nova venda', recorrente: 'Recorrente', avulsa: 'Avulsa', sem: 'Sem tipo' };
interface LinhaTipo { nome: string; valores: Record<string, number>; total: number; av: number }
interface RelatorioReceitaTipo {
  de: string; ate: string; regime: Regime; meses: string[]; totais: Record<string, number>; total: number;
  tipos: (Omit<LinhaTipo, 'nome'> & { tipo: TipoReceitaRel; clientes: LinhaTipo[] })[];
}

/** Receitas separadas em nova venda, recorrente e avulsa, com os clientes de cada tipo mês a mês. */
export function ReceitaPorTipo() {
  const { base, versao, empresa } = useEmpresa();
  const [periodo, setPeriodo] = useState(ultimos12);
  const [regime, setRegime] = useState<Regime>('caixa');
  const [filtro, setFiltro] = useState<'todos' | TipoReceitaRel>('todos');
  const [fechados, setFechados] = useState<Set<TipoReceitaRel>>(() => new Set(['sem']));
  const [detalhe, setDetalhe] = useState<{ tipo: TipoReceitaRel; nome: string; mes?: string } | null>(null);
  const { data, erro } = useApi<RelatorioReceitaTipo>(`${base}/relatorios/receita-tipo${qs({ de: periodo.de, ate: periodo.ate, regime, v: versao })}`);
  const tipos = (data?.tipos ?? []).filter((t) => (filtro === 'todos' ? t.total !== 0 : t.tipo === filtro));
  const alternar = (t: TipoReceitaRel) => setFechados((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const totalLista = tipos.reduce((s, t) => s + t.total, 0);

  const exportar = () => data && exportarCSV(`Receita por tipo ${empresa?.nome} ${data.de} a ${data.ate}`, ['Tipo', 'Cliente', 'Total', 'AV%', ...data.meses.map((m) => mesCurto(m + '-01'))],
    tipos.flatMap((t) => [
      [NOME_TIPO_REL[t.tipo], `${t.clientes.length} cliente(s)`, t.total, pctCSV(t.av), ...data.meses.map((m) => t.valores[m])],
      ...t.clientes.map((c) => [NOME_TIPO_REL[t.tipo], c.nome, c.total, pctCSV(c.av), ...data.meses.map((m) => c.valores[m])]),
    ]),
    [`Receita por tipo · ${empresa?.nome ?? ''}`, `Período: ${dataBR(data.de)} a ${dataBR(data.ate)} · ${regime === 'caixa' ? 'regime de caixa' : 'competência'}`]);

  return (
    <>
      <Cabecalho titulo="Receita por tipo" descricao="Quanto entrou de nova venda, de recorrente e de avulsa, e quem são os clientes de cada tipo, mês a mês." />
      <div className="card">
        <BarraFiltros periodo={periodo} setPeriodo={setPeriodo} regime={regime} setRegime={setRegime} onExportar={exportar}
          extra={(
            <div className="tabs">
              {(['todos', 'nova', 'recorrente', 'avulsa', 'sem'] as const).map((t) => (
                <button key={t} className={'tab' + (filtro === t ? ' ativo' : '')} onClick={() => setFiltro(t)}>{t === 'todos' ? 'Todos' : NOME_TIPO_REL[t]}</button>
              ))}
            </div>
          )} />
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && (
          <div className="cartoes-extrato rel-cartoes ltv-cartoes">
            {data.tipos.map((t) => (
              <button key={t.tipo} className={'cartao-extrato clicavel' + (filtro === t.tipo ? ' ativo' : '')} onClick={() => setFiltro(filtro === t.tipo ? 'todos' : t.tipo)} title="Clique para ver só este tipo">
                <span className="kpi-label">{NOME_TIPO_REL[t.tipo]}</span>
                <span className="cartao-valor num">{brl(t.total)}</span>
                <span className="small muted">{t.av.toLocaleString('pt-BR')}% · {t.clientes.length} cliente(s)</span>
              </button>
            ))}
          </div>
        )}
        {data && tipos.length > 0 && (
          <div className="table-wrap">
            <table className="tabela-relatorio">
              <thead>
                <tr>
                  <th className="col-fixa">Tipo / cliente</th>
                  <th className="r">Total</th>
                  <th className="r">AV%</th>
                  {data.meses.map((m) => <th key={m} className="r">{mesCurto(m + '-01')}</th>)}
                </tr>
              </thead>
              <tbody>
                {tipos.map((t) => (
                  <Fragment key={t.tipo}>
                    <tr className="linha-grupo">
                      <td className="col-fixa">
                        <button className="btn-texto" onClick={() => alternar(t.tipo)} aria-expanded={!fechados.has(t.tipo)}>
                          <span className={'seta-expandir' + (fechados.has(t.tipo) ? '' : ' aberta')}>▸</span> {NOME_TIPO_REL[t.tipo]} <span className="muted small">({t.clientes.length})</span>
                        </button>
                      </td>
                      <Valor v={t.total} forte />
                      <Pct v={t.av} />
                      {data.meses.map((m) => <Valor key={m} v={t.valores[m]} forte />)}
                    </tr>
                    {!fechados.has(t.tipo) && t.clientes.map((c) => (
                      <tr key={t.tipo + c.nome} className="linha-categoria linha-clicavel">
                        <td className="col-fixa" style={{ paddingLeft: 40 }}>
                          <button className="link-botao" onClick={() => setDetalhe({ tipo: t.tipo, nome: c.nome })} title="Ver os recebimentos">{c.nome}</button>
                        </td>
                        <Valor v={c.total} />
                        <Pct v={c.av} />
                        {data.meses.map((m) => (
                          <td key={m} className={'r num clicavel' + (c.valores[m] === 0 ? ' muted' : '')} data-soma={c.valores[m]} data-formato="moeda"
                            onDoubleClick={() => c.valores[m] !== 0 && setDetalhe({ tipo: t.tipo, nome: c.nome, mes: m })} title={c.valores[m] ? 'Clique para somar · clique duas vezes para ver os recebimentos do mês' : undefined}>
                            {c.valores[m] === 0 ? '–' : num(c.valores[m])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="col-fixa">Total</td>
                  <Valor v={totalLista} forte />
                  <Pct v={data.total ? Math.round((totalLista / data.total) * 10000) / 100 : 0} />
                  {data.meses.map((m) => <Valor key={m} v={tipos.reduce((s, t) => s + t.valores[m], 0)} forte />)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {data && tipos.length === 0 && <div className="vazio">Nenhum recebimento {filtro === 'todos' ? '' : `de ${NOME_TIPO_REL[filtro].toLowerCase()} `}no período.</div>}
      </div>
      {detalhe && (
        <DetalheAnalise filtro={{ tipo: 'receber', agrupar: 'contato', nome: detalhe.nome, mes: detalhe.mes, de: periodo.de, ate: periodo.ate, regime, tipo_receita: detalhe.tipo }}
          titulo={`${detalhe.nome} · ${NOME_TIPO_REL[detalhe.tipo]}`} onClose={() => setDetalhe(null)} />
      )}
      <p className="muted small" style={{ margin: 0 }}>
        O tipo vem de cada recebimento (Nova venda, Recorrente ou Avulsa), o mesmo usado no Forecast e no Dashboard; dá para mudar ao editar o lançamento.
        Sem tipo = entradas que não são venda (aportes, resgates, reembolsos…). Transferências entre contas ficam de fora. Clique no cliente para ver os recebimentos (no valor de um mês: dois cliques).
      </p>
    </>
  );
}
