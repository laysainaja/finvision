import { Fragment, useState } from 'react';
import { api, qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { addMeses, fimMes, hoje, inicioMes, mesCurto, num } from '../lib/format';
import { exportarCSV } from '../lib/exportar';
import type { LinhaForecast, RelatorioForecast } from '../types';
import { Icon, useAcao } from '../components/ui';

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

// ROAS soma como número comum na barra de soma.
const formatoSoma = (l: LinhaForecast) => (l.formato === 'roas' ? 'numero' : l.formato);

const STATUS = { realizado: 'Realizado', atual: 'Mês atual', projecao: 'Projeção' } as const;

export function Forecast() {
  const { base, versao, empresa } = useEmpresa();
  const [preset, setPreset] = useState('padrao');
  const [periodo, setPeriodo] = useState<Periodo>(PRESETS[0].calc);
  const acao = useAcao();
  const { data, erro, recarregar } = useApi<RelatorioForecast>(`${base}/relatorios/forecast${qs({ de: periodo.de, ate: periodo.ate, v: versao })}`);

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

  // Clientes totais: clique no mês para informar o número à mão (vazio volta ao calculado pelos recebimentos).
  const editar = async (l: LinhaForecast, mes: string) => {
    const calculado = l.calculados?.[mes] ?? 0;
    const resp = prompt(`${l.nome} em ${mesCurto(mes)}.
Calculado pelos recebimentos: ${calculado}. Deixe vazio para voltar ao calculado.`, String(l.valores[mes] ?? ''));
    if (resp === null) return;
    if (await acao(() => api.put(`${base}/relatorios/forecast/ajustes`, { mes, campo: l.id, valor: resp.trim() === '' ? null : Number(resp.trim()) }))) recarregar();
  };

  const Linha = ({ l, destaque }: { l: LinhaForecast; destaque?: boolean }) => (
    <tr className={destaque ? 'fc-destaque' : ''}>
      <td className="col-fixa">{l.nome}</td>
      {data!.meses.map((m) => (
        <td key={m.mes} className={classeValor(l, l.valores[m.mes]) + (m.status === 'projecao' ? ' fc-proj' : '') + (l.editavel ? ' fc-editavel' : '') + (l.ajustados?.includes(m.mes) ? ' fc-ajustado' : '')}
          data-soma={l.valores[m.mes] ?? undefined} data-formato={formatoSoma(l)}
          onDoubleClick={l.editavel ? () => editar(l, m.mes) : undefined} title={l.editavel ? (l.ajustados?.includes(m.mes) ? `Informado à mão (calculado: ${l.calculados?.[m.mes] ?? 0}). Dois cliques para mudar.` : 'Dois cliques para informar à mão') : undefined}>
          {formatar(l, l.valores[m.mes])}
        </td>
      ))}
      <td className={classeValor(l, l.total) + ' fc-total'} data-soma={l.total ?? undefined} data-formato={formatoSoma(l)}>{l.total === null ? '' : formatar(l, l.total)}</td>
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
      {data && data.sem_tipo > 0 && (
        <div className="aviso-box">
          <Icon name="alerta" /> {data.sem_tipo} venda(s) no período estão sem tipo (nova, recorrente ou avulsa) e foram contadas como avulsas. Se alguma for nova venda ou mensalidade, ajuste em Contas a receber → Editar → Tipo de receita.
        </div>
      )}
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
        <span><b>Vendas</b> = novas vendas (só as marcadas como nova venda) + avulsas. <b>ROAS</b> = receita das novas vendas ÷ (investimento em anúncios + imposto de anúncio).</span>
        <span><b>Clientes totais</b> = clientes com receita recorrente no mês; dois cliques no número para informar à mão (ex.: cliente que pagou adiantado). Os informados à mão aparecem sublinhados. <b>Churn</b> = clientes recorrentes do mês anterior que não tiveram receita recorrente neste mês; churn financeiro = quanto eles pagavam.</span>
        <span>Clique nos valores para ir somando (a soma aparece embaixo da tela; Esc limpa).</span>
        <span>Os grupos (investimento, imposto de anúncio, variável ou fixo) vêm de cada categoria de despesa: ajuste em Configurações → Empresa, contas e categorias.</span>
      </div>
    </>
  );
}
