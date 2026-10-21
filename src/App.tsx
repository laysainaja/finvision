import { useEffect, useState } from 'react';
import { EmpresaProvider, useEmpresa } from './lib/empresa';
import { AuthProvider, supabase, useAuth } from './lib/auth';
import { Login } from './pages/Login';
import { Icon, ToastProvider, useToast } from './components/ui';
import { api } from './lib/api';
import { conviteSalvo, limparConvite } from './lib/convite';
import { EmpresaModal } from './pages/Cadastros';
import { Painel } from './pages/Painel';
import { Lancamentos } from './pages/Lancamentos';
import { FluxoCaixa } from './pages/FluxoCaixa';
import { Conciliacao } from './pages/Conciliacao';
import { Cadastros } from './pages/Cadastros';
import { Gestao } from './pages/Gestao';
import { Extrato } from './pages/Extrato';
import { NOME_SEGMENTO, type Empresa } from './types';

type ItemMenu = { id: string; label: string; icon: Parameters<typeof Icon>[0]['name'] };
// Menu por seções, no modelo do Conta Azul. Itens exclusivos de cada segmento entram aqui nas próximas etapas.
const MENU: { secao: string | null; itens: ItemMenu[] }[] = [
  { secao: null, itens: [{ id: 'painel', label: 'Início', icon: 'painel' }] },
  {
    secao: 'Financeiro',
    itens: [
      { id: 'extrato', label: 'Extrato de movimentações', icon: 'extrato' },
      { id: 'receber', label: 'Contas a receber', icon: 'receber' },
      { id: 'pagar', label: 'Contas a pagar', icon: 'pagar' },
      { id: 'fluxo', label: 'Fluxo de caixa', icon: 'fluxo' },
      { id: 'conciliacao', label: 'Conciliação bancária', icon: 'banco' },
    ],
  },
  { secao: 'Configurações', itens: [{ id: 'cadastros', label: 'Cadastros', icon: 'config' }] },
];
const ROTAS = [...MENU.flatMap((s) => s.itens.map((i) => i.id)), 'gestao'];
type Rota = string;

/** Gestão aparece para quem é do escritório, para quem ainda não está em nenhum e para donos de empresas avulsas.
 *  O cliente de um escritório (que só acessa a própria empresa por convite) não vê. */
function mostraGestao(empresas: Empresa[]) {
  return empresas.length === 0 || empresas.some((e) => e.via_escritorio || !e.escritorio_id);
}

function useRota(): Rota {
  const ler = () => {
    const r = location.hash.replace('#/', '').split('?')[0];
    return ROTAS.includes(r) ? r : 'painel';
  };
  const [rota, setRota] = useState(ler);
  useEffect(() => {
    const f = () => setRota(ler());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return rota;
}

function Layout() {
  const rota = useRota();
  const { empresas, empresa, setEmpresaId, contas } = useEmpresa();
  const { session } = useAuth();
  const [novaEmpresa, setNovaEmpresa] = useState(false);
  const pendentes = contas.reduce((s, c) => s + c.pendentes_conciliacao, 0);
  const sair = () => supabase.auth.signOut();
  const temGestao = mostraGestao(empresas);

  if (!empresa) {
    if (rota === 'gestao') {
      return (
        <main className="content" style={{ margin: '0 auto' }}>
          <Gestao />
          <div><a href="#/painel" className="btn btn-ghost btn-sm">← Voltar</a></div>
        </main>
      );
    }
    return (
      <div className="vazio" style={{ marginTop: '15vh' }}>
        <h1>Bem-vindo ao FinVision</h1>
        <p>Cadastre a primeira empresa, ou crie um escritório se você gerencia empresas de clientes.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setNovaEmpresa(true)}>
            <Icon name="mais" /> Cadastrar empresa
          </button>
          <a className="btn" href="#/gestao"><Icon name="predio" /> Sou escritório / BPO</a>
          <button className="btn" onClick={sair}>Sair</button>
        </div>
        {novaEmpresa && <EmpresaModal onClose={() => setNovaEmpresa(false)} />}
      </div>
    );
  }

  const doEscritorio = empresas.filter((e) => e.escritorio_id);
  const avulsas = empresas.filter((e) => !e.escritorio_id);

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <Icon name="fluxo" size={18} />
          </div>
          FinVision
        </div>
        {MENU.map((s) => (
          <div key={s.secao ?? 'inicio'} className="nav-secao">
            {s.secao && <div className="nav-titulo">{s.secao}</div>}
            {s.itens.map((r) => (
              <a key={r.id} href={`#/${r.id}`} className={'nav-item' + (rota === r.id ? ' ativo' : '')}>
                <Icon name={r.icon} />
                {r.label}
                {r.id === 'conciliacao' && pendentes > 0 && <span className="nav-badge">{pendentes}</span>}
              </a>
            ))}
          </div>
        ))}
        {temGestao && (
          <div className="nav-secao">
            <div className="nav-titulo">Escritório</div>
            <a href="#/gestao" className={'nav-item' + (rota === 'gestao' ? ' ativo' : '')}>
              <Icon name="predio" /> Gestão
            </a>
          </div>
        )}
        <div className="sidebar-rodape">v0.3</div>
      </nav>
      <div className="main">
        <header className="topbar">
          <select
            className="select input empresa-select"
            value={empresa.id}
            onChange={(e) => (e.target.value === 'nova' ? setNovaEmpresa(true) : setEmpresaId(Number(e.target.value)))}
            aria-label="Empresa"
          >
            {doEscritorio.length > 0 && (
              <optgroup label={`Escritório: ${doEscritorio[0].escritorio_nome ?? ''}`}>
                {doEscritorio.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </optgroup>
            )}
            {avulsas.length > 0 && (
              <optgroup label={doEscritorio.length ? 'Outras empresas' : 'Empresas'}>
                {avulsas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </optgroup>
            )}
            <option value="nova">+ Nova empresa…</option>
          </select>
          <span className={'badge badge-segmento-' + empresa.segmento} title="Segmento da empresa">{NOME_SEGMENTO[empresa.segmento]}</span>
          {empresa.documento && <span className="muted small">{empresa.documento}</span>}
          <span className="muted small" style={{ marginLeft: 'auto' }}>{session?.user.email}</span>
          <button className="btn btn-sm" onClick={sair}>Sair</button>
        </header>
        {/* key: ao trocar de empresa, a página é remontada e os filtros/estado começam do zero */}
        <main className="content" key={empresa.id}>
          {rota === 'painel' && <Painel />}
          {rota === 'extrato' && <Extrato />}
          {rota === 'receber' && <Lancamentos tipo="receber" />}
          {rota === 'pagar' && <Lancamentos tipo="pagar" />}
          {rota === 'fluxo' && <FluxoCaixa />}
          {rota === 'conciliacao' && <Conciliacao />}
          {rota === 'cadastros' && <Cadastros />}
          {rota === 'gestao' && <Gestao />}
        </main>
      </div>
      {novaEmpresa && <EmpresaModal onClose={() => setNovaEmpresa(false)} />}
    </div>
  );
}

// Evita aceitar o mesmo convite duas vezes (o React em modo estrito executa efeitos em dobro).
let conviteEmAndamento: string | null = null;

/** Se a pessoa chegou por um link de convite, aceita assim que estiver logada e abre a empresa. */
function ProcessarConvite() {
  const { setEmpresaId, recarregar } = useEmpresa();
  const toast = useToast();
  useEffect(() => {
    const token = conviteSalvo();
    if (!token || conviteEmAndamento === token) return;
    conviteEmAndamento = token;
    api
      .post<{ empresa_id: number; empresa_nome: string; ja_era_membro: boolean }>(`/convites/${token}/aceitar`)
      .then((r) => {
        limparConvite();
        toast(r.ja_era_membro ? `Você já faz parte de ${r.empresa_nome}.` : `Bem-vindo(a)! Agora você faz parte de ${r.empresa_nome}.`);
        setEmpresaId(r.empresa_id);
        recarregar();
      })
      .catch((e: Error) => {
        // E-mail diferente: mantém o convite para a pessoa sair e entrar com a conta certa.
        if (!/é para .*@/.test(e.message)) limparConvite();
        conviteEmAndamento = null;
        toast(e.message, true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function AppLogado() {
  const { session } = useAuth();
  // key: ao trocar de usuário, todo o estado (empresas, filtros) recomeça do zero.
  return (
    <EmpresaProvider key={session?.user.id}>
      <ProcessarConvite />
      <Layout />
    </EmpresaProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider telaLogin={<Login />}>
        <AppLogado />
      </AuthProvider>
    </ToastProvider>
  );
}
