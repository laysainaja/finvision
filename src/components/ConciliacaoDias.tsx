import { useState } from 'react';
import { qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl } from '../lib/format';
import { SeletorPeriodo, periodoDe, type Periodo } from './SeletorPeriodo';
import { Icon } from './ui';

interface MovBanco { id: number; data: string; descricao: string | null; valor: number; lancamento_id: number | null; ignorado: number }
interface MovFinVision { id: number; data: string; tipo: 'pagar' | 'receber'; descricao: string; contato: string | null; categoria: string | null; valor: number; transferencia: boolean; conciliado: boolean }
interface Dia { data: string; banco: MovBanco[]; finvision: MovFinVision[]; total_banco: number; total_finvision: number; pendentes: number }

const diaSemana = (iso: string) => {
  const d = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.charAt(0).toUpperCase() + d.slice(1);
};
const dataLonga = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const Valor = ({ v }: { v: number }) => <b className={'num ' + (v > 0 ? 'entrada' : v < 0 ? 'saida' : '')}>{brl(v)}</b>;

/** Aba "Todos" da conciliação: um cartão por dia, comparando o extrato do banco com o que está lançado no FinVision. */
export function ConciliacaoDias({ contaId, contaNome }: { contaId: number; contaNome: string }) {
  const { base, versao } = useEmpresa();
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('mes'));
  const [filtro, setFiltro] = useState<'' | 'ok' | 'pendente'>('');
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const { data, erro } = useApi<Dia[]>(`${base}/extrato/dias${qs({ conta_id: contaId, de: periodo.de, ate: periodo.ate, v: versao })}`);

  const dias = data ?? [];
  const comPendencia = dias.filter((d) => d.pendentes > 0);
  const visiveis = filtro === 'ok' ? dias.filter((d) => !d.pendentes) : filtro === 'pendente' ? comPendencia : dias;
  const alternar = (d: string) => setAbertos((s) => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; });

  const situacao = (d: Dia) => {
    if (!d.banco.length) return { texto: `Só no FinVision (lançado à mão)`, classe: 'muted', valor: d.total_finvision };
    if (d.pendentes) return { texto: `${d.pendentes} pendente(s) de conciliar`, classe: 'aviso', valor: d.total_banco };
    if (d.total_banco === d.total_finvision) return { texto: `FinVision = ${contaNome}`, classe: 'ok', valor: d.total_banco };
    return { texto: `Diferença de ${brl(d.total_finvision - d.total_banco)} (FinVision − banco)`, classe: 'aviso', valor: d.total_banco };
  };

  return (
    <>
      <div className="toolbar">
        <SeletorPeriodo valor={periodo} onChange={setPeriodo} />
        <span className="muted small">Extrato do banco e lançamentos do FinVision pagos nesta conta, dia a dia.</span>
      </div>
      <div className="conc-contadores">
        {(
          [
            ['', 'Tudo', dias.length, ''],
            ['ok', 'Dias sem pendências', dias.length - comPendencia.length, ''],
            ['pendente', 'Dias com pendências', comPendencia.length, 'aviso-num'],
          ] as const
        ).map(([v, label, n, cor]) => (
          <button key={label} className={'conc-contador' + (filtro === v ? ' ativo' : '')} onClick={() => setFiltro(v)}>
            <span>{label}</span>
            <b className={'num ' + cor}>{n}</b>
          </button>
        ))}
      </div>
      {erro && <div className="vazio alerta">{erro}</div>}
      <div className="conc-dias">
        {visiveis.map((d) => {
          const s = situacao(d);
          const aberto = abertos.has(d.data);
          return (
            <div key={d.data} className={'conc-dia' + (aberto ? ' aberto' : '')}>
              <button className="conc-dia-topo" onClick={() => alternar(d.data)} aria-expanded={aberto}>
                <span><b className="num conc-dia-data">{dataLonga(d.data)}</b> <span className="muted">{diaSemana(d.data)}</span></span>
                <span className="conc-dia-resumo">
                  <span className={'small conc-dia-' + s.classe}>{s.texto}</span>
                  <Valor v={s.valor} />
                </span>
                <span className={'conc-dia-seta' + (aberto ? ' aberta' : '')}><Icon name="seta" /></span>
              </button>
              {aberto && (
                <div className="conc-dia-corpo">
                  <div>
                    <h3>Extrato do banco</h3>
                    {d.banco.length === 0 && <div className="muted small">Nenhum movimento importado do banco neste dia.</div>}
                    {d.banco.map((x) => (
                      <div key={x.id} className="conc-dia-mov">
                        <div style={{ minWidth: 0 }}>
                          <div className="desc-principal">{x.descricao || '(sem descrição)'}</div>
                          <span className={'badge ' + (x.lancamento_id ? 'badge-pago' : x.ignorado ? 'badge-neutro' : 'badge-aberto')}>
                            {x.lancamento_id ? 'Conciliado' : x.ignorado ? 'Ignorado' : 'Pendente'}
                          </span>
                        </div>
                        <Valor v={x.valor} />
                      </div>
                    ))}
                    {d.banco.length > 0 && <div className="conc-dia-total"><span>Total do banco</span><Valor v={d.total_banco} /></div>}
                  </div>
                  <div>
                    <h3>Lançado no FinVision</h3>
                    {d.finvision.length === 0 && <div className="muted small">Nada pago ou recebido nesta conta neste dia.</div>}
                    {d.finvision.map((l) => (
                      <div key={l.id} className="conc-dia-mov">
                        <div style={{ minWidth: 0 }}>
                          <div className="desc-principal">{l.descricao}</div>
                          <div className="desc-sub">{[l.transferencia ? 'Transferência' : l.categoria ?? 'Sem categoria', l.contato].filter(Boolean).join(' · ')}</div>
                          <span className={'badge ' + (l.conciliado ? 'badge-pago' : 'badge-neutro')}>{l.conciliado ? 'Conciliado' : 'Lançado à mão'}</span>
                        </div>
                        <Valor v={l.valor} />
                      </div>
                    ))}
                    {d.finvision.length > 0 && <div className="conc-dia-total"><span>Total no FinVision</span><Valor v={d.total_finvision} /></div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {data && visiveis.length === 0 && (
          <div className="vazio">{filtro ? 'Nenhum dia com esse filtro.' : 'Nenhum movimento nesta conta no período.'}</div>
        )}
      </div>
    </>
  );
}
