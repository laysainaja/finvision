import { useEffect, useRef, useState } from 'react';
import { addDias, addMeses, dataBR, fimMes, hoje, inicioMes } from '../lib/format';
import { Icon } from './ui';

export type ModoPeriodo = 'hoje' | 'semana' | 'mes' | 'ano' | 'ult30' | 'ult12' | 'tudo' | 'personalizado';
export interface Periodo { modo: ModoPeriodo; de: string; ate: string }

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const OPCOES: { modo: ModoPeriodo; nome: string }[] = [
  { modo: 'hoje', nome: 'Hoje' }, { modo: 'semana', nome: 'Esta semana' }, { modo: 'mes', nome: 'Este mês' }, { modo: 'ano', nome: 'Este ano' },
  { modo: 'ult30', nome: 'Últimos 30 dias' }, { modo: 'ult12', nome: 'Últimos 12 meses' }, { modo: 'tudo', nome: 'Todo o período' },
];
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);
const inicioSemana = (iso: string) => addDias(iso, -((new Date(iso + 'T12:00:00').getDay() + 6) % 7)); // segunda-feira

/** Período de cada atalho, contado a partir de hoje. */
export function periodoDe(modo: ModoPeriodo, ref = hoje()): Periodo {
  switch (modo) {
    case 'hoje': return { modo, de: ref, ate: ref };
    case 'semana': return { modo, de: inicioSemana(ref), ate: addDias(inicioSemana(ref), 6) };
    case 'ano': return { modo, de: ref.slice(0, 4) + '-01-01', ate: ref.slice(0, 4) + '-12-31' };
    case 'ult30': return { modo, de: addDias(ref, -29), ate: ref };
    case 'ult12': return { modo, de: addMeses(inicioMes(ref), -11), ate: fimMes(ref) };
    case 'tudo': return { modo, de: '2000-01-01', ate: '2099-12-31' };
    default: return { modo: 'mes', de: inicioMes(ref), ate: fimMes(ref) };
  }
}

/** Mesmo tamanho de período, para trás (-1) ou para frente (1). */
function andar(p: Periodo, n: number): Periodo {
  if (p.modo === 'mes') return { ...p, de: addMeses(p.de, n), ate: fimMes(addMeses(p.de, n)) };
  if (p.modo === 'ano' || p.modo === 'ult12') return { ...p, de: addMeses(p.de, n * 12), ate: fimMes(addMeses(p.ate, n * 12)) };
  const dias = diasEntre(p.de, p.ate) + 1;
  return { ...p, de: addDias(p.de, n * dias), ate: addDias(p.ate, n * dias) };
}

export function nomePeriodo(p: Periodo) {
  if (p.modo === 'tudo') return 'Todo o período';
  if (p.modo === 'mes') return `${MESES[Number(p.de.slice(5, 7)) - 1]} de ${p.de.slice(0, 4)}`;
  if (p.de === p.ate) return p.de === hoje() ? `Hoje, ${dataBR(p.de)}` : dataBR(p.de);
  return `${dataBR(p.de)} até ${dataBR(p.ate)}`;
}

/** Seletor de período no estilo do Conta Azul: setas andam o período; o meio abre os atalhos e o personalizado. */
export function SeletorPeriodo({ valor, onChange }: { valor: Periodo; onChange: (p: Periodo) => void }) {
  const [aberto, setAberto] = useState(false);
  const [custom, setCustom] = useState({ de: valor.de, ate: valor.ate });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    setCustom({ de: valor.modo === 'tudo' ? hoje() : valor.de, ate: valor.modo === 'tudo' ? hoje() : valor.ate });
    const fechar = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAberto(false);
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  const escolher = (p: Periodo) => (onChange(p), setAberto(false));
  return (
    <div className="periodo seletor-periodo" ref={ref}>
      <button className="btn btn-ghost btn-sm" onClick={() => onChange(andar(valor, -1))} disabled={valor.modo === 'tudo'} aria-label="Período anterior"><Icon name="esquerda" /></button>
      <button className="periodo-nome periodo-botao" onClick={() => setAberto((a) => !a)} aria-haspopup="menu" aria-expanded={aberto}>
        {nomePeriodo(valor)} <Icon name="seta" />
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => onChange(andar(valor, 1))} disabled={valor.modo === 'tudo'} aria-label="Próximo período"><Icon name="direita" /></button>
      {aberto && (
        <div className="menu-lista periodo-menu" role="menu">
          {OPCOES.map((o) => (
            <button key={o.modo} role="menuitem" className={valor.modo === o.modo ? 'ativo' : ''} onClick={() => escolher(periodoDe(o.modo))}>{o.nome}</button>
          ))}
          <div className="periodo-custom">
            <span className="small muted">Período personalizado</span>
            <input className="input" type="date" value={custom.de} onChange={(e) => setCustom({ ...custom, de: e.target.value })} aria-label="De" />
            <input className="input" type="date" value={custom.ate} onChange={(e) => setCustom({ ...custom, ate: e.target.value })} aria-label="Até" />
            <button className="btn btn-primary btn-sm" disabled={!custom.de || !custom.ate || custom.de > custom.ate}
              onClick={() => escolher({ modo: 'personalizado', de: custom.de, ate: custom.ate })}>Aplicar</button>
          </div>
        </div>
      )}
    </div>
  );
}
