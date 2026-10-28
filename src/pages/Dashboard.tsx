import { useState } from 'react';
import { qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR, mesCurto } from '../lib/format';
import { exportarCSV, pctCSV } from '../lib/exportar';
import { Icon } from '../components/ui';
import { SeletorPeriodo, periodoDe, nomePeriodo, type Periodo } from '../components/SeletorPeriodo';
import { TopoRelatorio } from '../components/LogoEmpresa';

interface Indicadores {
  receita: number; receita_nova: number; receita_recorrente: number;
  novos_clientes: number; clientes_ativos: number;
  ticket_novos: number | null; ticket_recorrentes: number | null; ticket_total: number | null; arpu: number | null;
  custos_variaveis: number; custos_fixos: number; fora_resultado: number;
  margem_contribuicao: number; margem_contribuicao_pct: number | null;
  resultado: number; margem_lucro_pct: number | null;
  churn_pct: number | null; clientes_perdidos: number; vida_media_meses: number | null; clientes_ltv: number; ltv: number | null; ltv_margem: number | null;
}
interface RespostaDashboard { de: string; ate: string; meses: string[]; total: Indicadores; por_mes: (Indicadores & { mes: string })[] }

type Formato = 'moeda' | 'pct' | 'numero' | 'meses';
const fmt = (v: number | null, f: Formato) =>
  v === null ? '—'
  : f === 'moeda' ? brl(v)
  : f === 'pct' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
  : f === 'meses' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`
  : v.toLocaleString('pt-BR');

// Ordem e explicação de cada indicador (a mesma nos cartões e na tabela mês a mês).
const INDICADORES: { id: keyof Indicadores; nome: string; f: Formato; como: string }[] = [
  { id: 'novos_clientes', nome: 'Novos clientes', f: 'numero', como: 'Clientes com recebimento marcado como “nova venda” no período.' },
  { id: 'ticket_novos', nome: 'Ticket médio – novos', f: 'moeda', como: 'Receita de nova venda ÷ novos clientes (por mês).' },
  { id: 'ticket_recorrentes', nome: 'Ticket médio – recorrentes', f: 'moeda', como: 'Receita recorrente ÷ clientes recorrentes de cada mês.' },
  { id: 'ticket_total', nome: 'Ticket médio – novos + recorrentes', f: 'moeda', como: '(Nova venda + recorrente) ÷ clientes novos e recorrentes de cada mês.' },
  { id: 'arpu', nome: 'ARPU', f: 'moeda', como: 'Receita média por cliente ativo por mês: toda a receita ÷ clientes que pagaram em cada mês.' },
  { id: 'churn_pct', nome: 'Churn mensal', f: 'pct', como: 'Clientes da base recorrente do mês anterior que não pagaram no mês ÷ base do mês anterior (média do período).' },
  { id: 'ltv', nome: 'LTV', f: 'moeda', como: 'Média do que cada cliente ativo no período já pagou desde o primeiro recebimento (até o fim do período). Ativo = comprou no mês ou tem cobrança recorrente em aberto; no trimestre, semestre ou ano, todos os que estiveram ativos.' },
  { id: 'ltv_margem', nome: 'LTV de margem', f: 'moeda', como: 'LTV × margem de contribuição do período.' },
  { id: 'margem_contribuicao_pct', nome: 'Margem de contribuição', f: 'pct', como: '(Receita − custos variáveis − anúncios e impostos sobre anúncios) ÷ receita.' },
  { id: 'margem_lucro_pct', nome: 'Margem de lucro', f: 'pct', como: 'Resultado do mês (como no Forecast: inclui aportes, reserva e empréstimos) ÷ receita.' },
];

function Cartao({ titulo, valor, sub, dica, link }: { titulo: string; valor: string; sub?: string; dica: string; link?: { href: string; texto: string } }) {
  return (
    <div className="card kpi" title={dica}>
      <span className="kpi-label">{titulo}</span>
      <span className="kpi-valor">{valor}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
      {link && <a className="small" href={link.href}>{link.texto}</a>}
    </div>
  );
}

/** Serviço: indicadores de clientes (churn, LTV, ticket). Produto: vendas, CMV, margens e ponto de equilíbrio. */
export function Dashboard() {
  const { empresa } = useEmpresa();
  return empresa?.segmento === 'produto' ? <DashboardProduto /> : <DashboardServico />;
}

function DashboardServico() {
  const { base, versao, empresa } = useEmpresa();
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('mes'));
  const { data, erro } = useApi<RespostaDashboard>(`${base}/relatorios/dashboard${qs({ de: periodo.de, ate: periodo.ate, v: versao })}`);
  const t = data?.total;
  const como = (id: keyof Indicadores) => INDICADORES.find((i) => i.id === id)!.como;

  const exportar = () => {
    if (!data) return;
    const celula = (v: number | null, f: Formato) => (v === null ? '' : f === 'moeda' ? v : f === 'pct' ? pctCSV(v) : String(v).replace('.', ','));
    exportarCSV(`Dashboard ${empresa?.nome} ${data.de} a ${data.ate}`, ['Indicador', 'Período', ...data.meses.map((m) => mesCurto(m + '-01'))],
      [
        ['Receita', data.total.receita, ...data.por_mes.map((m) => m.receita)],
        ...INDICADORES.map((i) => [i.nome, celula(data.total[i.id] as number | null, i.f), ...data.por_mes.map((m) => celula(m[i.id] as number | null, i.f))]),
      ],
      [`Dashboard · ${empresa?.nome ?? ''}`, `Período: ${dataBR(data.de)} a ${dataBR(data.ate)} · pelo que foi recebido e pago`]);
  };

  // PDF pelo próprio navegador, como no Relatório semanal: é só escolher "Salvar como PDF".
  const baixarPDF = () => {
    const anterior = document.title;
    document.title = `Dashboard - ${empresa?.nome ?? ''} - ${nomePeriodo(periodo).replace(/\//g, '-')}`;
    window.print();
    document.title = anterior;
  };

  return (
    <>
      <TopoRelatorio titulo="Dashboard" periodo={nomePeriodo(periodo)}
        descricao="Indicadores de clientes, ticket médio e margens no período, pelo que foi de fato recebido e pago." />
      <div className="card">
        <div className="toolbar">
          <SeletorPeriodo valor={periodo} onChange={setPeriodo} />
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={baixarPDF} disabled={!data}><Icon name="extrato" /> Baixar PDF</button>
          <button className="btn" onClick={exportar} disabled={!data}><Icon name="upload" /> Exportar planilha</button>
        </div>
        {erro && <div className="vazio alerta">{erro}</div>}
      </div>

      {t && (
        <>
          <div className="dash-grupo">
            <h3>Clientes</h3>
            <div className="grid grid-4">
              <Cartao titulo="Novos clientes" valor={fmt(t.novos_clientes, 'numero')} sub={`${t.clientes_ativos} cliente(s) pagaram no período`} dica={como('novos_clientes')} />
              <Cartao titulo="Churn mensal" valor={fmt(t.churn_pct, 'pct')} sub={`${t.clientes_perdidos} cliente(s) saíram da base`} dica={como('churn_pct')} />
              <Cartao titulo="Tempo médio de permanência" valor={fmt(t.vida_media_meses, 'meses')} sub="1 ÷ churn mensal" dica="Quanto tempo, em média, um cliente fica: 1 ÷ churn mensal." />
              <Cartao titulo="LTV" valor={fmt(t.ltv, 'moeda')} sub={`Média de ${t.clientes_ltv} cliente(s) ativo(s) · de margem: ${fmt(t.ltv_margem, 'moeda')}`} dica={como('ltv')}
                link={{ href: '#/relatorios/ltv', texto: 'Ver LTV por cliente →' }} />
            </div>
          </div>

          <div className="dash-grupo">
            <h3>Ticket médio e ARPU</h3>
            <div className="grid grid-4">
              <Cartao titulo="Ticket médio – novos" valor={fmt(t.ticket_novos, 'moeda')} sub={`Nova venda: ${brl(t.receita_nova)}`} dica={como('ticket_novos')} />
              <Cartao titulo="Ticket médio – recorrentes" valor={fmt(t.ticket_recorrentes, 'moeda')} sub={`Recorrente: ${brl(t.receita_recorrente)}`} dica={como('ticket_recorrentes')} />
              <Cartao titulo="Ticket médio – novos + recorrentes" valor={fmt(t.ticket_total, 'moeda')} sub={`Total: ${brl(t.receita_nova + t.receita_recorrente)}`} dica={como('ticket_total')} />
              <Cartao titulo="ARPU" valor={fmt(t.arpu, 'moeda')} sub={`Receita do período: ${brl(t.receita)}`} dica={como('arpu')} />
            </div>
          </div>

          <div className="dash-grupo">
            <h3>Margens</h3>
            <div className="grid grid-2">
              <Cartao titulo="Margem de contribuição" valor={fmt(t.margem_contribuicao_pct, 'pct')}
                sub={`${brl(t.margem_contribuicao)} = receita ${brl(t.receita)} − custos variáveis e anúncios ${brl(t.custos_variaveis)}`} dica={como('margem_contribuicao_pct')} />
              <Cartao titulo="Margem de lucro" valor={fmt(t.margem_lucro_pct, 'pct')}
                sub={`Resultado ${brl(t.resultado)} (custos fixos ${brl(t.custos_fixos)}; aportes, reserva e empréstimos ${brl(t.fora_resultado)})`} dica={como('margem_lucro_pct')} />
            </div>
          </div>

          {data.meses.length > 1 && (
            <div className="card">
              <div className="card-pad"><h3 style={{ margin: 0 }}>Mês a mês</h3></div>
              <div className="table-wrap">
                <table className="tabela-relatorio">
                  <thead>
                    <tr>
                      <th className="col-fixa">Indicador</th>
                      <th className="r">Período</th>
                      {data.meses.map((m) => <th key={m} className="r">{mesCurto(m + '-01')}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="col-fixa">Receita</td>
                      <td className="r num" data-soma={t.receita} data-formato="moeda"><b>{brl(t.receita)}</b></td>
                      {data.por_mes.map((m) => <td key={m.mes} className="r num" data-soma={m.receita} data-formato="moeda">{brl(m.receita)}</td>)}
                    </tr>
                    {INDICADORES.map((i) => (
                      <tr key={i.id} title={i.como}>
                        <td className="col-fixa">{i.nome}</td>
                        <td className="r num"><b>{fmt(t[i.id] as number | null, i.f)}</b></td>
                        {data.por_mes.map((m) => <td key={m.mes} className="r num">{fmt(m[i.id] as number | null, i.f)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <details className="card card-pad dash-como">
            <summary>Como cada indicador é calculado</summary>
            <ul>
              {INDICADORES.map((i) => <li key={i.id}><b>{i.nome}:</b> {i.como}</li>)}
              <li>Tudo pelo que foi de fato recebido e pago no período (data do pagamento). Aportes, reserva e empréstimos não contam como receita; entram só no resultado (margem de lucro), como no Forecast.</li>
              <li>“Nova venda” e “recorrente” vêm do tipo de receita de cada recebimento (o mesmo usado no Forecast).</li>
            </ul>
          </details>
        </>
      )}
    </>
  );
}

// ---------- Dashboard de produto ----------

interface IndicadoresProduto {
  faturamento: number; outras_receitas: number; deducoes: number; cmv: number; custos_variaveis: number; custos_fixos: number; despesas: number;
  receita_liquida: number; cmv_pct: number | null; markup: number | null; lucro_bruto: number; margem_bruta_pct: number | null;
  margem_contribuicao: number; margem_contribuicao_pct: number | null; fixos_pct: number | null; faturamento_mensal: number;
  ponto_equilibrio: number | null; margem_seguranca_pct: number | null; resultado: number; margem_liquida_pct: number | null; retiradas: number;
}
interface RespostaProduto {
  de: string; ate: string; meses: string[];
  total: IndicadoresProduto & { media_dia: number | null; faturamento_anterior: number; variacao_anterior_pct: number | null; faturamento_ano_passado: number; variacao_ano_passado_pct: number | null };
  maiores_despesas: { categoria: string; valor: number; pct_faturamento: number | null; pct_despesas: number | null }[];
  por_mes: (IndicadoresProduto & { mes: string })[];
}

const INDICADORES_PRODUTO: { id: keyof IndicadoresProduto; nome: string; f: Formato | 'x'; como: string }[] = [
  { id: 'faturamento', nome: 'Faturamento', f: 'moeda', como: 'Vendas recebidas no período (categorias de receita de venda).' },
  { id: 'cmv_pct', nome: 'CMV', f: 'pct', como: 'Custo das mercadorias vendidas ÷ faturamento. CMV = categorias classificadas como Custos (compra de mercadorias, embalagens, entregas…).' },
  { id: 'markup', nome: 'Markup', f: 'x', como: 'Faturamento ÷ CMV: quantas vezes o custo da mercadoria volta em venda.' },
  { id: 'margem_bruta_pct', nome: 'Margem bruta', f: 'pct', como: '(Faturamento − impostos e devoluções − CMV) ÷ faturamento.' },
  { id: 'margem_contribuicao_pct', nome: 'Margem de contribuição', f: 'pct', como: '(Faturamento − todos os custos variáveis, inclusive anúncios e taxas) ÷ faturamento: quanto de cada venda sobra para pagar os custos fixos.' },
  { id: 'custos_fixos', nome: 'Custos fixos', f: 'moeda', como: 'Despesas que não variam com as vendas (aluguel, salários, retiradas, energia…).' },
  { id: 'ponto_equilibrio', nome: 'Ponto de equilíbrio (mês)', f: 'moeda', como: 'Custos fixos do mês ÷ margem de contribuição: quanto precisa vender por mês para não ter prejuízo.' },
  { id: 'margem_seguranca_pct', nome: 'Margem de segurança', f: 'pct', como: 'Quanto o faturamento mensal está acima (ou abaixo, se negativo) do ponto de equilíbrio.' },
  { id: 'resultado', nome: 'Lucro', f: 'moeda', como: 'Todas as receitas − todas as despesas (sem aportes, reserva, empréstimos e transferências, como na DRE).' },
  { id: 'margem_liquida_pct', nome: 'Margem de lucro', f: 'pct', como: 'Lucro ÷ faturamento.' },
];
const fmtP = (v: number | null, f: Formato | 'x') => (f === 'x' ? (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`) : fmt(v, f));
const variacao = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, 'pct')}`);

function DashboardProduto() {
  const { base, versao, empresa } = useEmpresa();
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('mes'));
  const { data, erro } = useApi<RespostaProduto>(`${base}/relatorios/dashboard-produto${qs({ de: periodo.de, ate: periodo.ate, v: versao })}`);
  const t = data?.total;
  const como = (id: keyof IndicadoresProduto) => INDICADORES_PRODUTO.find((i) => i.id === id)!.como;

  const exportar = () => {
    if (!data) return;
    const celula = (v: number | null, f: Formato | 'x') => (v === null ? '' : f === 'moeda' ? v : f === 'pct' ? pctCSV(v) : String(v).replace('.', ','));
    exportarCSV(`Dashboard ${empresa?.nome} ${data.de} a ${data.ate}`, ['Indicador', 'Período', ...data.meses.map((m) => mesCurto(m + '-01'))],
      [
        ...INDICADORES_PRODUTO.map((i) => [i.nome, celula(data.total[i.id] as number | null, i.f), ...data.por_mes.map((m) => celula(m[i.id] as number | null, i.f))]),
        [], ['MAIORES DESPESAS', 'Valor', '% do faturamento'], ...data.maiores_despesas.map((d) => [d.categoria, d.valor, pctCSV(d.pct_faturamento)]),
      ],
      [`Dashboard · ${empresa?.nome ?? ''}`, `Período: ${dataBR(data.de)} a ${dataBR(data.ate)} · pelo que foi recebido e pago`]);
  };
  const baixarPDF = () => {
    const anterior = document.title;
    document.title = `Dashboard - ${empresa?.nome ?? ''} - ${nomePeriodo(periodo).replace(/\//g, '-')}`;
    window.print();
    document.title = anterior;
  };

  return (
    <>
      <TopoRelatorio titulo="Dashboard" periodo={nomePeriodo(periodo)}
        descricao="Vendas, custo da mercadoria, margens, ponto de equilíbrio e lucro no período, pelo que foi de fato recebido e pago." />
      <div className="card">
        <div className="toolbar">
          <SeletorPeriodo valor={periodo} onChange={setPeriodo} />
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={baixarPDF} disabled={!data}><Icon name="extrato" /> Baixar PDF</button>
          <button className="btn" onClick={exportar} disabled={!data}><Icon name="upload" /> Exportar planilha</button>
        </div>
        {erro && <div className="vazio alerta">{erro}</div>}
      </div>

      {t && (
        <>
          <div className="dash-grupo">
            <h3>Vendas</h3>
            <div className="grid grid-4">
              <Cartao titulo="Faturamento" valor={brl(t.faturamento)} sub={t.outras_receitas ? `+ ${brl(t.outras_receitas)} de outras receitas` : 'Vendas recebidas no período'} dica={como('faturamento')} />
              <Cartao titulo="Média por dia" valor={fmt(t.media_dia, 'moeda')} sub={data.meses.length > 1 ? `Média por mês: ${brl(t.faturamento_mensal)}` : 'Faturamento ÷ dias do período (até hoje)'} dica="Faturamento ÷ dias corridos do período (até hoje, se o período ainda não acabou)." />
              <Cartao titulo="Contra o período anterior" valor={variacao(t.variacao_anterior_pct)} sub={`Antes: ${brl(t.faturamento_anterior)}`} dica="Variação do faturamento contra o mesmo número de meses imediatamente antes." />
              <Cartao titulo="Contra o ano passado" valor={variacao(t.variacao_ano_passado_pct)} sub={`Mesmo período do ano passado: ${brl(t.faturamento_ano_passado)}`} dica="Variação do faturamento contra os mesmos meses do ano anterior (tira o efeito da sazonalidade)." />
            </div>
          </div>

          <div className="dash-grupo">
            <h3>Custo da mercadoria e margens</h3>
            <div className="grid grid-4">
              <Cartao titulo="CMV" valor={fmt(t.cmv_pct, 'pct')} sub={`${brl(t.cmv)} em custos das mercadorias`} dica={como('cmv_pct')} />
              <Cartao titulo="Markup" valor={fmtP(t.markup, 'x')} sub={t.markup ? `Cada R$ 1,00 de custo vira ${brl(Math.round(t.markup * 100))} de venda` : 'Sem custo de mercadoria no período'} dica={como('markup')} />
              <Cartao titulo="Margem bruta" valor={fmt(t.margem_bruta_pct, 'pct')} sub={`Lucro bruto: ${brl(t.lucro_bruto)}`} dica={como('margem_bruta_pct')} />
              <Cartao titulo="Margem de contribuição" valor={fmt(t.margem_contribuicao_pct, 'pct')} sub={`${brl(t.margem_contribuicao)} depois de ${brl(t.custos_variaveis)} de custos variáveis`} dica={como('margem_contribuicao_pct')} />
            </div>
          </div>

          <div className="dash-grupo">
            <h3>Estrutura e lucro</h3>
            <div className="grid grid-4">
              <Cartao titulo="Custos fixos" valor={brl(t.custos_fixos)} sub={`${fmt(t.fixos_pct, 'pct')} do faturamento`} dica={como('custos_fixos')} />
              <Cartao titulo="Ponto de equilíbrio (mês)" valor={fmt(t.ponto_equilibrio, 'moeda')}
                sub={t.margem_seguranca_pct === null ? 'Sem margem de contribuição para calcular' : `${t.margem_seguranca_pct >= 0 ? 'Vendendo' : 'Faltam'} ${fmt(Math.abs(t.margem_seguranca_pct), 'pct')} ${t.margem_seguranca_pct >= 0 ? 'acima' : 'para chegar'}`}
                dica={como('ponto_equilibrio')} />
              <Cartao titulo="Lucro" valor={brl(t.resultado)} sub={`Margem de lucro: ${fmt(t.margem_liquida_pct, 'pct')}`} dica={como('resultado')} />
              <Cartao titulo="Retiradas e pró-labore" valor={brl(t.retiradas)} sub={t.retiradas ? `${fmt(t.faturamento ? Math.round((t.retiradas / t.faturamento) * 10000) / 100 : null, 'pct')} do faturamento (já descontadas do lucro)` : 'Nenhuma retirada no período'}
                dica="Categorias de retiradas pessoais e pró-labore. Já estão nos custos fixos e no lucro." />
            </div>
          </div>

          {data.maiores_despesas.length > 0 && (
            <div className="card">
              <div className="card-pad"><h3 style={{ margin: 0 }}>Para onde vai o dinheiro</h3></div>
              <div className="table-wrap">
                <table className="tabela-relatorio">
                  <thead><tr><th>Categoria</th><th className="r">Valor</th><th className="r">% do faturamento</th><th style={{ width: '35%' }}>% das despesas</th></tr></thead>
                  <tbody>
                    {data.maiores_despesas.map((d) => (
                      <tr key={d.categoria}>
                        <td>{d.categoria}</td>
                        <td className="r num" data-soma={d.valor} data-formato="moeda">{brl(d.valor)}</td>
                        <td className="r num">{fmt(d.pct_faturamento, 'pct')}</td>
                        <td><div className="barra-pct"><span style={{ width: `${Math.min(100, d.pct_despesas ?? 0)}%` }} /></div> <span className="small muted">{fmt(d.pct_despesas, 'pct')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.meses.length > 1 && (
            <div className="card">
              <div className="card-pad"><h3 style={{ margin: 0 }}>Mês a mês</h3></div>
              <div className="table-wrap">
                <table className="tabela-relatorio">
                  <thead>
                    <tr>
                      <th className="col-fixa">Indicador</th>
                      <th className="r">Período</th>
                      {data.meses.map((m) => <th key={m} className="r">{mesCurto(m + '-01')}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {INDICADORES_PRODUTO.map((i) => (
                      <tr key={i.id} title={i.como}>
                        <td className="col-fixa">{i.nome}</td>
                        <td className="r num"><b>{fmtP(t[i.id] as number | null, i.f)}</b></td>
                        {data.por_mes.map((m) => <td key={m.mes} className="r num">{fmtP(m[i.id] as number | null, i.f)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <details className="card card-pad dash-como">
            <summary>Como cada indicador é calculado</summary>
            <ul>
              {INDICADORES_PRODUTO.map((i) => <li key={i.id}><b>{i.nome}:</b> {i.como}</li>)}
              <li>Tudo pelo que foi de fato recebido e pago no período (data do pagamento). Aportes, reserva, empréstimos e transferências entre contas ficam de fora, como na DRE.</li>
              <li>O que é custo, custo variável ou fixo vem da classificação de cada categoria (Cadastros → Categorias).</li>
            </ul>
          </details>
        </>
      )}
    </>
  );
}
