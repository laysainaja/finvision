import { createClient, type Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configurado = !!(url && chave);

export const supabase = createClient(url ?? 'http://configure-o-env', chave ?? 'x', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Token atual para o header Authorization (o supabase-js renova sozinho antes de expirar). */
export async function tokenAtual() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

interface AuthCtx {
  session: Session | null;
  /** true quando o usuário chegou pelo link de "esqueci minha senha" e precisa definir uma nova. */
  recuperandoSenha: boolean;
  concluirRecuperacao: () => void;
}
const Ctx = createContext<AuthCtx>({ session: null, recuperandoSenha: false, concluirRecuperacao: () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children, telaLogin }: { children: ReactNode; telaLogin: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recuperandoSenha, setRecuperando] = useState(false);

  useEffect(() => {
    if (!configurado) return setSession(null);
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      setSession(s);
      if (evento === 'PASSWORD_RECOVERY') setRecuperando(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null; // checando sessão salva
  return (
    <Ctx.Provider value={{ session, recuperandoSenha, concluirRecuperacao: () => setRecuperando(false) }}>
      {session && !recuperandoSenha ? children : telaLogin}
    </Ctx.Provider>
  );
}
