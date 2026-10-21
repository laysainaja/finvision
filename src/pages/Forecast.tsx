import { Fragment, useState } from 'react';
import { qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { addMeses, fimMes, hoje, inicioMes, mesCurto, num } from '../lib/format';
import { exportarCSV } from '../lib/exportar';
import type { LinhaForecast, RelatorioForecast } from '../types';
import { Icon } from '../components/ui';

type Periodo = { de: string; ate: string };
const PRESETS: { id: string; nome: string; calc: () => Periodo }[] = [
  { id: 'padrao', nome: '5 meses + projeção de 6', calc: () => ({ de: addMeses(inicioMes(hoje()), -5), ate: fimMes(addMeses(hoje(), 6)) }) },
  { id: 'ano', nome: 'Este ano', calc: () => ({ de: hoje().slice(0, 4) + '-01-01', ate: hoje().slice(0, 4) + '-12-31' }) },
  { id: 'proximos', nome: 'Próximos 12 meses', calc: () => ({ de: inicioMes(hoje()), ate: fimMes(addMeses(hoje(), 11)) }) },
  { id: 'ultimos', nome: 'Últimos 12 meses', calc: () => ({ de: addMeses(inicioMes(hoje()), -11), ate: fimMes(hoje()) }) },
];

function formatar(l: LinhaForecast, v: number | null | undefined) {
  if (v === null || v === undefined) return '–';
  if (l.formato === 'moeda') return v === 0 ? '–' : num(v);
  if (l.formato === 'numero') return v === 0 ? '–' : v.toLocaleString('pt-BR');
  if (l.formato === 'pct') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
}
const textoCSV = (l: LinhaForecast, v: number | null | undefined) =>
  v === null || v === undefined ? '' : l.formato === 'moeda' ? (v / 100).toFixed(2).replace('.', ',') : l.formato === 'pct' ? `${String(v).replace('.', ',')}%` : String(v).replace('.', ',');

const STATUS = { realizado: 'Realizado', atual: 'Mês atual', projecao: 'Projeção' } as const;

export function Forecast() {
  const { base, versao, empresa } = useEmpresa();
  const [preset, setPreset] = useState('padrao');
  const [periodo, setPeriodo] = useState<Periodo>(PRESETS[0].calc);
  const { data, erro } = useApi<RelatorioForecast>(`${base}/relatorios/forecast${qs({ de: periodo.de, ate: periodo.ate, v: versao })}`);

  const exportar = () => {
    if (!data) return;
    const linhas: string[][] = [];
    for (const b of data.blocos) {
      linhas.push([b.titulo.toUpperCase()]);
      for (const l of [...b.linhas, ...(b.destaque ? [b.destaque] : [])]) linhas.push([l.nome, ...data.meses.map((m) => textoCSV(l, l.valores[m.mes])), textoCSV(l, l.total)]);
    }
    exportarCSV(`Forecast ${empresa?.nome} ${data.de} a ${data.ate}`, ['', ...data.meses.map((m) => `${mesCurto(m.mes)} (${STATUS[m.status]})`), 'Total'], linhas);
  };

  const classeValor = (l: LinhaForecast, v: number | null | undefined) =>
    'r num ' + ((l.id === 'lucro' || l.id === 'lucro_pct' || l.id === 'caixa') && v !== null && v !== undefined && v < 0 ? 'alerta' : '') + (!v ? ' muted' : '');

  const Linha = ({ l, destaque }: { l: LinhaForecast; destaque?: boolean }) => (
    <tr className={destaque ? 'fc-destaque' : ''}>
      <td className="col-fixa">{l.nome}</td>
      {data!.meses.map((m) => (
        <td key={m.mes} className={classeValor(l, l.valores[m.mes]) + (m.status === 'projecao' ? ' fc-proj' : '')}>{formatar(l, l.valores[m.mes])}</td>
      ))}
      <td className={classeValor(l, l.total) + ' fc-total'}>{l.total === null ? '' : formatar(l, l.total)}</td>
    </tr>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <a href="#/relatorios" className="small muted">← Relatórios</a>
          <h1>Forecast</h1>
          <p>Acompanhamento dos meses que passaram e projeção dos próximos, com base nas contas lançadas (competência).</p>
        </div>
      </div>
      <div className="card">
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
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={exportar}><Icon name="upload" /> Exportar planilha</button>
        </div>
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && data.sem_tipo > 0 && (
          <div className="aviso-box" style={{ margin: '12px 20px 0' }}>
            <Icon name="alerta" /> {data.sem_tipo} recebimento(s) no período estão sem tipo de receita e foram contados como venda avulsa. Ajuste em Contas a receber → Editar → Tipo de receita.
          </div>
        )}
        {data && (
          <div className="table-wrap">
            <table className="tabela-relatorio tabela-forecast">
              <thead>
                <tr>
                  <th className="col-fixa" />
                  {data.meses.map((m) => (
                    <th key={m.mes} className={'r ' + (m.status === 'projecao' ? 'fc-proj' : m.status === 'atual' ? 'fc-atual' : '')}>
                      {mesCurto(m.mes)}
                      <div className="fc-status">{STATUS[m.status]}</div>
                    </th>
                  ))}
                  <th className="r fc-total">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.blocos.map((b) => (
                  <Fragment key={b.id}>
                    <tr className="fc-secao"><td className="col-fixa" colSpan={1}>{b.titulo}</td><td colSpan={data.meses.length + 1} /></tr>
                    {b.linhas.map((l) => <Linha key={l.id} l={l} />)}
                    {b.destaque && <Linha l={b.destaque} destaque />}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="muted small" style={{ display: 'grid', gap: 4 }}>
        <span><b>Vendas</b> = novas vendas (recorrentes = novos contratos) + avulsas. <b>ROAS</b> = receita das novas vendas ÷ (investimento em anúncios + imposto de anúncio).</span>
        <span><b>Clientes totais</b> = clientes com receita recorrente no mês. <b>Churn</b> = clientes recorrentes do mês anterior que não tiveram receita recorrente neste mês; churn financeiro = quanto eles pagavam.</span>
        <span>Os grupos (investimento, imposto de anúncio, variável ou fixo) vêm de cada categoria de despesa: ajuste em Configurações → Empresa, contas e categorias.</span>
      </div>
    </>
  );
}
