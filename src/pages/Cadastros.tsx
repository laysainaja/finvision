import { useState } from 'react';
import { api } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR, hoje } from '../lib/format';
import { NOME_GRUPO_FORECAST, NOME_LINHA_DRE, type Categoria, type ContaBancaria, type Empresa, type GrupoForecast, type LinhaDRE } from '../types';
import { Field, Icon, Modal, MoneyInput, useAcao } from '../components/ui';
import { Equipe } from './Equipe';

export function EmpresaModal({ empresa, onClose }: { empresa?: Empresa; onClose: () => void }) {
  const { recarregar, setEmpresaId } = useEmpresa();
  const acao = useAcao();
  const [nome, setNome] = useState(empresa?.nome ?? '');
  const [documento, setDocumento] = useState(empresa?.documento ?? '');

  const salvar = async () => {
    let criada: Empresa | null = null;
    const ok = await acao(async () => {
      if (empresa) await api.put(`/empresas/${empresa.id}`, { nome, documento });
      else criada = await api.post<Empresa>('/empresas', { nome, documento });
    }, empresa ? 'Empresa atualizada.' : 'Empresa criada com categorias padrão.');
    if (!ok) return;
    if (criada) setEmpresaId((criada as Empresa).id);
    recarregar();
    onClose();
  };

  return (
    <Modal
      titulo={empresa ? 'Editar empresa' : 'Nova empresa'}
      onClose={onClose}
      rodape={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar}>Salvar</button>
        </>
      }
    >
      <Field label="Razão social / nome">
        <input className="input" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && salvar()} />
      </Field>
      <Field label="CNPJ / CPF">
        <input className="input" value={documento} onChange={(e) => setDocumento(e.target.value)} />
      </Field>
    </Modal>
  );
}

function ContaModal({ conta, onClose }: { conta?: ContaBancaria; onClose: () => void }) {
  const { base, recarregar } = useEmpresa();
  const acao = useAcao();
  const [f, setF] = useState({
    nome: conta?.nome ?? '',
    banco: conta?.banco ?? '',
    saldo_inicial: conta?.saldo_inicial ?? 0,
    negativo: (conta?.saldo_inicial ?? 0) < 0,
    data_saldo_inicial: conta?.data_saldo_inicial ?? hoje(),
    ativa: conta ? !!conta.ativa : true,
  });

  const salvar = async () => {
    const corpo = { ...f, saldo_inicial: Math.abs(f.saldo_inicial) * (f.negativo ? -1 : 1) };
    const ok = await acao(
      () => (conta ? api.put(`${base}/contas-bancarias/${conta.id}`, corpo) : api.post(`${base}/contas-bancarias`, corpo)),
      'Conta salva.',
    );
    if (ok) (recarregar(), onClose());
  };

  return (
    <Modal
      titulo={conta ? 'Editar conta bancária' : 'Nova conta bancária'}
      onClose={onClose}
      rodape={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={salvar}>Salvar</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nome da conta">
          <input className="input" autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Conta corrente" />
        </Field>
        <Field label="Banco">
          <input className="input" value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} placeholder="Ex.: Itaú" />
        </Field>
        <Field label="Saldo inicial">
          <MoneyInput value={Math.abs(f.saldo_inicial)} onChange={(v) => setF({ ...f, saldo_inicial: v })} />
        </Field>
        <Field label="Saldo na data de">
          <input className="input" type="date" value={f.data_saldo_inicial} onChange={(e) => setF({ ...f, data_saldo_inicial: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.negativo} onChange={(e) => setF({ ...f, negativo: e.target.checked })} /> Saldo inicial negativo
        </label>
        <label className="check">
          <input type="checkbox" checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} /> Conta ativa
        </label>
      </div>
      <div className="muted small">
        Use o saldo do extrato no início do dia escolhido. Pagamentos anteriores a essa data não alteram o saldo, pois já estão nele.
      </div>
    </Modal>
  );
}

const LINHAS_RECEITA: LinhaDRE[] = ['receita_bruta', 'receita_financeira', 'outra_receita', 'fora_resultado'];
const LINHAS_DESPESA: LinhaDRE[] = ['deducao', 'custo', 'despesa_operacional', 'despesa_financeira', 'outra_despesa', 'fora_resultado'];

function ListaCategorias({ tipo }: { tipo: Categoria['tipo'] }) {
  const { base, categorias, recarregar } = useEmpresa();
  const acao = useAcao();
  const [nova, setNova] = useState('');
  const linhas = (tipo === 'receita' ? LINHAS_RECEITA : LINHAS_DESPESA);
  const [novaDre, setNovaDre] = useState<LinhaDRE>(linhas[0]);
  // Agrupadas pela linha da DRE, na ordem em que aparecem no relatório.
  const lista = categorias.filter((c) => c.tipo === tipo).sort((a, b) => linhas.indexOf(a.dre ?? linhas[0]) - linhas.indexOf(b.dre ?? linhas[0]) || a.nome.localeCompare(b.nome));

  const adicionar = async () => {
    if (!nova.trim()) return;
    if (await acao(() => api.post(`${base}/categorias`, { nome: nova, tipo, dre: novaDre }))) (setNova(''), recarregar());
  };
  const mudarDre = async (c: Categoria, dre: LinhaDRE) => {
    if (await acao(() => api.put(`${base}/categorias/${c.id}`, { dre }), `"${c.nome}" agora entra em ${NOME_LINHA_DRE[dre]} na DRE.`)) recarregar();
  };
  const mudarGrupo = async (c: Categoria, grupo_forecast: GrupoForecast) => {
    if (await acao(() => api.put(`${base}/categorias/${c.id}`, { grupo_forecast }), `"${c.nome}" agora é ${NOME_GRUPO_FORECAST[grupo_forecast].toLowerCase()} no Forecast.`)) recarregar();
  };
  const renomear = async (c: Categoria) => {
    const nome = prompt('Novo nome da categoria:', c.nome);
    if (nome && nome !== c.nome && (await acao(() => api.put(`${base}/categorias/${c.id}`, { nome })))) recarregar();
  };
  const excluir = async (c: Categoria) => {
    if (!confirm(`Excluir a categoria "${c.nome}"? Os lançamentos dela ficarão sem categoria.`)) return;
    if (await acao(() => api.del(`${base}/categorias/${c.id}`), 'Categoria excluída.')) recarregar();
  };

  return (
    <div className="card lista-categorias">
      <div className="card-header">
        <div>
          <h2>{tipo === 'receita' ? 'Categorias de receita' : 'Categorias de despesa'}</h2>
          <div className="muted small">{tipo === 'despesa' ? 'Ao lado: a linha da DRE e o grupo no Forecast (investimento, imposto de anúncio, variável ou fixo).' : 'Ao lado, a linha da DRE onde cada uma entra.'}</div>
        </div>
      </div>
      {lista.map((c) => (
        <div key={c.id} className={'categoria-linha' + (tipo === 'despesa' ? ' com-grupo' : '')}>
          <span className="categoria-nome">{c.nome}</span>
          <select className="select input" value={c.dre ?? linhas[0]} onChange={(e) => mudarDre(c, e.target.value as LinhaDRE)} aria-label={`Linha da DRE de ${c.nome}`}>
            {linhas.map((l) => <option key={l} value={l}>{NOME_LINHA_DRE[l]}</option>)}
          </select>
          {tipo === 'despesa' && (
            <select className="select input" value={c.grupo_forecast ?? 'fixo'} onChange={(e) => mudarGrupo(c, e.target.value as GrupoForecast)} aria-label={`Grupo do Forecast de ${c.nome}`}>
              {(Object.keys(NOME_GRUPO_FORECAST) as GrupoForecast[]).map((g) => <option key={g} value={g}>{NOME_GRUPO_FORECAST[g]}</option>)}
            </select>
          )}
          <span className="categoria-acoes">
            <button className="btn btn-ghost btn-sm" onClick={() => renomear(c)} aria-label="Renomear"><Icon name="editar" /></button>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={() => excluir(c)} aria-label="Excluir"><Icon name="lixo" /></button>
          </span>
        </div>
      ))}
      <div className="toolbar" style={{ borderBottom: 0, borderTop: '1px solid var(--border)' }}>
        <input className="input grow" placeholder="Nova categoria…" value={nova} onChange={(e) => setNova(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && adicionar()} />
        <select className="select input" value={novaDre} onChange={(e) => setNovaDre(e.target.value as LinhaDRE)} aria-label="Linha da DRE da nova categoria">
          {linhas.map((l) => <option key={l} value={l}>{NOME_LINHA_DRE[l]}</option>)}
        </select>
        <button className="btn" onClick={adicionar}><Icon name="mais" /> Adicionar</button>
      </div>
    </div>
  );
}

export function Cadastros() {
  const { empresa, base, contas, recarregar } = useEmpresa();
  const acao = useAcao();
  const [editarEmpresa, setEditarEmpresa] = useState(false);
  const [conta, setConta] = useState<{ conta?: ContaBancaria } | null>(null);

  const excluirConta = async (c: ContaBancaria) => {
    if (!confirm(`Excluir a conta "${c.nome}"?`)) return;
    if (await acao(() => api.del(`${base}/contas-bancarias/${c.id}`), 'Conta excluída.')) recarregar();
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Cadastros</h1>
          <p>Empresa, equipe, contas bancárias e plano de categorias.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div className="muted small">Empresa</div>
          <h2>{empresa?.nome}</h2>
          <div className="muted">{empresa?.documento || 'Sem documento cadastrado'}</div>
        </div>
        {empresa?.papel === 'dono' && <button className="btn" onClick={() => setEditarEmpresa(true)}><Icon name="editar" /> Editar</button>}
      </div>

      <Equipe />

      <div className="card">
        <div className="card-header">
          <h2>Contas bancárias</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setConta({})}><Icon name="mais" /> Nova conta</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Banco</th>
                <th className="r">Saldo inicial</th>
                <th>Em</th>
                <th className="r">Saldo atual</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contas.map((c) => (
                <tr key={c.id}>
                  <td className="desc-principal">{c.nome}</td>
                  <td className="muted">{c.banco ?? '—'}</td>
                  <td className="r num">{brl(c.saldo_inicial)}</td>
                  <td className="num muted">{dataBR(c.data_saldo_inicial)}</td>
                  <td className={'r num ' + (c.saldo_atual < 0 ? 'alerta' : '')}><b>{brl(c.saldo_atual)}</b></td>
                  <td>{c.ativa ? <span className="badge badge-pago">Ativa</span> : <span className="badge badge-neutro">Inativa</span>}</td>
                  <td className="acoes">
                    <button className="btn btn-ghost btn-sm" onClick={() => setConta({ conta: c })} aria-label="Editar"><Icon name="editar" /></button>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => excluirConta(c)} aria-label="Excluir"><Icon name="lixo" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {contas.length === 0 && <div className="vazio">Cadastre a primeira conta bancária para registrar pagamentos.</div>}
        </div>
      </div>

      {/* Uma lista embaixo da outra, na largura toda: o nome da categoria cabe numa linha só */}
      <ListaCategorias tipo="receita" />
      <ListaCategorias tipo="despesa" />

      {editarEmpresa && empresa && <EmpresaModal empresa={empresa} onClose={() => setEditarEmpresa(false)} />}
      {conta && <ContaModal conta={conta.conta} onClose={() => setConta(null)} />}
    </>
  );
}
