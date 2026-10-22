import { useEffect, useState } from 'react';
import { brl } from '../lib/format';

// Soma ao clicar, como na barra de status do Excel: cada célula com data-soma (valor) e data-formato
// ('moeda' em centavos, 'numero', 'pct') entra ou sai da seleção a cada clique. Esc, "Limpar" ou trocar de tela zera.
type Formato = 'moeda' | 'numero' | 'pct';
interface Resumo { n: number; soma: number; formato: Formato | 'misto' }

const SELETOR = 'td[data-soma]';
const CLASSE = 'somado';

function resumir(): Resumo | null {
  const cels = [...document.querySelectorAll<HTMLElement>(`${SELETOR}.${CLASSE}`)];
  if (!cels.length) return null;
  const formatos = new Set(cels.map((c) => (c.dataset.formato ?? 'moeda') as Formato));
  return { n: cels.length, soma: cels.reduce((s, c) => s + Number(c.dataset.soma || 0), 0), formato: formatos.size > 1 ? 'misto' : [...formatos][0] };
}

function formatar(v: number, f: Formato) {
  if (f === 'moeda') return brl(Math.round(v));
  if (f === 'pct') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

const limpar = () => document.querySelectorAll(`.${CLASSE}`).forEach((c) => c.classList.remove(CLASSE));

export function SomaCelulas() {
  const [resumo, setResumo] = useState<Resumo | null>(null);

  useEffect(() => {
    // Só troca o estado quando o resumo muda (a própria barra também mexe no DOM e dispara o observador).
    const atualizar = () => {
      const novo = resumir();
      setResumo((atual) => (JSON.stringify(atual) === JSON.stringify(novo) ? atual : novo));
    };
    const clique = (e: MouseEvent) => {
      const cel = (e.target as HTMLElement).closest<HTMLElement>(SELETOR);
      if (!cel || (e.target as HTMLElement).closest('button, a, input, select')) return;
      cel.classList.toggle(CLASSE);
      atualizar();
    };
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && (limpar(), atualizar());
    const trocarTela = () => (limpar(), atualizar());
    // Tabela recarregada (outro período/filtro): o valor das células pode ter mudado.
    const observador = new MutationObserver(() => document.querySelector(`.${CLASSE}`) && atualizar());
    observador.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-soma'] });
    document.addEventListener('click', clique);
    document.addEventListener('keydown', tecla);
    window.addEventListener('hashchange', trocarTela);
    return () => {
      document.removeEventListener('click', clique);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('hashchange', trocarTela);
      observador.disconnect();
    };
  }, []);

  if (!resumo) return null;
  return (
    <div className="soma-barra" role="status" aria-live="polite">
      <span>{resumo.n} {resumo.n === 1 ? 'célula' : 'células'}</span>
      {resumo.formato === 'misto' ? (
        <span className="muted">valores de tipos diferentes (R$, nº e %)</span>
      ) : (
        <>
          <span>Soma <b className="num">{formatar(resumo.soma, resumo.formato)}</b></span>
          {resumo.n > 1 && <span className="muted">Média <span className="num">{formatar(resumo.soma / resumo.n, resumo.formato)}</span></span>}
        </>
      )}
      <button className="btn btn-sm" onClick={() => (limpar(), setResumo(null))}>Limpar</button>
    </div>
  );
}
