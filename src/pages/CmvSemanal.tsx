import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR } from '../lib/format';
import { exportarCSV } from '../lib/exportar';
import { lerCmvDoArquivo, type SemanaCmv } from '../lib/planilhaCmv';
import { Icon, Modal, useAcao, useToast } from '../components/ui';
import { TopoRelatorio } from '../components/LogoEmpresa';

interface ItemSemana { id: number; unidade: string | null; item: string; valor_unit: number | null; est_ini_valor: number; compras: number; est_fin_valor: number; cmv: number; participacao: number | null }
interface Alerta { tipo: 'preco' | 'contagem' | 'parado' | 'sem_preco' | 'compras'; nivel: 'alto' | 'info'; item: string | null; texto: string }
interface Semana {
  id: number; inicio: string; fim: string; meta_pct: number; estoque_inicial: number; compras: number; estoque_final: number; cmv: number;
  faturamento: number; faturamento_origem: 'planilha' | 'finvision'; faturamento_finvision: number; dias_faturamento: number | null; dias_semana: number;
  compras_lancadas: number; cmv_pct: number | null; markup: number | null; itens: ItemSemana[]; alertas: Alerta[];
}
interface RelCmv { semanas: Semana[]; meta_padrao: number }

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`);
const periodo = (s: { inicio: string; fim: string }) => `${dataBR(s.inicio).slice(0, 5)} a ${dataBR(s.fim).slice(0, 5)}`;
const NOME_ALERTA: Record<Alerta['tipo'], string> = { preco: 'Preço', contagem: 'Contagem', parado: 'Estoque parado', sem_preco: 'Sem preço', compras: 'Compras' };

/** CMV semanal (produto): o que a loja anota na aba de CMV, cruzado com o faturamento e as compras do FinVision. */
export function CmvSemanal() {
  const { base, versao, empresa } = useEmpresa();
  const acao = useAcao();
  const { data, erro, recarregar } = useApi<RelCmv>(`${base}/relatorios/cmv-semanal?v=${versao}`);
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const [meta, setMeta] = useState('');
  const [previa, setPrevia] = useState<SemanaCmv[] | null>(null);
  const semanas = data?.semanas ?? [];
  const s = semanas.find((x) => x.id === escolhida) ?? semanas[semanas.length - 1];
  const idx = s ? semanas.indexOf(s) : -1;
  const anterior = idx > 0 ? semanas[idx - 1] : null;

  useEffect(() => { if (s) setMeta(String(s.meta_pct).replace('.', ',')); }, [s?.meta_pct]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvarMeta = async () => {
    const v = Number(meta.replace(',', '.'));
    if (s && v === s.meta_pct) return;
    if (await acao(() => api.put(`${base}/cmv/meta`, { meta_pct: v }), 'Meta de CMV salva.')) recarregar();
  };
  const excluirSemana = async (x: Semana) => {
    if (!confirm(`Excluir a semana de ${periodo(x)} do relatório de CMV? Os lançamentos não mudam.`)) return;
    if (await acao(() => api.del(`${base}/cmv/semanas/${x.id}`), 'Semana excluída.')) { setEscolhida(null); recarregar(); }
  };
  const exportar = () => s && exportarCSV(`CMV semanal ${empresa?.nome} ${s.inicio}`,
    ['Insumo', 'Unidade', 'Preço', 'Estoque inicial', 'Compras', 'Estoque final', 'CMV', '% do CMV'],
    s.itens.map((i) => [i.item, i.unidade ?? '', i.valor_unit, i.est_ini_valor, i.compras, i.est_fin_valor, i.cmv, i.participacao === null ? '' : String(i.participacao).replace('.', ',')]),
    [`CMV semanal · ${empresa?.nome ?? ''}`, `Semana de ${periodo(s)} · CMV ${pct(s.cmv_pct)} do faturamento (meta ${pct(s.meta_pct)})`]);

  const acima = s && s.cmv_pct !== null && s.cmv_pct > s.meta_pct;
  const difAnterior = s?.cmv_pct != null && anterior?.cmv_pct != null ? Math.round((s.cmv_pct - anterior.cmv_pct) * 100) / 100 : null;
  const top = s ? s.itens.filter((i) => i.cmv > 0).slice(0, 10) : [];
  const maiorItem = Math.max(1, ...top.map((i) => i.cmv));

  return (
    <>
      <TopoRelatorio titulo="CMV semanal" descricao="Quanto da venda foi para ingredientes e embalagens em cada semana, a partir da aba de CMV da planilha da loja." periodo={s ? `Semana de ${periodo(s)}` : undefined} />
      <div className="card">
        <div className="toolbar">
          {semanas.length > 0 && (
            <label className="kpi-label">Semana
              <select className="select input" value={s?.id ?? ''} onChange={(e) => setEscolhida(Number(e.target.value))}>
                {[...semanas].reverse().map((x) => <option key={x.id} value={x.id}>{periodo(x)}/{x.inicio.slice(0, 4)}</option>)}
              </select>
            </label>
          )}
          {s && (
            <label className="kpi-label">Meta de CMV (%)
              <input className="input num" style={{ width: 80 }} inputMode="decimal" value={meta} onChange={(e) => setMeta(e.target.value)} onBlur={salvarMeta}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            </label>
          )}
          <ImportarCmv onLido={setPrevia} />
          <button className="btn" onClick={exportar} disabled={!s}><Icon name="upload" /> Exportar planilha</button>
        </div>
        {erro && <div className="vazio alerta">{erro}</div>}
        {data && !semanas.length && (
          <div className="vazio">
            Nenhuma semana ainda. Clique em <b>Importar planilha</b> e escolha o arquivo da loja: o FinVision lê a aba de CMV
            (estoque inicial, compras e estoque final de cada insumo) e monta o relatório.
          </div>
        )}
        {s && (
          <>
            <div className="cartoes-extrato rel-cartoes ltv-cartoes">
              <div className="cartao-extrato total">
                <span className="kpi-label">CMV da semana</span>
                <span className={'cartao-valor num ' + (acima ? 'alerta' : 'entrada')}>{pct(s.cmv_pct)}</span>
                <span className="small muted">do faturamento · meta {pct(s.meta_pct)}{s.cmv_pct === null ? ' · sem faturamento lançado' : acima ? ' · acima da meta' : ' · dentro da meta'}</span>
              </div>
              <div className="cartao-extrato"><span className="kpi-label">Custo da mercadoria (R$)</span><span className="cartao-valor num">{brl(s.cmv)}</span><span className="small muted">estoque inicial + compras − estoque final</span></div>
              <div className="cartao-extrato">
                <span className="kpi-label">Faturamento (R$)</span><span className="cartao-valor num">{brl(s.faturamento)}</span>
                <span className="small muted">
                  {s.faturamento_origem === 'planilha'
                    ? `pela planilha da loja${s.dias_faturamento !== null && s.dias_faturamento < s.dias_semana ? ` (${s.dias_faturamento} de ${s.dias_semana} dias)` : ''}`
                    : 'vendas da semana no FinVision'}
                  {s.markup ? ` · markup ${s.markup.toLocaleString('pt-BR')}x` : ''}
                </span>
              </div>
              <div className="cartao-extrato">
                <span className="kpi-label">Contra a semana anterior</span>
                <span className={'cartao-valor num ' + (difAnterior === null ? '' : difAnterior > 0 ? 'alerta' : 'entrada')}>{difAnterior === null ? '–' : `${difAnterior > 0 ? '+' : ''}${difAnterior.toLocaleString('pt-BR')} p.p.`}</span>
                <span className="small muted">{anterior ? `${periodo(anterior)}: ${pct(anterior.cmv_pct)}` : 'primeira semana importada'}</span>
              </div>
            </div>
            <GraficoSemanas semanas={semanas} atual={s.id} onEscolher={setEscolhida} />
            <div className="cmv-colunas">
              <div>
                <h3 className="cmv-titulo">Onde está o custo</h3>
                <table className="tabela-relatorio">
                  <thead><tr><th className="col-fixa">Insumo</th><th className="r">CMV</th><th className="r">% do total</th><th style={{ width: '35%' }} /></tr></thead>
                  <tbody>
                    {top.map((i) => (
                      <tr key={i.id}>
                        <td className="col-fixa">{i.item}{i.valor_unit ? <div className="desc-sub">{brl(i.valor_unit)}{i.unidade ? ` / ${i.unidade}` : ''}</div> : null}</td>
                        <td className="r num" data-soma={i.cmv} data-formato="moeda">{brl(i.cmv)}</td>
                        <td className="r num">{pct(i.participacao)}</td>
                        <td><div className="cmv-barra"><span style={{ width: `${(i.cmv / maiorItem) * 100}%` }} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {top.length > 0 && (
                  <p className="muted small">Os {top.length} maiores somam {pct(Math.round((top.reduce((t, i) => t + i.cmv, 0) / Math.max(1, s.cmv)) * 1000) / 10)} do custo da semana.</p>
                )}
              </div>
              <div>
                <h3 className="cmv-titulo">Alertas{s.alertas.length ? ` (${s.alertas.length})` : ''}</h3>
                {s.alertas.length === 0 && <div className="muted small">Nenhum alerta nesta semana.</div>}
                <div className="lista">
                  {s.alertas.map((a, n) => (
                    <div key={n} className={'cmv-alerta ' + (a.nivel === 'alto' ? 'alto' : '')}>
                      <span className={'badge ' + (a.nivel === 'alto' ? 'badge-aviso' : 'badge-neutro')}>{NOME_ALERTA[a.tipo]}</span>
                      <span>{a.texto}</span>
                    </div>
                  ))}
                </div>
                <h3 className="cmv-titulo">Resumo da semana</h3>
                <table className="tabela-relatorio">
                  <tbody>
                    <tr><td>Estoque inicial</td><td className="r num">{brl(s.estoque_inicial)}</td></tr>
                    <tr><td>+ Compras (planilha)</td><td className="r num">{brl(s.compras)}</td></tr>
                    <tr><td>− Estoque final</td><td className="r num">{brl(s.estoque_final)}</td></tr>
                    <tr><td><b>= CMV</b></td><td className="r num"><b>{brl(s.cmv)}</b></td></tr>
                    <tr><td className="muted">Compras lançadas no FinVision</td><td className="r num muted">{brl(s.compras_lancadas)}</td></tr>
                    {s.faturamento_origem === 'planilha' && (
                      <tr><td className="muted">Faturamento no FinVision (pela data do lançamento)</td><td className="r num muted">{brl(s.faturamento_finvision)}</td></tr>
                    )}
                  </tbody>
                </table>
                <button className="btn btn-sm btn-ghost btn-danger" style={{ marginTop: 8 }} onClick={() => excluirSemana(s)}><Icon name="lixo" /> Excluir esta semana</button>
              </div>
            </div>
          </>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        CMV = estoque inicial + compras − estoque final, somando os insumos da aba de CMV. CMV % = CMV ÷ faturamento da semana: o da aba de entradas
        da planilha (vendas brutas pelo dia da venda) ou, se a planilha não trouxer, o das vendas lançadas no FinVision. Compras lançadas = categorias de custo pagas na semana, sem motoboy. Importar de novo a mesma semana substitui a anterior.
      </p>
      {previa && <PreviaImportacao semanas={previa} onClose={() => setPrevia(null)} onImportado={() => { setPrevia(null); setEscolhida(null); recarregar(); }} />}
    </>
  );
}

/** Gráfico de barras: CMV % de cada semana, com a linha da meta. Clicar numa barra abre a semana. */
function GraficoSemanas({ semanas, atual, onEscolher }: { semanas: Semana[]; atual: number; onEscolher: (id: number) => void }) {
  const W = 720, H = 200, topo = 16, base = 28, esq = 36;
  const maximo = Math.max(50, ...semanas.map((s) => (s.cmv_pct ?? 0) + 5), ...semanas.map((s) => s.meta_pct + 5));
  const y = (v: number) => topo + (H - topo - base) * (1 - v / maximo);
  const largura = Math.min(64, (W - esq) / Math.max(1, semanas.length) - 12);
  const x = (i: number) => esq + ((W - esq) / semanas.length) * (i + 0.5);
  const meta = semanas[semanas.length - 1]?.meta_pct ?? 40;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cmv-grafico" role="img" aria-label="CMV % por semana">
      {[0, 25, 50, 75, 100].filter((v) => v <= maximo).map((v) => (
        <g key={v}><line x1={esq} x2={W} y1={y(v)} y2={y(v)} stroke="var(--grid)" /><text x={esq - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity={0.6}>{v}%</text></g>
      ))}
      {semanas.map((s, i) => {
        const v = s.cmv_pct ?? 0, acima = s.cmv_pct !== null && s.cmv_pct > s.meta_pct;
        return (
          <g key={s.id} onClick={() => onEscolher(s.id)} style={{ cursor: 'pointer' }}>
            <title>{`${periodo(s)}: CMV ${pct(s.cmv_pct)} (meta ${pct(s.meta_pct)})`}</title>
            <rect x={x(i) - largura / 2} y={y(v)} width={largura} height={Math.max(0, y(0) - y(v))} rx={3}
              fill={acima ? 'var(--alerta)' : 'var(--entrada)'} opacity={s.id === atual ? 1 : 0.55} />
            <text x={x(i)} y={y(v) - 4} textAnchor="middle" fontSize="11" fill="currentColor">{s.cmv_pct === null ? '–' : `${Math.round(s.cmv_pct)}%`}</text>
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="currentColor" opacity={0.7}>{dataBR(s.inicio).slice(0, 5)}</text>
          </g>
        );
      })}
      <line x1={esq} x2={W} y1={y(meta)} y2={y(meta)} stroke="var(--aviso)" strokeDasharray="6 4" strokeWidth={2} />
      <text x={W - 4} y={y(meta) - 5} textAnchor="end" fontSize="11" fill="var(--aviso)">meta {pct(meta)}</text>
    </svg>
  );
}

function ImportarCmv({ onLido }: { onLido: (s: SemanaCmv[]) => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const ler = async (f: File | undefined) => {
    if (!f) return;
    try { onLido(await lerCmvDoArquivo(f)); } catch (e) { toast((e as Error).message, true); }
    if (ref.current) ref.current.value = '';
  };
  return (
    <>
      <input ref={ref} type="file" accept=".xlsx" hidden onChange={(e) => ler(e.target.files?.[0])} />
      <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => ref.current?.click()}><Icon name="upload" /> Importar planilha</button>
    </>
  );
}

/** Antes de gravar: mostra as semanas achadas na aba de CMV; a que ainda não foi preenchida vem desmarcada. */
function PreviaImportacao({ semanas, onClose, onImportado }: { semanas: SemanaCmv[]; onClose: () => void; onImportado: () => void }) {
  const { base } = useEmpresa();
  const acao = useAcao();
  const [marcadas, setMarcadas] = useState(new Set(semanas.filter((s) => s.preenchida).map((s) => s.inicio)));
  const importar = async () => {
    const lista = semanas.filter((s) => marcadas.has(s.inicio)).map(({ inicio, fim, itens, faturamento, dias_faturamento }) => ({ inicio, fim, itens, faturamento, dias_faturamento }));
    if (await acao(() => api.post(`${base}/cmv/semanas`, { semanas: lista }), `${lista.length} semana(s) importada(s).`)) onImportado();
  };
  return (
    <Modal titulo="Importar CMV da planilha" onClose={onClose} largura={760}
      rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={importar} disabled={!marcadas.size}>Importar {marcadas.size} semana(s)</button></>}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Confira as semanas achadas na aba de CMV. O faturamento vem da aba de entradas (vendas brutas pelo dia da venda); sem ela, o relatório usa o do FinVision.
        Se a semana já estiver no FinVision, ela é substituída por esta.
      </p>
      <table className="tabela-relatorio">
        <thead><tr><th /><th>Semana</th><th className="r">Insumos</th><th className="r">Estoque inicial</th><th className="r">Compras</th><th className="r">Estoque final</th><th className="r">CMV</th><th className="r">Faturamento</th><th className="r">CMV %</th></tr></thead>
        <tbody>
          {semanas.map((s) => (
            <tr key={s.inicio} className={s.preenchida ? '' : 'muted'}>
              <td><input type="checkbox" checked={marcadas.has(s.inicio)} onChange={() => setMarcadas((m) => { const n = new Set(m); if (n.has(s.inicio)) n.delete(s.inicio); else n.add(s.inicio); return n; })} aria-label={`Importar ${periodo(s)}`} /></td>
              <td>{periodo(s)}/{s.inicio.slice(0, 4)}{!s.preenchida && <div className="desc-sub">ainda não preenchida</div>}</td>
              <td className="r num">{s.itens.length}</td>
              <td className="r num">{brl(s.estoque_inicial)}</td>
              <td className="r num">{brl(s.compras)}</td>
              <td className="r num">{brl(s.estoque_final)}</td>
              <td className="r num"><b>{brl(s.cmv)}</b></td>
              <td className="r num">{s.faturamento === null ? '–' : brl(s.faturamento)}{s.faturamento !== null && s.dias_faturamento < 7 && <div className="desc-sub">{s.dias_faturamento} dia(s)</div>}</td>
              <td className="r num">{s.faturamento ? pct(Math.round((s.cmv / s.faturamento) * 10_000) / 100) : '–'}{s.cmv_pct_planilha !== null && <div className="desc-sub">planilha: {pct(s.cmv_pct_planilha)}</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
