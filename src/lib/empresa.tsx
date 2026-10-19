import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApi } from './api';
import type { Categoria, ContaBancaria, Empresa } from '../types';

interface EmpresaCtx {
  empresas: Empresa[];
  empresa: Empresa | null;
  setEmpresaId: (id: number) => void;
  /** Prefixo das rotas da empresa atual, ex.: /empresas/1 */
  base: string;
  contas: ContaBancaria[];
  categorias: Categoria[];
  /** Recarrega empresas, contas e categorias (após cadastros ou movimentações que mudam saldo). */
  recarregar: () => void;
  /** Muda a cada `recarregar`; páginas usam como dependência para atualizar os próprios dados. */
  versao: number;
}

const Ctx = createContext<EmpresaCtx | null>(null);

export function useEmpresa() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useEmpresa fora do EmpresaProvider');
  return c;
}

const lerSalvo = () => {
  try {
    return Number(localStorage.getItem('empresaId')) || 0;
  } catch {
    return 0;
  }
};

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const [empresaId, setId] = useState(lerSalvo);
  const [versao, setVersao] = useState(0);
  const empresasQ = useApi<Empresa[]>(`/empresas?v=${versao}`);
  const empresas = empresasQ.data ?? [];
  const empresa = empresas.find((e) => e.id === empresaId) ?? empresas[0] ?? null;
  const base = empresa ? `/empresas/${empresa.id}` : '';

  const contasQ = useApi<ContaBancaria[]>(empresa ? `${base}/contas-bancarias?v=${versao}` : null);
  const categoriasQ = useApi<Categoria[]>(empresa ? `${base}/categorias?v=${versao}` : null);

  useEffect(() => {
    if (empresa && empresa.id !== empresaId) setId(empresa.id);
  }, [empresa, empresaId]);

  const valor = useMemo<EmpresaCtx>(
    () => ({
      empresas,
      empresa,
      setEmpresaId: (id) => {
        setId(id);
        try {
          localStorage.setItem('empresaId', String(id));
        } catch {
          /* armazenamento indisponível: só não lembra a escolha */
        }
      },
      base,
      contas: contasQ.data ?? [],
      categorias: categoriasQ.data ?? [],
      recarregar: () => setVersao((v) => v + 1),
      versao,
    }),
    [empresas, empresa, base, contasQ.data, categoriasQ.data, versao],
  );

  if (empresasQ.erro) return <div className="vazio">Não foi possível conectar ao servidor: {empresasQ.erro}</div>;
  if (!empresasQ.data) return null;
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
