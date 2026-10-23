import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

export interface OpcaoFiltro { valor: string; label: string }

/**
 * Filtro por caixas de seleção, como o de categorias: tudo marcado = todos. Desmarque o que não quer ver.
 * `desmarcados` guarda os valores tirados (vazio = não filtra).
 */
export function FiltroChecklist({ opcoes, desmarcados, onChange, rotuloTodos = 'Todos' }: {
  opcoes: OpcaoFiltro[];
  desmarcados: Set<string>;
  onChange: (s: Set<string>) => void;
  rotuloTodos?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAberto(false);
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  const todos = opcoes.map((o) => o.valor);
  const tirados = todos.filter((v) => desmarcados.has(v));
  const marcados = opcoes.filter((o) => !desmarcados.has(o.valor));
  const rotulo = tirados.length === 0 ? rotuloTodos : marcados.length === 0 ? 'Nenhum' : marcados.length === 1 ? marcados[0].label : `${marcados.length} de ${todos.length}`;
  const alternar = (valores: string[], marcar: boolean) => {
    const n = new Set(desmarcados);
    valores.forEach((v) => (marcar ? n.delete(v) : n.add(v)));
    onChange(n);
  };
  const tudoMarcado = tirados.length === 0;

  return (
    <div className="filtro-cat" ref={ref}>
      <button className={'select input filtro-cat-botao' + (tirados.length ? ' ativo' : '')} onClick={() => setAberto((a) => !a)} aria-haspopup="true" aria-expanded={aberto}>
        <span className="filtro-cat-rotulo">{rotulo}</span> <Icon name="seta" />
      </button>
      {aberto && (
        <div className="menu-lista filtro-cat-menu">
          <label className="check filtro-cat-item forte">
            <input type="checkbox" checked={tudoMarcado} ref={(el) => { if (el) el.indeterminate = !tudoMarcado && marcados.length > 0; }} onChange={(e) => alternar(todos, e.target.checked)} />
            {rotuloTodos}
          </label>
          <div className="filtro-cat-grupo">
            {opcoes.map((o) => (
              <label key={o.valor} className="check filtro-cat-item">
                <input type="checkbox" checked={!desmarcados.has(o.valor)} onChange={(e) => alternar([o.valor], e.target.checked)} />
                {o.label}
              </label>
            ))}
            {opcoes.length === 0 && <div className="muted small">Nenhuma opção ainda.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Valores marcados para mandar ao servidor ('' = sem filtro; todos desmarcados = nada aparece). */
export function marcadosParam(opcoes: OpcaoFiltro[], desmarcados: Set<string>) {
  if (!opcoes.some((o) => desmarcados.has(o.valor))) return '';
  const marcados = opcoes.filter((o) => !desmarcados.has(o.valor)).map((o) => encodeURIComponent(o.valor));
  return marcados.length ? marcados.join(',') : '__nenhum';
}
