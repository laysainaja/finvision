import { useState } from 'react';
import { api, qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR } from '../lib/format';
import type { Contato } from '../types';
import { Field, Icon, Modal, useAcao } from '../components/ui';

const NOME_TIPO = { cliente: 'Cliente', fornecedor: 'Fornecedor', ambos: 'Cliente e fornecedor' } as const;
type Filtro = '' | 'cliente' | 'fornecedor';

function FormContato({ contato, onClose, onSalvo }: { contato?: Contato; onClose: () => void; onSalvo: () => void }) {
  const { base } = useEmpresa();
  const acao = useAcao();
  const [f, setF] = useState({
    nome: contato?.nome ?? '',
    tipo: contato?.tipo ?? 'cliente',
    documento: contato?.documento ?? '',
    email: contato?.email ?? '',
    telefone: contato?.telefone ?? '',
    observacao: contato?.observacao ?? '',
  });
  const salvar = async () => {
    const ok = await acao(() => (contato ? api.put(`${base}/contatos/${contato.id}`, f) : api.post(`${base}/contatos`, f)), contato ? 'Cadastro atualizado.' : 'Cadastro criado.');
    if (ok) onSalvo();
  };
  return (
    <Modal
      titulo={contato ? 'Editar cadastro' : 'Novo cliente ou fornecedor'}
      onClose={onClose}
      rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={salvar}>Salvar</button></>}
    >
      <div className="form-grid">
        <Field label="Nome / razão social" className="full">
          <input className="input" autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Field>
        <Field label="Tipo">
          <select className="select input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as Contato['tipo'] })}>
            <option value="cliente">Cliente</option>
            <option value="fornecedor">Fornecedor</option>
            <option value="ambos">Cliente e fornecedor</option>
          </select>
        </Field>
        <Field label="CNPJ / CPF"><input className="input" value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Telefone / WhatsApp"><input className="input" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></Field>
        <Field label="Observação" className="full"><textarea className="input" rows={2} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} /></Field>
      </div>
      {contato && <div className="muted small">Renomear atualiza o nome em todos os lançamentos deste cadastro.</div>}
    </Modal>
  );
}

function Juntar({ origem, todos, onClose, onFeito }: { origem: Contato; todos: Contato[]; onClose: () => void; onFeito: () => void }) {
  const { base } = useEmpresa();
  const acao = useAcao();
  const [destino, setDestino] = useState('');
  const juntar = async () => {
    if (!destino) return;
    const alvo = todos.find((c) => c.id === Number(destino));
    if (await acao(() => api.post(`${base}/contatos/${origem.id}/juntar`, { destino_id: Number(destino) }), `"${origem.nome}" foi juntado a "${alvo?.nome}".`)) onFeito();
  };
  return (
    <Modal
      titulo={`Juntar "${origem.nome}"`}
      onClose={onClose}
      rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={juntar} disabled={!destino}>Juntar cadastros</button></>}
    >
      <p style={{ margin: 0 }}>Use quando o mesmo cliente ou fornecedor foi cadastrado duas vezes (ex.: com nomes diferentes). Os {origem.lancamentos} lançamento(s) de <b>{origem.nome}</b> passam para o cadastro escolhido, e este cadastro é removido.</p>
      <Field label="Juntar com">
        <select className="select input" value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Escolha o cadastro que vai ficar…</option>
          {todos.filter((c) => c.id !== origem.id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

type Ordem = { campo: 'nome' | 'total_receber' | 'total_pagar' | 'ultimo_movimento'; desc: boolean };

/** Título de coluna que ordena a lista ao clicar (de novo inverte: maior → menor / menor → maior). */
function ColunaOrdem({ campo, ordem, setOrdem, children, direita }: { campo: Ordem['campo']; ordem: Ordem; setOrdem: (o: Ordem) => void; children: string; direita?: boolean }) {
  const ativa = ordem.campo === campo;
  return (
    <th className={direita ? 'r' : ''} aria-sort={ativa ? (ordem.desc ? 'descending' : 'ascending') : 'none'}>
      <button className={'th-ordem' + (ativa ? ' ativo' : '')} onClick={() => setOrdem({ campo, desc: ativa ? !ordem.desc : campo !== 'nome' })}
        title={campo === 'nome' ? 'Ordenar por nome' : 'Ordenar: maior primeiro / menor primeiro'}>
        {children} <span aria-hidden="true">{ativa ? (ordem.desc ? '▼' : '▲') : '↕'}</span>
      </button>
    </th>
  );
}

export function Contatos() {
  const { base, versao, recarregar } = useEmpresa();
  const acao = useAcao();
  const [filtro, setFiltro] = useState<Filtro>('');
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState<{ contato?: Contato } | null>(null);
  const [juntar, setJuntar] = useState<Contato | null>(null);
  const [ordem, setOrdem] = useState<Ordem>({ campo: 'nome', desc: false });
  const todos = useApi<Contato[]>(`${base}/contatos${qs({ v: versao })}`);
  const lista = (todos.data ?? []).filter(
    (c) => (!filtro || c.tipo === filtro || c.tipo === 'ambos') && (!busca || `${c.nome} ${c.documento ?? ''} ${c.email ?? ''}`.toLowerCase().includes(busca.toLowerCase())),
  ).sort((a, b) => {
    const r = ordem.campo === 'nome' ? a.nome.localeCompare(b.nome, 'pt-BR')
      : ordem.campo === 'ultimo_movimento' ? (a.ultimo_movimento ?? '').localeCompare(b.ultimo_movimento ?? '')
      : a[ordem.campo] - b[ordem.campo];
    return ordem.desc ? -r : r;
  });
  const excluir = async (c: Contato) => {
    if (!confirm(`Excluir o cadastro "${c.nome}"?`)) return;
    if (await acao(() => api.del(`${base}/contatos/${c.id}`), 'Cadastro excluído.')) recarregar();
  };
  const concluir = () => (setForm(null), setJuntar(null), recarregar());

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Clientes e fornecedores</h1>
          <p>Os relatórios por cliente e por fornecedor somam por estes cadastros. Ao digitar um nome novo num lançamento, ele é cadastrado sozinho.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setForm({})}><Icon name="mais" /> Novo cadastro</button>
      </div>
      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            {([['', 'Todos'], ['cliente', 'Clientes'], ['fornecedor', 'Fornecedores']] as const).map(([v, l]) => (
              <button key={v} className={'tab' + (filtro === v ? ' ativo' : '')} onClick={() => setFiltro(v)}>{l}</button>
            ))}
          </div>
          <input className="input grow" placeholder="Pesquisar por nome, CNPJ/CPF ou e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <ColunaOrdem campo="nome" ordem={ordem} setOrdem={setOrdem}>Nome</ColunaOrdem>
                <th>Tipo</th><th>Contato</th>
                <ColunaOrdem campo="total_receber" ordem={ordem} setOrdem={setOrdem} direita>Recebido / a receber</ColunaOrdem>
                <ColunaOrdem campo="total_pagar" ordem={ordem} setOrdem={setOrdem} direita>Pago / a pagar</ColunaOrdem>
                <ColunaOrdem campo="ultimo_movimento" ordem={ordem} setOrdem={setOrdem}>Último movimento</ColunaOrdem>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td><div className="desc-principal">{c.nome}</div><div className="desc-sub">{c.documento || '—'} · {c.lancamentos} lançamento(s)</div></td>
                  <td><span className="badge badge-neutro">{NOME_TIPO[c.tipo]}</span></td>
                  <td className="small">{[c.email, c.telefone].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                  <td className="r num">{c.total_receber ? brl(c.total_receber) : <span className="muted">—</span>}</td>
                  <td className="r num">{c.total_pagar ? brl(c.total_pagar) : <span className="muted">—</span>}</td>
                  <td className="num muted">{dataBR(c.ultimo_movimento) || '—'}</td>
                  <td className="acoes">
                    <button className="btn btn-ghost btn-sm" onClick={() => setForm({ contato: c })} aria-label="Editar"><Icon name="editar" /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setJuntar(c)} title="Juntar com outro cadastro">Juntar</button>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => excluir(c)} aria-label="Excluir"><Icon name="lixo" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {todos.data && lista.length === 0 && <div className="vazio">{todos.data.length ? 'Nenhum cadastro com esse filtro.' : 'Nenhum cliente ou fornecedor ainda.'}</div>}
        </div>
      </div>
      {form && <FormContato contato={form.contato} onClose={() => setForm(null)} onSalvo={concluir} />}
      {juntar && todos.data && <Juntar origem={juntar} todos={todos.data} onClose={() => setJuntar(null)} onFeito={concluir} />}
    </>
  );
}
