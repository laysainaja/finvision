import { useEffect, useRef, useState } from 'react';
import type { Categoria } from '../types';
import { Icon } from './ui';

/** Id usado para "Sem categoria" na lista de ocultas. */
export const SEM_CATEGORIA = 0;

/**
 * Filtro de categorias por caixas de seleção: tudo marcado = todas. Desmarque as que não quer ver.
 * `ocultas` guarda as desmarcadas (lista vazia = todas aparecem).
 */
export function FiltroCategorias({ categorias, ocultas, onChange }: { categorias: Categoria[]; ocultas: Set<number>; onChange: (s: Set<number>) => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAberto(false);
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  const grupos = [
    { nome: 'Receitas', ids: categorias.filter((c) => c.tipo === 'receita') },
    { nome: 'Despesas', ids: categorias.filter((c) => c.tipo === 'despesa') },
  ];
  const todosIds = [...categorias.map((c) => c.id), SEM_CATEGORIA];
  const visiveis = todosIds.length - ocultas.size;
  const alternar = (ids: number[], mostrar: boolean) => {
    const n = new Set(ocultas);
    ids.forEach((id) => (mostrar ? n.delete(id) : n.add(id)));
    onChange(n);
  };
  const marcado = (ids: number[]) => ids.every((id) => !ocultas.has(id));
  const parcial = (ids: number[]) => !marcado(ids) && ids.some((id) => !ocultas.has(id));
  const rotulo = ocultas.size === 0 ? 'Todas' : visiveis === 0 ? 'Nenhuma' : `${visiveis} de ${todosIds.length}`;

  // Função (não componente) para a caixa não ser recriada a cada clique.
  const caixa = (ids: number[], texto: string, forte = false, key?: number | string) => (
    <label key={key} className={'check filtro-cat-item' + (forte ? ' forte' : '')}>
      <input type="checkbox" checked={marcado(ids)} ref={(el) => { if (el) el.indeterminate = parcial(ids); }} onChange={(e) => alternar(ids, e.target.checked)} />
      {texto}
    </label>
  );

  return (
    <div className="filtro-cat" ref={ref}>
      <button className={'select input filtro-cat-botao' + (ocultas.size ? ' ativo' : '')} onClick={() => setAberto((a) => !a)} aria-haspopup="true" aria-expanded={aberto}>
        {rotulo} <Icon name="seta" />
      </button>
      {aberto && (
        <div className="menu-lista filtro-cat-menu">
          {caixa(todosIds, 'Todas', true)}
          {grupos.map((g) => g.ids.length > 0 && (
            <div key={g.nome} className="filtro-cat-grupo">
              {caixa(g.ids.map((c) => c.id), g.nome, true)}
              {g.ids.map((c) => caixa([c.id], c.nome, false, c.id))}
            </div>
          ))}
          {caixa([SEM_CATEGORIA], 'Sem categoria')}
        </div>
      )}
    </div>
  );
}
