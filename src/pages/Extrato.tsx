import { useEffect, useMemo, useRef, useState } from 'react';
import { api, qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR, hoje } from '../lib/format';
import { NOME_TIPO_RECEITA, type ItemExtrato, type Lancamento, type Movimentacoes, type SituacaoExtrato, type TipoLancamento } from '../types';
import { Icon, useAcao } from '../components/ui';
import { exportarCSV } from '../lib/exportar';
import { BaixaModal, LancamentoForm, TransferenciaModal } from '../components/LancamentoForms';
import { SeletorPeriodo, periodoDe, type Periodo } from '../components/SeletorPeriodo';
import { FiltroCategorias, SEM_CATEGORIA } from '../components/FiltroCategorias';
import { MaisFiltros, filtrosVazios, contarFiltros, paramsFiltros, OPCOES_TIPO, OPCOES_SITUACAO, type FiltrosExtras } from '../components/MaisFiltros';
import { FiltroChecklist } from '../components/FiltroChecklist';

const SITUACAO: Record<SituacaoExtrato, { label: string; classe: string }> = {
  recebido: { label: 'Recebido', classe: 'badge-pago' },
  pago: { label: 'Pago', classe: 'badge-pago' },
  aberto: { label: 'Em aberto', classe: 'badge-aberto' },
  vencido: { label: 'Vencido', classe: 'badge-vencido' },
};

const OPCOES_POR_PAGINA = [10, 25, 50, 100];
const CHAVE_POR_PAGINA = 'finvision:extrato-por-pagina';
const lerPorPagina = () => { try { const n = Number(localStorage.getItem(CHAVE_POR_PAGINA)); return OPCOES_POR_PAGINA.includes(n) ? n : 50; } catch { return 50; } };

/**
 * Menu de ações de uma linha (abre ao clicar, fecha ao clicar fora, rolar a página ou Esc).
 * Fica "solto" na tela (position: fixed) para não ser cortado pela tabela, e abre para cima se não couber embaixo.
 */
function MenuAcoes({ itens }: { itens: { label: string; onClick: () => void; perigo?: boolean }[] }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const aberto = pos !== null;
  const abrir = () => {
    if (aberto) return setPos(null);
    const r = botao.current!.getBoundingClientRect();
    const altura = itens.length * 38 + 12; // estimativa do menu
    const right = window.innerWidth - r.right;
    setPos(window.innerHeight - r.bottom < altura + 8 && r.top > altura + 8 ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  };
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setPos(null);
    const sair = () => setPos(null);
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null);
    document.addEventListener('mousedown', fechar);
    document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', sair, true);
    window.addEventListener('resize', sair);
    return () => {
      document.removeEventListener('mousedown', fechar);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', sair, true);
      window.removeEventListener('resize', sair);
    };
  }, [aberto]);
  const setAberto = (v: boolean) => !v && setPos(null);
  return (
    <div className="menu-acoes" ref={ref}>
      <button ref={botao} className="btn btn-sm" onClick={abrir} aria-haspopup="menu" aria-expanded={aberto}>
        Ações <Icon name="seta" />
      </button>
      {aberto && (
        <div className="menu-lista menu-solto" role="menu" style={pos}>
          {itens.map((i) => (
            <button key={i.label} role="menuitem" className={i.perigo ? 'alerta' : ''} onClick={() => (setAberto(false), i.onClick())}>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Extrato() {
  const { base, versao, recarregar, contas, categorias, empresa } = useEmpresa();
  const acao = useAcao();

  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('mes'));
  const { de, ate } = periodo;
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [conta, setConta] = useState('');
  const [ocultas, setOcultas] = useState<Set<number>>(new Set());
  const [extras, setExtras] = useState<FiltrosExtras>(filtrosVazios);
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [porPagina, setPorPagina] = useState(lerPorPagina);
  const mudarPorPagina = (n: number) => {
    setPorPagina(n);
    setPagina(0);
    try { localStorage.setItem(CHAVE_POR_PAGINA, String(n)); } catch { /* sem armazenamento: vale só nesta visita */ }
  };
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [novo, setNovo] = useState<{ tipo: TipoLancamento; lancamento?: Lancamento } | null>(null);
  const [baixa, setBaixa] = useState<ItemExtrato[] | null>(null);
  const [menuNovo, setMenuNovo] = useState(false);
  const [transferir, setTransferir] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const { data, erro } = useApi<Movimentacoes>(
    `${base}/movimentacoes${qs({ de, ate, q, conta_id: conta, ocultar_categorias: [...ocultas].sort().join(','), ...paramsFiltros(extras), v: versao })}`,
  );
  useEffect(() => (setSelecionados(new Set()), setPagina(0)), [data]);

  const itens = data?.itens ?? [];
  const paginaItens = itens.slice(pagina * porPagina, (pagina + 1) * porPagina);
  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));
  const abertos = itens.filter((i) => !i.data_pagamento);
  const selecao = itens.filter((i) => selecionados.has(i.id));
  const filtrosAtivos = [q, conta].filter(Boolean).length + (ocultas.size ? 1 : 0) + contarFiltros(extras);

  // Cartões de resumo: atalho para o tipo + situação (clicar de novo desfaz). Os valores seguem todos os filtros.
  const desmarcadosDo = (t: 'receita' | 'despesa', s: 'em_aberto' | 'realizado') => ({
    tipos: new Set(['receita', 'despesa', 'transferencia'].filter((x) => x !== t)),
    situacoes: new Set(s === 'em_aberto' ? ['realizado'] : ['aberto', 'vencido']),
  });
  const igual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
  const cartaoAtivo = (t: 'receita' | 'despesa', s: 'em_aberto' | 'realizado') => {
    const d = desmarcadosDo(t, s);
    return igual(extras.tipos, d.tipos) && igual(extras.situacoes, d.situacoes);
  };
  // Cartão de transferências: só o tipo Transferência (situação livre).
  const soTransf = igual(extras.tipos, new Set(['receita', 'despesa'])) && !extras.situacoes.size;
  const atalhoTransf = () => setExtras((x) => ({ ...x, tipos: soTransf ? new Set() : new Set(['receita', 'despesa']), situacoes: new Set() }));
  const atalho = (t: 'receita' | 'despesa', s: 'em_aberto' | 'realizado') =>
    setExtras((x) => (cartaoAtivo(t, s) ? { ...x, tipos: new Set(), situacoes: new Set() } : { ...x, ...desmarcadosDo(t, s) }));
  const limpar = () => {
    setBusca('');
    setConta('');
    setOcultas(new Set());
    setExtras(filtrosVazios());
  };
  const concluir = () => {
    setNovo(null);
    setBaixa(null);
    recarregar();
  };
  const editar = async (i: ItemExtrato) => {
    const l = await api.get<Lancamento>(`${base}/lancamentos/${i.id}`).catch(() => null);
    if (l) setNovo({ tipo: l.tipo, lancamento: l });
  };
  const estornar = async (i: ItemExtrato) => {
    if (!confirm(`Estornar "${i.descricao}"? Ele volta a ficar em aberto.`)) return;
    if (await acao(() => api.post(`${base}/lancamentos/${i.id}/estorno`), 'Lançamento estornado.')) recarregar();
  };
  const excluir = async (i: ItemExtrato) => {
    const msg = i.transferencia_id
      ? `Excluir a transferência "${i.descricao}" de ${brl(Math.abs(i.valor_extrato))}? A saída e a entrada nas duas contas serão excluídas.`
      : `Excluir "${i.descricao}" de ${brl(Math.abs(i.valor_extrato))}?`;
    if (!confirm(msg)) return;
    if (await acao(() => api.del(`${base}/lancamentos/${i.id}`), 'Lançamento excluído.')) recarregar();
  };
  // Exporta exatamente o que está na tela (período e filtros), no modelo aprovado: saldo anterior, movimentos, totais.
  const exportar = () => {
    if (!data) return;
    const nomeConta = conta ? contas.find((c) => String(c.id) === conta)?.nome ?? '' : 'todas';
    const filtros = [
      extras.tipos.size > 0 && `tipo: ${OPCOES_TIPO.filter((o) => !extras.tipos.has(o.valor)).map((o) => o.label.toLowerCase()).join(', ') || 'nenhum'}`,
      extras.situacoes.size > 0 && `situação: ${OPCOES_SITUACAO.filter((o) => !extras.situacoes.has(o.valor)).map((o) => o.label.toLowerCase()).join(', ') || 'nenhuma'}`,
      ocultas.size > 0 && `sem as categorias ${[...ocultas].map((id) => id === SEM_CATEGORIA ? 'Sem categoria' : categorias.find((c) => c.id === id)?.nome ?? '').join(', ')}`,
      q && `busca "${q}"`,
      contarFiltros(extras) > 0 && `mais ${contarFiltros(extras)} filtro(s)`,
    ].filter(Boolean).join(', ') || 'nenhum';
    const linhas: (string | number | null)[][] = [
      [dataBR(de), 'Saldo anterior', null, null, null, null, null, null, null, data.saldo_inicial],
      ...itens.map((i) => [
        dataBR(i.data), i.descricao, i.contato, i.categoria_nome ?? 'Sem categoria', i.conta_nome,
        i.tipo_receita ? NOME_TIPO_RECEITA[i.tipo_receita] : null, SITUACAO[i.situacao].label, dataBR(i.vencimento), i.valor_extrato, i.saldo,
      ]),
      [],
      ['Receitas em aberto', null, null, null, null, null, null, null, data.resumo.receitas_aberto, null],
      ['Receitas realizadas', null, null, null, null, null, null, null, data.resumo.receitas_realizadas, null],
      ['Despesas em aberto', null, null, null, null, null, null, null, -data.resumo.despesas_aberto, null],
      ['Despesas realizadas', null, null, null, null, null, null, null, -data.resumo.despesas_realizadas, null],
      ['Transferências: entradas', null, null, null, null, null, null, null, data.resumo.transferencias_entrada, null],
      ['Transferências: saídas', null, null, null, null, null, null, null, -data.resumo.transferencias_saida, null],
      ['Total do período', null, null, null, null, null, null, null, data.resumo.total_periodo, null],
      ['Saldo final (realizado)', null, null, null, null, null, null, null, null, data.saldo_final],
    ];
    const periodoNome = periodo.modo === 'mes' ? de.slice(0, 7) : periodo.modo === 'tudo' ? 'todo o período' : `${de} a ${ate}`;
    exportarCSV(
      `Extrato de movimentações - ${empresa?.nome ?? ''} - ${periodoNome}`,
      ['Data', 'Descrição', 'Cliente / Fornecedor', 'Categoria', 'Conta', 'Tipo de receita', 'Situação', 'Vencimento', 'Valor (R$)', 'Saldo (R$)'],
      linhas,
      [
        `Extrato de movimentações · ${empresa?.nome ?? ''}`,
        `Período: ${dataBR(de)} a ${dataBR(ate)} · Conta: ${nomeConta} · Filtros: ${filtros} · Gerado em ${dataBR(hoje())}`,
      ],
    );
  };

  const alternar = (id: number) =>
    setSelecionados((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const cartoes = useMemo(
    () =>
      data
        ? ([
            ['receita', 'em_aberto', 'Receitas em aberto', data.resumo.receitas_aberto, 'entrada'],
            ['receita', 'realizado', 'Receitas realizadas', data.resumo.receitas_realizadas, 'entrada'],
            ['despesa', 'em_aberto', 'Despesas em aberto', data.resumo.despesas_aberto, 'saida'],
            ['despesa', 'realizado', 'Despesas realizadas', data.resumo.despesas_realizadas, 'saida'],
          ] as const)
        : [],
    [data],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Extrato de movimentações</h1>
          <p>Tudo o que entra e sai, num só lugar, com o saldo do caixa linha a linha.</p>
        </div>
        <div className="menu-acoes">
          <button className="btn btn-primary" onClick={() => setMenuNovo((m) => !m)} aria-haspopup="menu">
            <Icon name="mais" /> Novo <Icon name="seta" />
          </button>
          {menuNovo && (
            <div className="menu-lista" role="menu" onMouseLeave={() => setMenuNovo(false)}>
              <button role="menuitem" onClick={() => (setMenuNovo(false), setNovo({ tipo: 'receber' }))}>
                <span className="entrada">●</span> Receita
              </button>
              <button role="menuitem" onClick={() => (setMenuNovo(false), setNovo({ tipo: 'pagar' }))}>
                <span className="saida">●</span> Despesa
              </button>
              <button role="menuitem" onClick={() => (setMenuNovo(false), setTransferir(true))}>
                <span className="muted">⇄</span> Transferência entre contas
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <SeletorPeriodo valor={periodo} onChange={setPeriodo} />
          <input className="input grow" placeholder="Pesquisar no período (descrição, cliente, fornecedor, categoria ou valor)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select className="select input" value={conta} onChange={(e) => setConta(e.target.value)} aria-label="Conta">
            <option value="">Todas as contas</option>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>)}
          </select>
          <button className={'btn' + (maisFiltros ? ' btn-ativo' : '')} onClick={() => setMaisFiltros((m) => !m)}>
            <Icon name="filtro" /> Mais filtros
          </button>
          {filtrosAtivos > 0 && <button className="btn btn-ghost btn-sm" onClick={limpar}>Limpar filtros ({filtrosAtivos})</button>}
          <button className="btn" onClick={exportar} disabled={!data} title="Baixa o que está na tela (período e filtros) em planilha">
            <Icon name="upload" /> Exportar planilha
          </button>
        </div>
        {maisFiltros && (
          <div className="toolbar filtros-extra">
            <div className="field-inline">Tipo
              <FiltroChecklist opcoes={OPCOES_TIPO} desmarcados={extras.tipos} onChange={(v) => setExtras((x) => ({ ...x, tipos: v }))} />
            </div>
            <div className="field-inline">Situação
              <FiltroChecklist opcoes={OPCOES_SITUACAO} desmarcados={extras.situacoes} onChange={(v) => setExtras((x) => ({ ...x, situacoes: v }))} rotuloTodos="Todas" />
            </div>
            <div className="field-inline">Categorias
              <FiltroCategorias categorias={categorias} ocultas={ocultas} onChange={setOcultas} />
            </div>
            <MaisFiltros valor={extras} onChange={setExtras} />
          </div>
        )}

        {data && (
          <div className="cartoes-extrato com-transf">
            {cartoes.map(([t, s, label, valor, cor]) => (
              <button key={label} className={'cartao-extrato' + (cartaoAtivo(t, s) ? ' ativo' : '')} onClick={() => atalho(t, s)}>
                <span className="kpi-label">{label} (R$)</span>
                <span className={'cartao-valor num ' + cor}>{brl(valor)}</span>
              </button>
            ))}
            <button className={'cartao-extrato' + (soTransf ? ' ativo' : '')} onClick={atalhoTransf} title="Transferências entre contas próprias: não são receita nem despesa">
              <span className="kpi-label">Transferências (R$)</span>
              <span className="cartao-valor num">{/* Cada transferência tem saída numa conta e entrada noutra: o valor transferido é um lado só. */}
                {brl(Math.max(data.resumo.transferencias_entrada, data.resumo.transferencias_saida))}</span>
              <span className="small muted"><span className="entrada">↓ {brl(data.resumo.transferencias_entrada)}</span> · <span className="saida">↑ {brl(data.resumo.transferencias_saida)}</span></span>
            </button>
            <button className={'cartao-extrato total' + (!extras.tipos.size && !extras.situacoes.size ? ' ativo' : '')} onClick={() => setExtras((x) => ({ ...x, tipos: new Set(), situacoes: new Set() }))}>
              <span className="kpi-label">Total do período (R$)</span>
              <span className={'cartao-valor num ' + (data.resumo.total_periodo < 0 ? 'alerta' : '')}>{brl(data.resumo.total_periodo)}</span>
            </button>
          </div>
        )}

        {selecao.length > 0 && (
          <div className="toolbar" style={{ background: 'var(--primary-soft)' }}>
            <b>{selecao.length} selecionado(s)</b>
            <span className="num">{brl(selecao.reduce((s, i) => s + Math.abs(i.valor_extrato), 0))}</span>
            <button className="btn btn-primary btn-sm" onClick={() => setBaixa(selecao)}><Icon name="check" /> Baixar selecionados</button>
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
                    aria-label="Selecionar todos os em aberto"
                    checked={abertos.length > 0 && abertos.every((i) => selecionados.has(i.id))}
                    onChange={(e) => setSelecionados(new Set(e.target.checked ? abertos.map((i) => i.id) : []))}
                  />
                </th>
                <th>Data</th>
                <th>Resumo do lançamento</th>
                <th>Situação</th>
                <th className="r">Valor (R$)</th>
                <th className="r">Saldo (R$)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data && pagina === 0 && (
                <tr className="linha-saldo">
                  <td />
                  <td className="num">{dataBR(de)}</td>
                  <td colSpan={3} className="muted">Saldo anterior{conta ? ' da conta' : ' das contas'}</td>
                  <td className="r num"><b>{brl(data.saldo_inicial)}</b></td>
                  <td />
                </tr>
              )}
              {paginaItens.map((i) => {
                const pago = !!i.data_pagamento;
                const acoes = i.transferencia_id ? [{ label: 'Excluir transferência', onClick: () => excluir(i), perigo: true }] : [
                  ...(!pago ? [{ label: i.tipo === 'receber' ? 'Receber' : 'Pagar', onClick: () => setBaixa([i]) }] : []),
                  { label: 'Editar', onClick: () => editar(i) },
                  ...(pago ? [{ label: 'Estornar', onClick: () => estornar(i) }] : []),
                  { label: 'Excluir', onClick: () => excluir(i), perigo: true },
                ];
                return (
                  <tr key={i.id} className={selecionados.has(i.id) ? 'selecionado' : ''}>
                    <td>{!pago && <input type="checkbox" checked={selecionados.has(i.id)} onChange={() => alternar(i.id)} aria-label="Selecionar" />}</td>
                    <td className="num">{dataBR(i.data)}</td>
                    <td>
                      <div className="desc-principal">
                        {i.descricao}
                        {i.total_parcelas && <span className="muted small"> · {i.parcela}/{i.total_parcelas}</span>}
                      </div>
                      <div className="desc-sub">
                        {i.transferencia_id && <span className="tag-receita tag-transferencia">Transferência</span>}
                        {i.tipo_receita && <span className={'tag-receita tag-' + i.tipo_receita}>{NOME_TIPO_RECEITA[i.tipo_receita]}</span>}
                        {[i.categoria_nome ?? 'Sem categoria', i.contato, !conta && i.conta_nome].filter(Boolean).join(' · ')}
                        {i.extrato_id && ' · ✓ conciliado'}
                      </div>
                    </td>
                    <td>
                      <span className={'badge ' + SITUACAO[i.situacao].classe}>{SITUACAO[i.situacao].label}</span>
                      {!pago && <div className="desc-sub">venc. {dataBR(i.vencimento)}</div>}
                    </td>
                    <td className={'r num ' + (i.valor_extrato >= 0 ? 'entrada' : 'saida')}>{brl(i.valor_extrato)}</td>
                    <td className={'r num ' + (i.saldo !== null && i.saldo < 0 ? 'alerta' : '')}>{i.saldo === null ? <span className="muted">—</span> : brl(i.saldo)}</td>
                    <td className="acoes"><MenuAcoes itens={acoes} /></td>
                  </tr>
                );
              })}
            </tbody>
            {data && itens.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4}>{itens.length} lançamento(s)</td>
                  <td className="r num">{brl(itens.reduce((s, i) => s + i.valor_extrato, 0))}</td>
                  <td className="r num">{brl(data.saldo_final)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          {data && itens.length === 0 && <div className="vazio">Nenhuma movimentação neste período{filtrosAtivos ? ' com esses filtros' : ''}.</div>}
          {erro && <div className="vazio alerta">{erro}</div>}
        </div>
        {itens.length > OPCOES_POR_PAGINA[0] && (
          <div className="toolbar" style={{ justifyContent: 'flex-end', borderBottom: 0, borderTop: '1px solid var(--border)' }}>
            <label className="field-inline small muted" style={{ marginRight: 'auto' }}>
              <select className="select input" value={porPagina} onChange={(e) => mudarPorPagina(Number(e.target.value))} aria-label="Registros por página">
                {OPCOES_POR_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              Registros por página · {itens.length} no total
            </label>
            <button className="btn btn-sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
            <span className="muted small">Página {pagina + 1} de {totalPaginas}</span>
            <button className="btn btn-sm" disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        O saldo só muda com o que já foi pago ou recebido. Lançamentos em aberto aparecem na data de vencimento, sem alterar o saldo.
      </p>

      {novo && <LancamentoForm tipo={novo.tipo} lancamento={novo.lancamento} onClose={() => setNovo(null)} onSaved={concluir} />}
      {transferir && <TransferenciaModal onClose={() => setTransferir(false)} onSaved={() => (setTransferir(false), recarregar())} />}
      {baixa && <BaixaModal lancamentos={baixa as unknown as Lancamento[]} onClose={() => setBaixa(null)} onSaved={concluir} />}
    </>
  );
}
