import { useEffect, useState } from 'react';
import { EmpresaProvider, useEmpresa } from './lib/empresa';
import { AuthProvider, supabase, useAuth } from './lib/auth';
import { Login } from './pages/Login';
import { Icon, ToastProvider } from './components/ui';
import { EmpresaModal } from './pages/Cadastros';
import { Painel } from './pages/Painel';
import { Lancamentos } from './pages/Lancamentos';
import { FluxoCaixa } from './pages/FluxoCaixa';
import { Conciliacao } from './pages/Conciliacao';
import { Cadastros } from './pages/Cadastros';

const ROTAS = [
  { id: 'painel', label: 'Painel', icon: 'painel' },
  { id: 'receber', label: 'Contas a receber', icon: 'receber' },
  { id: 'pagar', label: 'Contas a pagar', icon: 'pagar' },
  { id: 'fluxo', label: 'Fluxo de caixa', icon: 'fluxo' },
  { id: 'conciliacao', label: 'Conciliação', icon: 'banco' },
  { id: 'cadastros', label: 'Cadastros', icon: 'config' },
] as const;
type Rota = (typeof ROTAS)[number]['id'];

function useRota(): Rota {
  const ler = () => {
    const r = location.hash.replace('#/', '') as Rota;
    return ROTAS.some((x) => x.id === r) ? r : 'painel';
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

  if (!empresa) {
    return (
      <div className="vazio" style={{ marginTop: '15vh' }}>
        <h1>Bem-vindo ao FinVision</h1>
        <p>Cadastre a primeira empresa para começar.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => setNovaEmpresa(true)}>
            <Icon name="mais" /> Cadastrar empresa
          </button>
          <button className="btn" onClick={sair}>Sair</button>
        </div>
        {novaEmpresa && <EmpresaModal onClose={() => setNovaEmpresa(false)} />}
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <Icon name="fluxo" size={18} />
          </div>
          FinVision
        </div>
        {ROTAS.map((r) => (
          <a key={r.id} href={`#/${r.id}`} className={'nav-item' + (rota === r.id ? ' ativo' : '')}>
            <Icon name={r.icon} />
            {r.label}
            {r.id === 'conciliacao' && pendentes > 0 && <span className="nav-badge">{pendentes}</span>}
          </a>
        ))}
        <div className="sidebar-rodape">v0.2</div>
      </nav>
      <div className="main">
        <header className="topbar">
          <select
            className="select input empresa-select"
            value={empresa.id}
            onChange={(e) => (e.target.value === 'nova' ? setNovaEmpresa(true) : setEmpresaId(Number(e.target.value)))}
            aria-label="Empresa"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
            <option value="nova">+ Nova empresa…</option>
          </select>
          {empresa.documento && <span className="muted small">{empresa.documento}</span>}
          <span className="muted small" style={{ marginLeft: 'auto' }}>{session?.user.email}</span>
          <button className="btn btn-sm" onClick={sair}>Sair</button>
        </header>
        {/* key: ao trocar de empresa, a página é remontada e os filtros/estado começam do zero */}
        <main className="content" key={empresa.id}>
          {rota === 'painel' && <Painel />}
          {rota === 'receber' && <Lancamentos tipo="receber" />}
          {rota === 'pagar' && <Lancamentos tipo="pagar" />}
          {rota === 'fluxo' && <FluxoCaixa />}
          {rota === 'conciliacao' && <Conciliacao />}
          {rota === 'cadastros' && <Cadastros />}
        </main>
      </div>
      {novaEmpresa && <EmpresaModal onClose={() => setNovaEmpresa(false)} />}
    </div>
  );
}

function AppLogado() {
  const { session } = useAuth();
  // key: ao trocar de usuário, todo o estado (empresas, filtros) recomeça do zero.
  return (
    <EmpresaProvider key={session?.user.id}>
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
