import { useState } from 'react';
import { qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { addDias, addMeses, brl, dataBR, fimMes, hoje, inicioMes, mesCurto } from '../lib/format';
import type { Agrupamento, Fluxo } from '../types';
import { FluxoChart, LegendaFluxo } from '../components/FluxoChart';
import { Icon } from '../components/ui';

const h = hoje();
const PRESETS = {
  proximos30: { label: 'Próximos 30 dias', de: h, ate: addDias(h, 29), agrupar: 'dia' },
  mes: { label: 'Este mês', de: inicioMes(h), ate: fimMes(h), agrupar: 'dia' },
  trimestre: { label: 'Próximos 3 meses', de: inicioMes(h), ate: fimMes(addMeses(h, 2)), agrupar: 'semana' },
  ano: { label: '6 meses antes e depois', de: inicioMes(addMeses(h, -6)), ate: fimMes(addMeses(h, 5)), agrupar: 'mes' },
} as const satisfies Record<string, { label: string; de: string; ate: string; agrupar: Agrupamento }>;
type Preset = keyof typeof PRESETS;

export function FluxoCaixa() {
  const { base, contas, versao } = useEmpresa();
  const [preset, setPreset] = useState<Preset | null>('ano');
  const [de, setDe] = useState<string>(PRESETS.ano.de);
  const [ate, setAte] = useState<string>(PRESETS.ano.ate);
  const [agrupar, setAgrupar] = useState<Agrupamento>('mes');
  const [conta, setConta] = useState('');

  const { data: f, erro } = useApi<Fluxo>(`${base}/fluxo-caixa${qs({ de, ate, agrupar, conta_id: conta, v: versao })}`);

  const aplicar = (p: Preset) => {
    setPreset(p);
    setDe(PRESETS[p].de);
    setAte(PRESETS[p].ate);
    setAgrupar(PRESETS[p].agrupar);
  };

  const rotuloPeriodo = (inicio: string, fim: string) =>
    agrupar === 'mes' ? mesCurto(inicio) : agrupar === 'dia' ? dataBR(inicio) : `${dataBR(inicio)} – ${dataBR(fim)}`;

  const entradas = f ? f.totais.entradas_realizadas + f.totais.entradas_previstas : 0;
  const saidas = f ? f.totais.saidas_realizadas + f.totais.saidas_previstas : 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Fluxo de caixa</h1>
          <p>Realizado (o que já entrou e saiu) e previsto (contas em aberto pelo vencimento).</p>
        </div>
      </div>

      {/* Alerta curto, logo no topo */}
      {f?.menor_saldo_futuro && f.menor_saldo_futuro.saldo < 0 && (
        <div className="aviso-box alerta-box">
          <Icon name="alerta" />
          <span>
            Atenção: o saldo previsto fica negativo, chegando a <b className="num">{brl(f.menor_saldo_futuro.saldo)}</b> no período de{' '}
            {rotuloPeriodo(f.menor_saldo_futuro.inicio, f.menor_saldo_futuro.inicio)}. Antecipe recebimentos ou renegocie pagamentos.
          </span>
        </div>
      )}

      <div className="card">
        <div className="toolbar" style={{ borderBottom: 0 }}>
          <div className="tabs">
            {(Object.keys(PRESETS) as Preset[]).map((p) => (
              <button key={p} className={'tab' + (preset === p ? ' ativo' : '')} onClick={() => aplicar(p)}>
                {PRESETS[p].label}
              </button>
            ))}
          </div>
          <input className="input" type="date" value={de} onChange={(e) => (setDe(e.target.value), setPreset(null))} aria-label="De" />
          <span className="muted">até</span>
          <input className="input" type="date" value={ate} onChange={(e) => (setAte(e.target.value), setPreset(null))} aria-label="Até" />
          <div className="tabs">
            {(['dia', 'semana', 'mes'] as const).map((a) => (
              <button key={a} className={'tab' + (agrupar === a ? ' ativo' : '')} onClick={() => setAgrupar(a)}>
                {a === 'dia' ? 'Diário' : a === 'semana' ? 'Semanal' : 'Mensal'}
              </button>
            ))}
          </div>
          <select className="select input" value={conta} onChange={(e) => setConta(e.target.value)} aria-label="Conta">
            <option value="">Todas as contas</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>
      </div>

      {erro && <div className="erro-box">{erro}</div>}

      {f && (
        <>
          <div className="grid grid-4">
            <div className="card kpi">
              <div className="kpi-label">Saldo inicial · {dataBR(f.de)}</div>
              <div className="kpi-valor">{brl(f.saldo_inicial)}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Entradas</div>
              <div className="kpi-valor">{brl(entradas)}</div>
              <div className="kpi-sub">
                <span>Realizadas <b className="num">{brl(f.totais.entradas_realizadas)}</b></span>
                <span>Previstas <b className="num">{brl(f.totais.entradas_previstas)}</b></span>
              </div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Saídas</div>
              <div className="kpi-valor">{brl(saidas)}</div>
              <div className="kpi-sub">
                <span>Realizadas <b className="num">{brl(f.totais.saidas_realizadas)}</b></span>
                <span>Previstas <b className="num">{brl(f.totais.saidas_previstas)}</b></span>
              </div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Saldo final previsto · {dataBR(f.ate)}</div>
              <div className={'kpi-valor ' + (f.saldo_final < 0 ? 'alerta' : '')}>{brl(f.saldo_final)}</div>
              <div className="kpi-sub">
                <span>Variação <b className="num">{brl(f.saldo_final - f.saldo_inicial)}</b></span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Entradas e saídas por período</h2>
              <LegendaFluxo />
            </div>
            <div className="card-pad">
              <FluxoChart periodos={f.periodos} agrupar={f.agrupar} hoje={f.hoje} />
            </div>
          </div>

          <div className="grid grid-main">
            <div className="card card-coluna">
              <div className="card-header"><h2>Detalhamento</h2></div>
              <div className="table-wrap preenche">
                <table>
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th className="r">Entradas</th>
                      <th className="r">Saídas</th>
                      <th className="r">Resultado</th>
                      <th className="r">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.periodos.map((p) => {
                      const ent = p.entradas_realizadas + p.entradas_previstas;
                      const sai = p.saidas_realizadas + p.saidas_previstas;
                      const futuro = p.inicio > f.hoje;
                      return (
                        <tr key={p.inicio}>
                          <td>
                            {rotuloPeriodo(p.inicio, p.fim)}
                            {futuro && <span className="badge badge-neutro" style={{ marginLeft: 8 }}>previsto</span>}
                          </td>
                          <td className="r num" data-soma={ent}>{ent ? brl(ent) : '—'}</td>
                          <td className="r num" data-soma={sai}>{sai ? brl(sai) : '—'}</td>
                          <td className={'r num ' + (ent - sai < 0 ? 'saida' : '')} data-soma={ent - sai}>{ent || sai ? brl(ent - sai) : '—'}</td>
                          <td className={'r num ' + (p.saldo_final < 0 ? 'alerta' : '')}><b>{brl(p.saldo_final)}</b></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h2>Por categoria</h2></div>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {(['receber', 'pagar'] as const).map((tipo) => {
                      const linhas = f.por_categoria.filter((c) => c.tipo === tipo);
                      const totalTipo = linhas.reduce((s, c) => s + c.realizado + c.previsto, 0);
                      return [
                        <tr key={tipo}>
                          <th colSpan={2}>{tipo === 'receber' ? 'Entradas' : 'Saídas'}</th>
                          <th className="r">{brl(totalTipo)}</th>
                        </tr>,
                        ...linhas.map((c) => {
                          const v = c.realizado + c.previsto;
                          return (
                            <tr key={tipo + (c.categoria_id ?? 'sem')}>
                              <td>{c.nome}</td>
                              <td style={{ width: '35%' }}>
                                <div style={{ height: 6, borderRadius: 3, background: 'var(--grid)' }}>
                                  <div
                                    style={{
                                      width: `${totalTipo ? (v / totalTipo) * 100 : 0}%`,
                                      height: '100%',
                                      borderRadius: 3,
                                      background: tipo === 'receber' ? 'var(--serie-entrada)' : 'var(--serie-saida)',
                                    }}
                                  />
                                </div>
                              </td>
                              <td className="r num" data-soma={v}>{brl(v)}</td>
                            </tr>
                          );
                        }),
                      ];
                    })}
                  </tbody>
                </table>
                {f.por_categoria.length === 0 && <div className="vazio">Sem movimentos no período.</div>}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
