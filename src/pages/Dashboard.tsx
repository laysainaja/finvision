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

export function Dashboard() {
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
