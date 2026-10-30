import { useEffect, useMemo, useState } from 'react';
import { api, qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR } from '../lib/format';
import { NOME_TIPO_RECEITA, type Lancamento, type Resumo, type TipoLancamento } from '../types';
import { Icon, StatusBadge, useAcao } from '../components/ui';
import { BaixaModal, ExcluirModal, LancamentoForm, NOME_TIPO } from '../components/LancamentoForms';
import { PainelPagamentosAsaas, PrepararPagamento, useAsaasPagamentos } from '../components/AsaasPagamentos';

type FiltroStatus = 'em_aberto' | 'vencido' | 'pago' | 'todos';

export function Lancamentos({ tipo }: { tipo: TipoLancamento }) {
  const { base, versao, recarregar, categorias, contas } = useEmpresa();
  const acao = useAcao();
  const nomes = NOME_TIPO[tipo];
  const titulo = tipo === 'pagar' ? 'Contas a pagar' : 'Contas a receber';

  const [status, setStatus] = useState<FiltroStatus>('em_aberto');
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [categoria, setCategoria] = useState('');
  const [conta, setConta] = useState('');
  const [tipoReceita, setTipoReceita] = useState('');
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<{ lancamento?: Lancamento } | null>(null);
  const [baixa, setBaixa] = useState<Lancamento[] | null>(null);
  const [excluir, setExcluir] = useState<Lancamento | null>(null);
  const [pagarAsaas, setPagarAsaas] = useState<Lancamento | null>(null);
  const asaas = useAsaasPagamentos();
  const comAsaas = tipo === 'pagar' && asaas.contasPagamento.length > 0;

  // Espera o usuário parar de digitar antes de buscar.
  useEffect(() => {
    const t = setTimeout(() => setQ(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const lista = useApi<Lancamento[]>(
    `${base}/lancamentos${qs({ tipo, status: status === 'todos' ? null : status, q, de, ate, categoria_id: categoria, conta_id: conta, tipo_receita: tipo === 'receber' ? tipoReceita : null, v: versao })}`,
  );
  const resumo = useApi<Resumo>(`${base}/resumo?v=${versao}`);
  const r = resumo.data?.[tipo];
  const itens = lista.data ?? [];

  useEffect(() => setSelecionados(new Set()), [lista.data]);

  const contatos = useMemo(() => [...new Set(itens.map((l) => l.contato).filter(Boolean) as string[])].sort(), [itens]);
  const total = itens.reduce((s, l) => s + (l.valor_pago ?? l.valor), 0);
  const selecionaveis = itens.filter((l) => l.status !== 'pago');
  const selecao = itens.filter((l) => selecionados.has(l.id));
  const totalSelecao = selecao.reduce((s, l) => s + l.valor, 0);

  const alternar = (id: number) =>
    setSelecionados((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const concluir = () => {
    setForm(null);
    setBaixa(null);
    setExcluir(null);
    recarregar();
  };

  const estornar = async (l: Lancamento) => {
    const aviso = l.extrato_id ? '\n\nEle também será desvinculado do extrato bancário.' : '';
    if (!confirm(`Estornar "${l.descricao}"? Ele volta a ficar em aberto.${aviso}`)) return;
    if (await acao(() => api.post(`${base}/lancamentos/${l.id}/estorno`), 'Lançamento estornado.')) recarregar();
  };

  const cor = tipo === 'pagar' ? 'saida' : 'entrada';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{titulo}</h1>
          <p>{tipo === 'pagar' ? 'Despesas, fornecedores e obrigações da empresa.' : 'Vendas, serviços e valores a receber de clientes.'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setForm({})}>
          <Icon name="mais" /> Nova {nomes.singular}
        </button>
      </div>

      <div className="grid grid-4">
        <div className="card kpi">
          <div className="kpi-label">Vencido</div>
          <div className={'kpi-valor ' + (r?.vencido ? 'alerta' : '')}>{brl(r?.vencido ?? 0)}</div>
          <div className="kpi-sub">{r?.qtd_vencido ?? 0} lançamento(s) em atraso</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Vence hoje</div>
          <div className="kpi-valor">{brl(r?.hoje ?? 0)}</div>
          <div className="kpi-sub">{r?.qtd_hoje ?? 0} lançamento(s)</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Próximos 7 dias</div>
          <div className="kpi-valor">{brl(r?.semana ?? 0)}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Até o fim do mês</div>
          <div className={'kpi-valor ' + cor}>{brl(r?.mes ?? 0)}</div>
        </div>
      </div>

      {tipo === 'pagar' && <PainelPagamentosAsaas pagamentos={asaas.pagamentos} onMudou={() => (asaas.recarregar(), recarregar())} />}

      <div className="card">
        <div className="toolbar">
          <div className="tabs" role="tablist">
            {(
              [
                ['em_aberto', 'Em aberto'],
                ['vencido', 'Vencidos'],
                ['pago', tipo === 'pagar' ? 'Pagos' : 'Recebidos'],
                ['todos', 'Todos'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} className={'tab' + (status === v ? ' ativo' : '')} onClick={() => setStatus(v)} role="tab" aria-selected={status === v}>
                {label}
              </button>
            ))}
          </div>
          <input className="input grow" placeholder="Buscar descrição, contato ou documento…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <input className="input" type="date" value={de} onChange={(e) => setDe(e.target.value)} title={status === 'pago' ? 'Pago a partir de' : 'Vencimento a partir de'} />
          <span className="muted">até</span>
          <input className="input" type="date" value={ate} onChange={(e) => setAte(e.target.value)} title="Até" />
          <select className="select input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categorias.filter((c) => c.tipo === (tipo === 'pagar' ? 'despesa' : 'receita')).map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
          {tipo === 'receber' && (
            <select className="select input" value={tipoReceita} onChange={(e) => setTipoReceita(e.target.value)} aria-label="Tipo de receita">
              <option value="">Todos os tipos</option>
              <option value="nova">Nova venda</option>
              <option value="recorrente">Recorrente</option>
              <option value="avulsa">Avulsa</option>
              <option value="sem">Sem tipo</option>
            </select>
          )}
          <select className="select input" value={conta} onChange={(e) => setConta(e.target.value)}>
            <option value="">Todas as contas</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>

        {selecao.length > 0 && (
          <div className="toolbar" style={{ background: 'var(--primary-soft)' }}>
            <b>{selecao.length} selecionado(s)</b>
            <span className="num">{brl(totalSelecao)}</span>
            <button className="btn btn-primary btn-sm" onClick={() => setBaixa(selecao)}>
              <Icon name="check" /> {nomes.acao} selecionados
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelecionados(new Set())}>Limpar seleção</button>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    checked={selecionaveis.length > 0 && selecionaveis.every((l) => selecionados.has(l.id))}
                    onChange={(e) => setSelecionados(new Set(e.target.checked ? selecionaveis.map((l) => l.id) : []))}
                  />
                </th>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Conta</th>
                <th className="r">Valor</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((l) => (
                <tr key={l.id} className={selecionados.has(l.id) ? 'selecionado' : ''}>
                  <td>
                    {l.status !== 'pago' && <input type="checkbox" checked={selecionados.has(l.id)} onChange={() => alternar(l.id)} aria-label="Selecionar" />}
                  </td>
                  <td className="num">{dataBR(l.vencimento)}</td>
                  <td>
                    <div className="desc-principal">
                      {l.descricao}
                      {l.total_parcelas && <span className="muted small"> · {l.parcela}/{l.total_parcelas}</span>}
                    </div>
                    <div className="desc-sub">
                      {l.tipo_receita && <span className={'tag-receita tag-' + l.tipo_receita}>{NOME_TIPO_RECEITA[l.tipo_receita]}</span>}
                      {[l.contato, l.documento && `Doc. ${l.documento}`].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="muted">{l.categoria_nome ?? '—'}</td>
                  <td className="muted">{l.conta_nome ?? '—'}</td>
                  <td className={'r num ' + (l.status === 'pago' ? cor : '')}>
                    {brl(l.valor_pago ?? l.valor)}
                    {l.valor_pago !== null && l.valor_pago !== l.valor && <div className="desc-sub">original {brl(l.valor)}</div>}
                  </td>
                  <td>
                    <StatusBadge status={l.status} tipo={tipo} />
                    {l.data_pagamento && <div className="desc-sub">em {dataBR(l.data_pagamento)}</div>}
                    {l.extrato_id && <div className="desc-sub" title="Conferido com o extrato bancário">✓ conciliado</div>}
                    {comAsaas && asaas.porLancamento.get(l.id) && l.status !== 'pago' && <div className="desc-sub">Asaas: {asaas.porLancamento.get(l.id)!.status}</div>}
                  </td>
                  <td className="acoes">
                    {l.status !== 'pago' ? (
                      <>
                        <button className="btn btn-sm" onClick={() => setBaixa([l])}>{nomes.acao}</button>
                        {comAsaas && !['preparado', 'enviado'].includes(asaas.porLancamento.get(l.id)?.status ?? '') && (
                          <button className="btn btn-sm btn-ghost" onClick={() => setPagarAsaas(l)} title="Pagar pelo Asaas (Pix)">Asaas</button>
                        )}
                      </>
                    ) : (
                      <button className="btn btn-sm btn-ghost" onClick={() => estornar(l)} title="Estornar pagamento">
                        <Icon name="desfazer" />
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => setForm({ lancamento: l })} title="Editar" aria-label="Editar">
                      <Icon name="editar" />
                    </button>
                    <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setExcluir(l)} title="Excluir" aria-label="Excluir">
                      <Icon name="lixo" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {itens.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5}>{itens.length} lançamento(s)</td>
                  <td className="r num">{brl(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
          {lista.data && itens.length === 0 && <div className="vazio">Nenhum lançamento encontrado com esses filtros.</div>}
          {lista.erro && <div className="vazio alerta">{lista.erro}</div>}
        </div>
      </div>

      {form && <LancamentoForm tipo={tipo} lancamento={form.lancamento} contatos={contatos} onClose={() => setForm(null)} onSaved={concluir} />}
      {baixa && <BaixaModal lancamentos={baixa} onClose={() => setBaixa(null)} onSaved={concluir} />}
      {excluir && <ExcluirModal lancamento={excluir} onClose={() => setExcluir(null)} onDone={concluir} />}
      {pagarAsaas && <PrepararPagamento lancamento={pagarAsaas} contas={asaas.contasPagamento} onClose={() => setPagarAsaas(null)} onSalvo={() => (setPagarAsaas(null), asaas.recarregar())} />}
    </>
  );
}
