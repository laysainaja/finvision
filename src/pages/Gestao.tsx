import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl } from '../lib/format';
import { NOME_SEGMENTO, type EmpresaGestao, type Escritorio, type Segmento } from '../types';
import { Field, Icon, Modal, useAcao } from '../components/ui';

function CriarEscritorio({ onCriado }: { onCriado: () => void }) {
  const acao = useAcao();
  const [nome, setNome] = useState('');
  const criar = async () => {
    if (await acao(() => api.post('/gestao/escritorio', { nome }), 'Escritório criado.')) onCriado();
  };
  return (
    <div className="card card-pad" style={{ maxWidth: 560 }}>
      <h2>Crie o seu escritório</h2>
      <p className="muted">
        O escritório reúne as empresas clientes que você gerencia. Daqui você cria cada empresa, define se ela é de
        <b> serviço</b> ou de <b>produto</b>, convida o cliente e entra em qualquer uma com um clique.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <input className="input" style={{ flex: 1 }} placeholder="Nome do escritório (ex.: Thunder BPO)" value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && criar()} />
        <button className="btn btn-primary" onClick={criar}>Criar escritório</button>
      </div>
    </div>
  );
}

function NovaEmpresaCliente({ onClose, onCriada }: { onClose: () => void; onCriada: () => void }) {
  const acao = useAcao();
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [segmento, setSegmento] = useState<Segmento>('servico');
  const salvar = async () => {
    if (await acao(() => api.post('/gestao/empresas', { nome, documento, segmento }), 'Empresa cliente criada.')) onCriada();
  };
  return (
    <Modal
      titulo="Nova empresa cliente"
      onClose={onClose}
      rodape={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar}>Criar empresa</button>
        </>
      }
    >
      <Field label="Razão social / nome">
        <input className="input" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
      </Field>
      <Field label="CNPJ / CPF">
        <input className="input" value={documento} onChange={(e) => setDocumento(e.target.value)} />
      </Field>
      <Field label="Segmento">
        <div className="segmentos">
          {(['servico', 'produto'] as const).map((s) => (
            <label key={s} className={'segmento-opcao' + (segmento === s ? ' ativo' : '')}>
              <input type="radio" name="segmento" checked={segmento === s} onChange={() => setSegmento(s)} />
              <b>{NOME_SEGMENTO[s]}</b>
              <span className="small muted">
                {s === 'servico' ? 'Prestadores de serviço: contratos, mensalidades, análise por cliente.' : 'Comércio e indústria: compras, fornecedores, custo da mercadoria e margem.'}
              </span>
            </label>
          ))}
        </div>
      </Field>
      <div className="muted small">As categorias financeiras padrão são criadas de acordo com o segmento. Depois, convide o cliente pela tela Cadastros → Equipe.</div>
    </Modal>
  );
}

export function Gestao() {
  const { setEmpresaId, recarregar, versao } = useEmpresa();
  const acao = useAcao();
  const info = useApi<{ escritorio: Escritorio | null }>(`/gestao?v=${versao}`);
  const esc = info.data?.escritorio;
  const lista = useApi<{ empresas: EmpresaGestao[]; vinculaveis: { id: number; nome: string; segmento: Segmento }[] }>(esc ? `/gestao/empresas?v=${versao}` : null);
  const [nova, setNova] = useState(false);
  const [vincular, setVincular] = useState('');
  const [filtro, setFiltro] = useState<'todos' | Segmento>('todos');
  const [busca, setBusca] = useState('');

  if (!info.data) return null;
  if (!esc) {
    return (
      <>
        <div className="page-header"><div><h1>Gestão</h1><p>Painel do escritório para gerenciar empresas clientes.</p></div></div>
        <CriarEscritorio onCriado={recarregar} />
      </>
    );
  }

  const empresas = lista.data?.empresas ?? [];
  const contagem = { servico: empresas.filter((e) => e.segmento === 'servico').length, produto: empresas.filter((e) => e.segmento === 'produto').length };
  const visiveis = empresas.filter((e) => (filtro === 'todos' || e.segmento === filtro) && (!busca || `${e.nome} ${e.documento ?? ''}`.toLowerCase().includes(busca.toLowerCase())));

  const mudarSegmento = async (e: EmpresaGestao, segmento: Segmento) => {
    if (await acao(() => api.put(`/gestao/empresas/${e.id}`, { segmento }), `${e.nome} agora é ${NOME_SEGMENTO[segmento].toLowerCase()}.`)) recarregar();
  };
  const entrar = (e: EmpresaGestao, rota = 'painel') => {
    setEmpresaId(e.id);
    location.hash = `#/${rota}`;
  };
  const fazerVinculo = async () => {
    if (vincular && (await acao(() => api.post('/gestao/vincular', { empresa_id: Number(vincular) }), 'Empresa vinculada ao escritório.'))) (setVincular(''), recarregar());
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Gestão · {esc.nome}</h1>
          <p>Empresas clientes do escritório. Defina o segmento de cada uma e entre para trabalhar.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setNova(true)}><Icon name="mais" /> Nova empresa cliente</button>
      </div>

      <div className="grid grid-3">
        {([['todos', 'Todos os clientes', empresas.length], ['servico', 'Serviço', contagem.servico], ['produto', 'Produto', contagem.produto]] as const).map(([v, label, n]) => (
          <button key={v} className={'card kpi kpi-filtro' + (filtro === v ? ' ativo' : '')} onClick={() => setFiltro(v)}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-valor">{n}</div>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="toolbar">
          <input className="input grow" placeholder="Pesquisar cliente por nome ou CNPJ…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {lista.data && lista.data.vinculaveis.length > 0 && (
            <>
              <select className="select input" value={vincular} onChange={(e) => setVincular(e.target.value)} aria-label="Empresa para vincular">
                <option value="">Vincular empresa que já é sua…</option>
                {lista.data.vinculaveis.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
              <button className="btn" onClick={fazerVinculo} disabled={!vincular}>Vincular</button>
            </>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Segmento</th>
                <th className="r">Saldo em contas</th>
                <th className="r">A receber vencido</th>
                <th className="r">A pagar vencido</th>
                <th className="r">Conciliação</th>
                <th className="r">Usuários</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="desc-principal">{e.nome}</div>
                    <div className="desc-sub">{e.documento || 'Sem CNPJ'}</div>
                  </td>
                  <td style={{ width: 150 }}>
                    <select className="select input" value={e.segmento} onChange={(ev) => mudarSegmento(e, ev.target.value as Segmento)} aria-label={`Segmento de ${e.nome}`}>
                      <option value="servico">Serviço</option>
                      <option value="produto">Produto</option>
                    </select>
                  </td>
                  <td className={'r num ' + (e.saldo < 0 ? 'alerta' : '')}>{brl(e.saldo)}</td>
                  <td className={'r num ' + (e.receber_vencido ? 'alerta' : 'muted')}>{brl(e.receber_vencido)}</td>
                  <td className={'r num ' + (e.pagar_vencido ? 'alerta' : 'muted')}>
                    {brl(e.pagar_vencido)}
                    {e.pagar_hoje > 0 && <div className="desc-sub">{e.pagar_hoje} vence(m) hoje</div>}
                  </td>
                  <td className="r">{e.pendentes_conciliacao ? <span className="badge badge-aviso">{e.pendentes_conciliacao} pendente(s)</span> : <span className="muted">em dia</span>}</td>
                  <td className="r">
                    {e.usuarios ? e.usuarios : (
                      <button className="btn btn-sm btn-ghost" onClick={() => entrar(e, 'cadastros')} title="Convidar o cliente em Cadastros → Equipe">Convidar</button>
                    )}
                  </td>
                  <td className="acoes">
                    <button className="btn btn-sm btn-primary" onClick={() => entrar(e)}><Icon name="entrar" /> Entrar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.data && visiveis.length === 0 && (
            <div className="vazio">{empresas.length ? 'Nenhum cliente com esse filtro.' : 'Nenhuma empresa cliente ainda. Clique em "Nova empresa cliente".'}</div>
          )}
        </div>
      </div>

      {nova && <NovaEmpresaCliente onClose={() => setNova(false)} onCriada={() => (setNova(false), recarregar())} />}
    </>
  );
}
