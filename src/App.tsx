import { useEffect, useState } from 'react';
import { EmpresaProvider, useEmpresa } from './lib/empresa';
import { AuthProvider, supabase, useAuth } from './lib/auth';
import { Login } from './pages/Login';
import { Icon, ToastProvider, useToast } from './components/ui';
import { SomaCelulas } from './components/SomaCelulas';
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
import { Analise, DRE, Margem, RELATORIOS, RelatorioMensal, Vencidos, relatoriosDoSegmento } from './pages/Relatorios';
import { Contatos } from './pages/Contatos';
import { Forecast } from './pages/Forecast';

type ItemMenu = { id: string; label: string; icon: Parameters<typeof Icon>[0]['name'] };
type Secao = { secao: string | null; icon?: ItemMenu['icon']; itens: ItemMenu[] };

// Menu por seções, no modelo do Conta Azul. Relatórios exclusivos aparecem só no segmento da empresa.
function montarMenu(segmento: 'servico' | 'produto'): Secao[] {
  return [
    { secao: null, itens: [{ id: 'painel', label: 'Início', icon: 'painel' }] },
    {
      secao: 'Financeiro',
      icon: 'dinheiro',
      itens: [
        { id: 'extrato', label: 'Extrato de movimentações', icon: 'extrato' },
        { id: 'receber', label: 'Contas a receber', icon: 'receber' },
        { id: 'pagar', label: 'Contas a pagar', icon: 'pagar' },
        { id: 'fluxo', label: 'Fluxo de caixa', icon: 'fluxo' },
        { id: 'conciliacao', label: 'Conciliação bancária', icon: 'banco' },
      ],
    },
    {
      secao: 'Relatórios',
      icon: 'painel',
      itens: [
        ...relatoriosDoSegmento(segmento).map((r) => ({ id: `relatorios/${r.id}`, label: r.nome, icon: 'extrato' as const })),
      ],
    },
    {
      secao: 'Configurações',
      icon: 'config',
      itens: [
        { id: 'contatos', label: 'Clientes e fornecedores', icon: 'config' },
        { id: 'cadastros', label: 'Empresa, contas e categorias', icon: 'config' },
      ],
    },
  ];
}
const ROTAS = ['painel', 'extrato', 'receber', 'pagar', 'fluxo', 'conciliacao', 'cadastros', 'contatos', 'gestao', 'relatorios', ...RELATORIOS.map((r) => `relatorios/${r.id}`)];
type Rota = string;

/** Menu lateral inteiro fechado ou aberto pelo botão ☰ (lembrado no navegador). */
function useMenuLateral() {
  const [fechado, setFechado] = useState(() => {
    try {
      return localStorage.getItem('finvision:menu-lateral-fechado') === '1';
    } catch {
      return false;
    }
  });
  const alternarMenu = () =>
    setFechado((f) => {
      try {
        localStorage.setItem('finvision:menu-lateral-fechado', f ? '0' : '1');
      } catch {
        /* sem armazenamento: só não lembra */
      }
      return !f;
    });
  return { menuFechado: fechado, alternarMenu };
}

/** Quais seções do menu estão recolhidas (lembrado no navegador). */
function useSecoesFechadas() {
  const [fechadas, setFechadas] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('finvision:menu-fechado') ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const alternar = (secao: string) =>
    setFechadas((f) => {
      const n = new Set(f);
      n.has(secao) ? n.delete(secao) : n.add(secao);
      try {
        localStorage.setItem('finvision:menu-fechado', JSON.stringify([...n]));
      } catch {
        /* sem armazenamento: só não lembra */
      }
      return n;
    });
  return { fechadas, alternar };
}

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
  // "+ Nova empresa" só para a gestão do escritório (ou para quem ainda não tem empresa). Membro convidado não vê.
  const podeCriarEmpresa = empresas.length === 0 || empresas.some((e) => e.via_escritorio);
  const { fechadas, alternar } = useSecoesFechadas();
  const { menuFechado, alternarMenu } = useMenuLateral();
  // Quem é do escritório entra pela tela do escritório (Gestão), fora de qualquer cliente.
  const ehEscritorio = empresas.some((e) => e.via_escritorio);
  const [entradaSemRota] = useState(() => !location.hash.replace(/^#\/?/, ''));
  useEffect(() => {
    if (entradaSemRota && ehEscritorio) location.hash = '#/gestao';
  }, [entradaSemRota, ehEscritorio]);

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

  // Tela do escritório: própria, sem menu de cliente. Daqui se entra em cada empresa.
  if (rota === 'gestao' && temGestao) {
    const nomeEscritorio = doEscritorio[0]?.escritorio_nome;
    return (
      <div className="escritorio-shell">
        <header className="topbar">
          <div className="brand brand-topo">
            <div className="brand-logo"><Icon name="fluxo" size={18} /></div>
            FinVision
          </div>
          <span className="badge badge-neutro"><Icon name="predio" size={12} /> {nomeEscritorio ? `Escritório ${nomeEscritorio}` : 'Escritório'}</span>
          <select className="select input empresa-select" value="" onChange={(e) => {
            if (e.target.value === 'nova') return setNovaEmpresa(true);
            setEmpresaId(Number(e.target.value));
            location.hash = '#/painel';
          }} aria-label="Abrir empresa">
            <option value="">Abrir uma empresa…</option>
            {doEscritorio.length > 0 && <optgroup label="Clientes do escritório">{doEscritorio.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</optgroup>}
            {avulsas.length > 0 && <optgroup label="Outras empresas">{avulsas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</optgroup>}
            {podeCriarEmpresa && <option value="nova">+ Nova empresa…</option>}
          </select>
          <span className="muted small" style={{ marginLeft: 'auto' }}>{session?.user.email}</span>
          <button className="btn btn-sm" onClick={sair}>Sair</button>
        </header>
        <main className="content">
          <Gestao />
        </main>
        {novaEmpresa && <EmpresaModal onClose={() => setNovaEmpresa(false)} />}
      </div>
    );
  }
  const menu = montarMenu(empresa.segmento);
  if (temGestao) menu.push({ secao: 'Escritório', icon: 'predio', itens: [{ id: 'gestao', label: 'Gestão', icon: 'predio' }] });
  // Relatório exclusivo de outro segmento (ex.: link antigo): volta para a lista de relatórios.
  const rotaValida = rota.startsWith('relatorios/') && !menu.some((s) => s.itens.some((i) => i.id === rota)) ? 'relatorios' : rota;

  return (
    <div className={'app' + (menuFechado ? ' menu-fechado' : '')}>
      <nav className="sidebar" hidden={menuFechado}>
        <div className="brand">
          <div className="brand-logo">
            <Icon name="fluxo" size={18} />
          </div>
          FinVision
        </div>
        {menu.map((s) => {
          const contemAtual = s.itens.some((i) => i.id === rotaValida);
          // A seção da tela aberta fica sempre visível, mesmo que tenha sido recolhida.
          const aberta = !s.secao || contemAtual || !fechadas.has(s.secao);
          return (
            <div key={s.secao ?? 'inicio'} className="nav-secao">
              {s.secao && (
                <button className={'nav-titulo' + (contemAtual ? ' atual' : '')} onClick={() => alternar(s.secao!)} aria-expanded={aberta} disabled={contemAtual} title={contemAtual ? 'Seção da tela atual' : aberta ? 'Recolher' : 'Expandir'}>
                  {s.icon && <Icon name={s.icon} size={14} />}
                  <span>{s.secao}</span>
                  <span className={'nav-seta' + (aberta ? ' aberta' : '')}><Icon name="seta" size={14} /></span>
                </button>
              )}
              {aberta && s.itens.map((r) => (
                <a key={r.id} href={`#/${r.id}`} className={'nav-item' + (s.secao ? ' nav-sub' : '') + (rotaValida === r.id ? ' ativo' : '')}>
                  {!s.secao && <Icon name={r.icon} />}
                  {r.label}
                  {r.id === 'conciliacao' && pendentes > 0 && <span className="nav-badge">{pendentes}</span>}
                </a>
              ))}
            </div>
          );
        })}
        <div className="sidebar-rodape">v0.3</div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm btn-menu" onClick={alternarMenu} aria-label={menuFechado ? 'Abrir o menu' : 'Fechar o menu'} title={menuFechado ? 'Abrir o menu' : 'Fechar o menu'} aria-expanded={!menuFechado}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          {temGestao && (
            <a className="btn btn-ghost btn-sm" href="#/gestao" title="Voltar para a tela do escritório (todas as empresas)">
              <Icon name="predio" size={14} /> Escritório
            </a>
          )}
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
            {podeCriarEmpresa && <option value="nova">+ Nova empresa…</option>}
          </select>
          <span className={'badge badge-segmento-' + empresa.segmento} title="Segmento da empresa">{NOME_SEGMENTO[empresa.segmento]}</span>
          {empresa.documento && <span className="muted small">{empresa.documento}</span>}
          <span className="muted small" style={{ marginLeft: 'auto' }}>{session?.user.email}</span>
          <button className="btn btn-sm" onClick={sair}>Sair</button>
        </header>
        {/* key: ao trocar de empresa, a página é remontada e os filtros/estado começam do zero */}
        <main className="content" key={empresa.id}>
          {rotaValida === 'painel' && <Painel />}
          {rotaValida === 'extrato' && <Extrato />}
          {rotaValida === 'receber' && <Lancamentos tipo="receber" />}
          {rotaValida === 'pagar' && <Lancamentos tipo="pagar" />}
          {rotaValida === 'fluxo' && <FluxoCaixa />}
          {rotaValida === 'conciliacao' && <Conciliacao />}
          {rotaValida === 'cadastros' && <Cadastros />}
          {rotaValida === 'contatos' && <Contatos />}
          {rotaValida === 'relatorios/forecast' && <Forecast />}
                    {(rotaValida === 'relatorios' || rotaValida === 'relatorios/mensal') && <RelatorioMensal />}
          {rotaValida === 'relatorios/dre' && <DRE />}
          {rotaValida === 'relatorios/margem' && <Margem />}
          {rotaValida === 'relatorios/vencidos' && <Vencidos />}
          {rotaValida === 'relatorios/recebimentos' && (
            <Analise key="rec" tipo="receber" agruparInicial="categoria" titulo="Análise de recebimentos" descricao="Quanto entrou em cada categoria (ou de cada cliente), mês a mês, e o peso de cada uma no total." />
          )}
          {rotaValida === 'relatorios/pagamentos' && (
            <Analise key="pag" tipo="pagar" agruparInicial="categoria" titulo="Análise de pagamentos" descricao="Quanto saiu em cada categoria (ou para cada fornecedor), mês a mês, e o peso de cada uma no total." />
          )}
          {rotaValida === 'relatorios/clientes' && (
            <Analise key="cli" tipo="receber" agruparInicial="contato" fixo titulo="Receita por cliente" descricao="Quanto cada cliente pagou, mês a mês, e a participação de cada um no faturamento." />
          )}
          {rotaValida === 'relatorios/fornecedores' && (
            <Analise key="forn" tipo="pagar" agruparInicial="contato" fixo titulo="Gastos por fornecedor" descricao="Quanto foi pago a cada fornecedor, mês a mês." />
          )}
        </main>
      </div>
      <SomaCelulas />
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
