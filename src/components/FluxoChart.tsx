import { useEffect, useRef, useState } from 'react';
import type { Agrupamento, PeriodoFluxo } from '../types';
import { brl, brlCompacto, dataBR, diaMes, mesCurto } from '../lib/format';

function useLargura() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Ticks "redondos" (1, 2, 5 × 10ⁿ) cobrindo [min, max]. */
function ticks(min: number, max: number, alvo = 4) {
  if (max === min) max = min + 1;
  const bruto = (max - min) / alvo;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto)!;
  const out = [];
  for (let v = Math.floor(min / passo) * passo; v <= max + passo * 0.001; v += passo) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + passo);
  return out;
}

/** Barra com cantos arredondados só no topo (a base fica reta, presa à linha de zero). */
function barra(x: number, y: number, w: number, h: number, raio: number) {
  if (h <= 0) return '';
  const r = Math.min(raio, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const rotulo = (inicio: string, agrupar: Agrupamento) => (agrupar === 'mes' ? mesCurto(inicio) : diaMes(inicio));

export function FluxoChart({ periodos, agrupar, hoje }: { periodos: PeriodoFluxo[]; agrupar: Agrupamento; hoje: string }) {
  const [ref, largura] = useLargura();
  const [hover, setHover] = useState<number | null>(null);

  const M = { esq: 64, dir: 12 };
  const H1 = 220; // barras de entradas/saídas
  const H2 = 120; // linha de saldo (gráfico separado: escalas diferentes não dividem eixo)
  const GAP = 34;
  const plotW = Math.max(0, largura - M.esq - M.dir);
  const n = periodos.length || 1;
  const banda = plotW / n;
  const bw = Math.max(2, Math.min(18, banda * 0.32));

  const maxBarra = Math.max(1, ...periodos.flatMap((p) => [p.entradas_realizadas + p.entradas_previstas, p.saidas_realizadas + p.saidas_previstas]));
  const tBar = ticks(0, maxBarra);
  const yBar = (v: number) => 12 + (H1 - 12) * (1 - v / tBar[tBar.length - 1]);

  const saldos = periodos.map((p) => p.saldo_final);
  const tSal = ticks(Math.min(0, ...saldos), Math.max(0, ...saldos), 3);
  const y0Sal = H1 + GAP;
  const ySal = (v: number) => y0Sal + 8 + (H2 - 16) * (1 - (v - tSal[0]) / (tSal[tSal.length - 1] - tSal[0]));

  const cx = (i: number) => M.esq + banda * i + banda / 2;
  const passoRotulo = Math.max(1, Math.ceil(46 / banda));
  const idxHoje = periodos.findIndex((p) => p.inicio <= hoje && p.fim >= hoje);
  const total = H1 + GAP + H2 + 26;

  const segmentos = (x: number, real: number, prev: number, cor: string, padrao: string) => {
    const yReal = yBar(real);
    const yTopo = yBar(real + prev);
    const temPrev = prev > 0 && yReal - yTopo >= 1;
    return (
      <>
        {real > 0 && <path d={barra(x, yReal, bw, yBar(0) - yReal, temPrev ? 0 : 4)} fill={cor} />}
        {temPrev && (
          // Previsto: mesma cor com hachura, separado do realizado por 2px de respiro.
          <path d={barra(x, yTopo, bw, yReal - yTopo - (real > 0 ? 2 : 0), 4)} fill={`url(#${padrao})`} stroke={cor} strokeWidth={1} />
        )}
      </>
    );
  };

  const linha = periodos.map((p, i) => `${i ? 'L' : 'M'}${cx(i)},${ySal(p.saldo_final)}`).join('');
  const p = hover !== null ? periodos[hover] : null;

  return (
    <div ref={ref} style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
      <svg width={largura} height={total} role="img" aria-label="Entradas, saídas e saldo por período" style={{ display: 'block' }}>
        <defs>
          {[
            ['hach-entrada', 'var(--serie-entrada)'],
            ['hach-saida', 'var(--serie-saida)'],
          ].map(([id, cor]) => (
            <pattern key={id} id={id} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill="var(--surface)" />
              <line x1="0" y1="0" x2="0" y2="5" stroke={cor} strokeWidth="2.2" />
            </pattern>
          ))}
        </defs>

        {/* Grade e eixo das barras */}
        {tBar.map((t) => (
          <g key={'b' + t}>
            <line x1={M.esq} x2={largura - M.dir} y1={yBar(t)} y2={yBar(t)} stroke={t === 0 ? 'var(--border)' : 'var(--grid)'} />
            <text x={M.esq - 8} y={yBar(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">{brlCompacto(t)}</text>
          </g>
        ))}

        {idxHoje >= 0 && (
          <g>
            <line x1={cx(idxHoje)} x2={cx(idxHoje)} y1={4} y2={y0Sal + H2} stroke="var(--text-3)" strokeDasharray="3 3" />
            <text x={cx(idxHoje) + 4} y={10} fontSize="11" fill="var(--text-2)">hoje</text>
          </g>
        )}

        {periodos.map((p, i) => (
          <g key={p.inicio} opacity={hover === null || hover === i ? 1 : 0.45}>
            {segmentos(cx(i) - bw - 1, p.entradas_realizadas, p.entradas_previstas, 'var(--serie-entrada)', 'hach-entrada')}
            {segmentos(cx(i) + 1, p.saidas_realizadas, p.saidas_previstas, 'var(--serie-saida)', 'hach-saida')}
          </g>
        ))}

        {/* Gráfico de saldo */}
        <text x={M.esq} y={y0Sal - 8} fontSize="12" fontWeight="600" fill="var(--text-2)">Saldo acumulado</text>
        {tSal.map((t) => (
          <g key={'s' + t}>
            <line x1={M.esq} x2={largura - M.dir} y1={ySal(t)} y2={ySal(t)} stroke={t === 0 ? 'var(--text-3)' : 'var(--grid)'} strokeDasharray={t === 0 ? '4 3' : undefined} />
            <text x={M.esq - 8} y={ySal(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">{brlCompacto(t)}</text>
          </g>
        ))}
        <path d={linha} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" />
        {periodos.map((p, i) =>
          p.saldo_final < 0 || hover === i ? (
            <circle key={p.inicio} cx={cx(i)} cy={ySal(p.saldo_final)} r={4} fill={p.saldo_final < 0 ? 'var(--alerta)' : 'var(--text)'} stroke="var(--surface)" strokeWidth={2} />
          ) : null,
        )}

        {/* Rótulos do eixo X */}
        {periodos.map((p, i) =>
          i % passoRotulo === 0 ? (
            <text key={p.inicio} x={cx(i)} y={total - 6} textAnchor="middle" fontSize="11" fill="var(--text-3)">{rotulo(p.inicio, agrupar)}</text>
          ) : null,
        )}

        {/* Áreas de hover: a coluna inteira do período, maior que as marcas */}
        {periodos.map((p, i) => (
          <rect key={p.inicio} x={M.esq + banda * i} y={0} width={banda} height={total} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>

      {p && (
        <div className="chart-tooltip" style={{ left: Math.min(cx(hover!) + 12, largura - 230), top: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {agrupar === 'dia' ? dataBR(p.inicio) : agrupar === 'mes' ? mesCurto(p.inicio) : `${dataBR(p.inicio)} a ${dataBR(p.fim)}`}
          </div>
          <Linha cor="var(--serie-entrada)" label="Entradas realizadas" v={p.entradas_realizadas} />
          <Linha cor="var(--serie-entrada)" label="Entradas previstas" v={p.entradas_previstas} hachura />
          <Linha cor="var(--serie-saida)" label="Saídas realizadas" v={p.saidas_realizadas} />
          <Linha cor="var(--serie-saida)" label="Saídas previstas" v={p.saidas_previstas} hachura />
          <div className="linha" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6, fontWeight: 600 }}>
            <span>Saldo no fim</span>
            <span className={'num ' + (p.saldo_final < 0 ? 'alerta' : '')}>{brl(p.saldo_final)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Linha({ cor, label, v, hachura }: { cor: string; label: string; v: number; hachura?: boolean }) {
  if (!v) return null;
  return (
    <div className="linha">
      <span>
        <Amostra cor={cor} hachura={hachura} />
        {label}
      </span>
      <span className="num">{brl(v)}</span>
    </div>
  );
}

export function Amostra({ cor, hachura }: { cor: string; hachura?: boolean }) {
  return (
    <i
      style={{
        display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 6, verticalAlign: -1,
        background: hachura ? `repeating-linear-gradient(45deg, ${cor} 0 2px, transparent 2px 4px)` : cor,
        border: `1px solid ${cor}`,
      }}
    />
  );
}

export function LegendaFluxo() {
  return (
    <div className="legenda">
      <span><Amostra cor="var(--serie-entrada)" />Entradas realizadas</span>
      <span><Amostra cor="var(--serie-entrada)" hachura />Entradas previstas</span>
      <span><Amostra cor="var(--serie-saida)" />Saídas realizadas</span>
      <span><Amostra cor="var(--serie-saida)" hachura />Saídas previstas</span>
    </div>
  );
}
