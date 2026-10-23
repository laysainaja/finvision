import { useEffect, useState, type FormEvent } from 'react';
import { configurado, supabase, useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { conviteSalvo, limparConvite } from '../lib/convite';
import type { InfoConvite } from '../types';
import { Field, Icon } from '../components/ui';

type Modo = 'entrar' | 'cadastrar' | 'esqueci';

// Mensagens do Supabase Auth em português.
function traduzir(msg: string) {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar (veja a caixa de entrada e o spam).';
  if (/already registered/i.test(msg)) return 'Este e-mail já tem conta. Use "Entrar".';
  if (/at least 6 characters|password should be/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  return msg;
}

/** Aviso de convite pendente: mostra a empresa e já preenche o e-mail convidado. */
function useConvitePendente(setEmail: (e: string) => void, setModo: (m: Modo) => void) {
  const [info, setInfo] = useState<InfoConvite | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    const token = conviteSalvo();
    if (!token) return;
    api
      .get<InfoConvite>(`/convites/${token}`)
      .then((i) => {
        setInfo(i);
        if (!i.expirado && !i.aceito) {
          setEmail(i.email);
          // Primeiro acesso pelo convite: já abre em "criar senha"; quem já tem conta só entra.
          setModo(i.tem_conta ? 'entrar' : 'cadastrar');
        }
      })
      .catch((e: Error) => {
        setErro(e.message);
        limparConvite();
      });
  }, [setEmail, setModo]);
  return { info, erro };
}

export function Login() {
  const { recuperandoSenha, concluirRecuperacao } = useAuth();
  const [modo, setModo] = useState<Modo>('entrar');
  const [email, setEmail] = useState('');
  const convite = useConvitePendente(setEmail, setModo);
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  // Convite válido de quem ainda não tem conta: tela de "criar senha", com o e-mail do convite travado.
  const conviteAtivo = !!convite.info && !convite.info.expirado && !convite.info.aceito;
  const primeiroAcesso = conviteAtivo && modo === 'cadastrar';
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      if (recuperandoSenha) {
        const { error } = await supabase.auth.updateUser({ password: senha });
        if (error) throw error;
        concluirRecuperacao();
      } else if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      } else if (modo === 'cadastrar') {
        if (senha !== senha2) throw new Error('As duas senhas não são iguais. Digite de novo.');
        const { data, error } = await supabase.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session)
          setAviso(primeiroAcesso
            ? `Senha criada! Falta só um passo: abra o e-mail que enviamos para ${email} e clique no link de confirmação. Você entra direto em ${convite.info?.empresa_nome}.`
            : 'Conta criada! Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, é só entrar.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
        if (error) throw error;
        setAviso('Se este e-mail tiver conta, você vai receber um link para criar uma nova senha.');
      }
    } catch (err) {
      setErro(traduzir((err as Error).message));
    } finally {
      setEnviando(false);
    }
  };

  const titulo = recuperandoSenha ? 'Crie uma nova senha' : primeiroAcesso ? 'Crie sua senha' : modo === 'entrar' ? 'Entrar' : modo === 'cadastrar' ? 'Criar conta' : 'Recuperar senha';

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ color: 'var(--text)', padding: 0 }}>
          <div className="brand-logo" style={{ color: '#fff' }}>
            <Icon name="fluxo" size={18} />
          </div>
          FinVision
        </div>
        <h1>{titulo}</h1>

        {!configurado && (
          <div className="erro-box">
            Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env (local) ou nas variáveis da Vercel.
          </div>
        )}
        {convite.info && !recuperandoSenha && (
          convite.info.expirado || convite.info.aceito ? (
            <div className="erro-box">
              {convite.info.aceito ? 'Este convite já foi usado.' : 'Este convite expirou.'} Peça um novo link ao dono de {convite.info.empresa_nome}.
            </div>
          ) : (
            <div className="convite-box">
              <b>Você foi convidado(a) para {convite.info.empresa_nome}</b>
              <span>
                {primeiroAcesso
                  ? <>Este é o seu primeiro acesso. Crie uma senha para o e-mail <b>{convite.info.email}</b> e depois confirme no link que vamos enviar para ele.</>
                  : modo === 'entrar'
                    ? <>Você já tem conta com <b>{convite.info.email}</b>. Entre com a sua senha para aceitar{convite.info.papel === 'dono' ? ' como dono(a).' : '.'}</>
                    : <>Use o e-mail <b>{convite.info.email}</b> para aceitar{convite.info.papel === 'dono' ? ' como dono(a).' : '.'}</>}
              </span>
            </div>
          )
        )}
        {convite.erro && <div className="erro-box">{convite.erro}</div>}
        {erro && <div className="erro-box">{erro}</div>}
        {aviso && <div className="aviso-box">{aviso}</div>}

        <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!recuperandoSenha && (
            <Field label="E-mail">
              <input className="input" type="email" required autoComplete="email" autoFocus={!conviteAtivo} readOnly={primeiroAcesso} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          )}
          {modo !== 'esqueci' || recuperandoSenha ? (
            <Field label={recuperandoSenha ? 'Nova senha' : primeiroAcesso ? 'Crie uma senha (mínimo 6 caracteres)' : 'Senha'}>
              <input
                className="input"
                type="password"
                required
                minLength={6}
                autoComplete={modo === 'entrar' && !recuperandoSenha ? 'current-password' : 'new-password'}
                autoFocus={conviteAtivo}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Field>
          ) : null}
          {modo === 'cadastrar' && !recuperandoSenha && (
            <Field label="Repita a senha">
              <input className="input" type="password" required minLength={6} autoComplete="new-password" value={senha2} onChange={(e) => setSenha2(e.target.value)} />
            </Field>
          )}
          <button className="btn btn-primary" type="submit" disabled={enviando || !configurado}>
            {enviando ? 'Aguarde…' : recuperandoSenha ? 'Salvar nova senha' : primeiroAcesso ? 'Criar senha e entrar' : modo === 'entrar' ? 'Entrar' : modo === 'cadastrar' ? 'Criar conta' : 'Enviar link'}
          </button>
        </form>

        {!recuperandoSenha && (
          <div className="login-links">
            {modo !== 'entrar' && <button className="btn btn-ghost btn-sm" onClick={() => setModo('entrar')}>Já tenho conta</button>}
            {modo !== 'cadastrar' && <button className="btn btn-ghost btn-sm" onClick={() => setModo('cadastrar')}>Criar conta</button>}
            {modo !== 'esqueci' && <button className="btn btn-ghost btn-sm" onClick={() => setModo('esqueci')}>Esqueci minha senha</button>}
          </div>
        )}
      </div>
    </div>
  );
}
