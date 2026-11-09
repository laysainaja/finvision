import { useState } from 'react';
import { qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { addMeses, brl, hoje, inicioMes, mesCurto } from '../lib/format';
import { exportarCSV } from '../lib/exportar';
import { Icon } from '../components/ui';
import { TopoRelatorio } from '../components/LogoEmpresa';

interface Comparado { faturamento: number; cmv: number; faturamento_acum: number; cmv_acum: number; markup_acum: number | null }
interface DiaMarkup { dia: number; data: string; faturamento: number; cmv: number; markup: number | null; faturamento_acum: number; cmv_acum: number; markup_acum: number | null; comparado: Comparado | null }
interface Totais { faturamento: number; cmv: number; markup: number | null; retorno: number }
interface RelMarkup { mes: string; comparar: string; ate_dia: number; dias: DiaMarkup[]; total: Totais; total_comparado: Totais }

const fatorTxt = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`);
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaSemana = (iso: string) => SEMANA[new Date(iso + 'T12:00:00').getDay()];
const valor = (c: number) => (c ? brl(c) : '–');

/** Markup dia a dia, com o acumulado comparado aos mesmos dias de outro mês. */
export function MarkupDiario() {
  const { base, versao, empresa } = useEmpresa();
  const meses = Array.from({ length: 24 }, (_, i) => addMeses(inicioMes(hoje()), -i).slice(0, 7));
  const [mes, setMes] = useState(meses[0]);
  const [comparar, setComparar] = useState(meses[1]);
  const { data, erro } = useApi<RelMarkup>(`${base}/relatorios/markup-diario${qs({ mes, comparar, v: versao })}`);
  const nome = (m: string) => mesCurto(m + '-01');
  const t = data?.total, c = data?.total_comparado;
  const dif = t?.markup != null && c?.markup != null ? Math.round((t.markup - c.markup) * 100) / 100 : null;

  const exportar = () => data && exportarCSV(`Markup diário ${empresa?.nome} ${data.mes}`,
    ['Dia', 'Faturamento', 'CMV', 'Markup do dia', 'Faturamento acumulado', 'CMV acumulado', 'Markup acumulado', `Faturamento ${nome(data.comparar)}`, `CMV ${nome(data.comparar)}`, `Markup acumulado ${nome(data.comparar)}`],
    data.dias.map((d) => [String(d.dia), d.faturamento, d.cmv, d.markup === null ? '' : String(d.markup).replace('.', ','), d.faturamento_acum, d.cmv_acum, d.markup_acum === null ? '' : String(d.markup_acum).replace('.', ','),
      d.comparado?.faturamento ?? null, d.comparado?.cmv ?? null, d.comparado?.markup_acum == null ? '' : String(d.comparado.markup_acum).replace('.', ',')]),
    [`Markup diário · ${empresa?.nome ?? ''}`, `${nome(data.mes)} comparado com ${nome(data.comparar)}, até o dia ${data.ate_dia}`]);

  const seletor = (rotulo: string, v: string, set: (m: string) => void) => (
    <label className="kpi-label">{rotulo}
      <select className="select input" value={v} onChange={(e) => set(e.target.value)}>
        {meses.map((m) => <option key={m} value={m}>{nome(m)}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <TopoRelatorio titulo="Markup diário" descricao="Quanto cada real gasto na mercadoria voltou em vendas, dia a dia, comparado com os mesmos dias de outro mês." />
      <div className="card">
        <div className="toolbar">
          {seletor('Mês', mes, setMes)}
          {seletor('Comparar com', comparar, setComparar)}
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={exportar} disabled={!data}><Icon name="upload" /> Exportar planilha</button>
        </div>
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && t && c && (
          <div className="cartoes-extrato rel-cartoes ltv-cartoes">
            <div className="cartao-extrato total"><span className="kpi-label">Markup até o dia {data.ate_dia}</span><span className="cartao-valor num">{fatorTxt(t.markup)}</span><span className="small muted">{nome(data.comparar)} no mesmo dia: {fatorTxt(c.markup)}</span></div>
            <div className="cartao-extrato"><span className="kpi-label">Diferença</span><span className={'cartao-valor num ' + (dif !== null && dif < 0 ? 'alerta' : 'entrada')}>{dif === null ? '–' : `${dif > 0 ? '+' : ''}${fatorTxt(dif)}`}</span><span className="small muted">{dif === null ? 'sem CMV para comparar' : dif >= 0 ? 'retorno maior que o do outro mês' : 'retorno menor que o do outro mês'}</span></div>
            <div className="cartao-extrato"><span className="kpi-label">Faturamento (R$)</span><span className="cartao-valor num">{brl(t.faturamento)}</span><span className="small muted">{nome(data.comparar)}: {brl(c.faturamento)}</span></div>
            <div className="cartao-extrato"><span className="kpi-label">Vendas − CMV (R$)</span><span className="cartao-valor num">{brl(t.retorno)}</span><span className="small muted">{nome(data.comparar)}: {brl(c.retorno)} · CMV {brl(t.cmv)}</span></div>
          </div>
        )}
        {data && (
          <div className="table-wrap">
            <table className="tabela-relatorio">
              <thead>
                <tr>
                  <th className="col-fixa">Dia</th><th className="r">Faturamento</th><th className="r">CMV</th><th className="r">Markup do dia</th><th className="r">Markup acumulado</th>
                  <th className="r">Faturamento {nome(data.comparar)}</th><th className="r">Markup acum. {nome(data.comparar)}</th><th className="r">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {data.dias.map((d) => {
                  const dd = d.markup_acum !== null && d.comparado?.markup_acum != null ? Math.round((d.markup_acum - d.comparado.markup_acum) * 100) / 100 : null;
                  return (
                    <tr key={d.dia}>
                      <td className="col-fixa">{String(d.dia).padStart(2, '0')} <span className="muted small">{diaSemana(d.data)}</span></td>
                      <td className="r num" data-soma={d.faturamento} data-formato="moeda">{valor(d.faturamento)}</td>
                      <td className="r num" data-soma={d.cmv} data-formato="moeda">{valor(d.cmv)}</td>
                      <td className="r num muted">{fatorTxt(d.markup)}</td>
                      <td className="r num"><b>{fatorTxt(d.markup_acum)}</b></td>
                      <td className="r num" data-soma={d.comparado?.faturamento ?? 0} data-formato="moeda">{d.comparado ? valor(d.comparado.faturamento) : '–'}</td>
                      <td className="r num">{fatorTxt(d.comparado?.markup_acum)}</td>
                      <td className={'r num ' + (dd === null ? 'muted' : dd < 0 ? 'alerta' : 'entrada')}>{dd === null ? '–' : `${dd > 0 ? '+' : ''}${fatorTxt(dd)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Markup = faturamento ÷ CMV: 2,50x quer dizer que cada R$ 1,00 gasto em custo voltou como R$ 2,50 em vendas. CMV = categorias de custo pagas no dia (mercadorias, embalagens e motoboys), como no Dashboard.
        Como as compras não acontecem todo dia, o markup de um dia só varia muito: para comparar meses, use o acumulado. As vendas do iFood contam no dia da venda.
      </p>
    </>
  );
}
