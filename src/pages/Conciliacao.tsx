import { useEffect, useRef, useState } from 'react';
import { api, qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR } from '../lib/format';
import { lerExtrato, type ItemExtrato } from '../lib/extrato';
import type { Contato, ExtratoItem, MotivoDiferenca, Sugestao } from '../types';
import { Field, Icon, Modal, StatusBadge, useAcao, useToast } from '../components/ui';
import { ConciliacaoDias } from '../components/ConciliacaoDias';
import { AsaasConta } from '../components/AsaasConta';
import { LancamentoForm } from '../components/LancamentoForms';

type Aba = 'pendente' | 'conciliado' | 'ignorado' | 'todos';
const POR_VEZ = 15; // linhas por vez (cada uma busca as próprias sugestões)

export function Conciliacao() {
  const { base, contas, versao, recarregar } = useEmpresa();
  const acao = useAcao();
  const ativas = contas.filter((c) => c.ativa);
  const [contaId, setContaId] = useState<number | ''>(ativas[0]?.id ?? '');
  const [aba, setAba] = useState<Aba>('pendente');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [sentido, setSentido] = useState<'' | 'entrada' | 'saida'>('');
  const [limite, setLimite] = useState(POR_VEZ);
  const [importacao, setImportacao] = useState<{ nome: string; itens: ItemExtrato[]; ignoradas: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (contaId === '' && ativas[0]) setContaId(ativas[0].id);
  }, [ativas, contaId]);

  // Centros de custo já usados, para escolher na hora de conciliar (uma lista para todas as linhas).
  const opcoes = useApi<{ centros_custo: string[] }>(`${base}/movimentacoes/opcoes?v=${versao}`);
  // Clientes e fornecedores já cadastrados, para escolher ao criar o lançamento (ou digitar um novo).
  const clientes = useApi<Contato[]>(`${base}/contatos?tipo=cliente&v=${versao}`);
  const fornecedores = useApi<Contato[]>(`${base}/contatos?tipo=fornecedor&v=${versao}`);
  const lista = useApi<ExtratoItem[]>(contaId && aba !== 'todos' ? `${base}/extrato${qs({ conta_id: contaId, status: aba, v: versao })}` : null);
  const itens = lista.data ?? [];
  const conta = contas.find((c) => c.id === contaId);
  // Busca por descrição ou valor ("1326", "1.326,00"...), depois recebimentos/pagamentos.
  const termo = filtroTexto.trim().toLowerCase();
  const digitos = termo.replace(/[^\d]/g, '');
  const filtrados = itens.filter((i) => !termo || (i.descricao ?? '').toLowerCase().includes(termo) || (!!digitos && String(Math.abs(i.valor)).includes(digitos)));
  const visiveis = filtrados.filter((i) => !sentido || (sentido === 'entrada' ? i.valor > 0 : i.valor < 0));

  const abrirArquivo = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    try {
      const r = await lerExtrato(arquivo);
      if (!r.itens.length) return toast('Nenhuma transação encontrada. Use um arquivo OFX ou CSV com data, descrição e valor.', true);
      setImportacao({ nome: arquivo.name, ...r });
    } catch (e) {
      toast('Não foi possível ler o arquivo: ' + (e as Error).message, true);
    }
  };

  const importar = async () => {
    if (!importacao) return;
    await acao(async () => {
      const r = await api.post<{ inseridos: number; duplicados: number; ja_lancados: number }>(`${base}/extrato/importar`, {
        conta_bancaria_id: contaId,
        itens: importacao.itens,
      });
      toast(`${r.inseridos} transação(ões) importada(s)` + (r.duplicados ? `, ${r.duplicados} já estavam no extrato` : '')
        + (r.ja_lancados ? `. ${r.ja_lancados} já estavam lançadas e foram conciliadas sozinhas; ficam ${r.inseridos - r.ja_lancados} para conciliar` : '') + '.');
    });
    setImportacao(null);
    setAba('pendente');
    recarregar();
  };

  const autoConciliar = async () => {
    await acao(async () => {
      const r = await api.post<{ conciliados: number; analisados: number }>(`${base}/extrato/auto-conciliar`, { conta_bancaria_id: contaId });
      toast(
        r.conciliados
          ? `${r.conciliados} de ${r.analisados} item(ns) conciliado(s) automaticamente.`
          : 'Nenhum item com correspondência segura. Concilie os restantes manualmente.',
      );
    });
    recarregar();
  };

  if (!contas.length) {
    return (
      <div className="card vazio">
        Cadastre uma conta bancária em <a href="#/cadastros">Cadastros</a> para importar extratos.
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Conciliação bancária</h1>
          <p>Importe o extrato do banco e confira cada movimento com as contas a pagar e a receber.</p>
        </div>
        <button className="btn" onClick={autoConciliar} disabled={!conta?.pendentes_conciliacao}>
          <Icon name="raio" /> Conciliar automaticamente
        </button>
      </div>

      {/* Um banco por aba: fica claro em qual conta o extrato vai entrar. */}
      <div className="bancos-abas" role="tablist" aria-label="Conta bancária">
        {ativas.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === contaId} className={'banco-aba' + (c.id === contaId ? ' ativo' : '')} onClick={() => setContaId(c.id)}>
            <span className="banco-aba-nome">{c.nome}</span>
            {c.banco && <span className="small muted">{c.banco}</span>}
            <span className="banco-aba-rodape">
              <span className="num">{brl(c.saldo_atual)}</span>
              {c.pendentes_conciliacao > 0 && <span className="badge badge-aberto">{c.pendentes_conciliacao} pendente(s)</span>}
            </span>
          </button>
        ))}
      </div>

      {contaId !== '' && <AsaasConta key={contaId} contaId={contaId} contaNome={conta?.nome ?? ''} />}

      <div
        className={'drop' + (arrastando ? ' ativo' : '')}
        onClick={() => inputArquivo.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setArrastando(true))}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          abrirArquivo(e.dataTransfer.files[0]);
        }}
      >
        <Icon name="upload" size={22} />
        <div style={{ fontWeight: 600, marginTop: 6 }}>Arraste aqui o extrato do <span className="destaque-conta">{conta?.nome}</span> ou clique para escolher</div>
        <div className="small">OFX (recomendado) ou CSV exportado do internet banking · importar de novo não duplica</div>
        <input
          ref={inputArquivo}
          type="file"
          accept=".ofx,.csv,.txt"
          hidden
          onChange={(e) => {
            abrirArquivo(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <div className="card">
        <div className="toolbar">
          {aba !== 'todos' && <input className="input grow" placeholder="Pesquise o lançamento bancário (descrição ou valor)" value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)} />}
          <div className="tabs">
            {(
              [
                ['pendente', 'Pendentes'],
                ['conciliado', 'Conciliados'],
                ['ignorado', 'Ignorados'],
                ['todos', 'Todos'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} className={'tab' + (aba === v ? ' ativo' : '')} onClick={() => (setAba(v), setLimite(POR_VEZ))}>
                {label}
                {v === 'pendente' && conta?.pendentes_conciliacao ? ` (${conta.pendentes_conciliacao})` : ''}
              </button>
            ))}
          </div>
        </div>
        {aba === 'todos' && contaId !== '' && <ConciliacaoDias key={contaId} contaId={contaId} contaNome={conta?.nome ?? 'banco'} />}
        {aba !== 'todos' && <>
        <div className="conc-contadores">
          {(
            [
              ['', 'Todos', filtrados.length, ''],
              ['entrada', 'Recebimentos', filtrados.filter((i) => i.valor > 0).length, 'entrada'],
              ['saida', 'Pagamentos', filtrados.filter((i) => i.valor < 0).length, 'saida'],
            ] as const
          ).map(([v, label, n, cor]) => (
            <button key={label} className={'conc-contador' + (sentido === v ? ' ativo' : '')} onClick={() => (setSentido(v), setLimite(POR_VEZ))}>
              <span>{label}</span>
              <b className={'num ' + cor}>{n}</b>
            </button>
          ))}
        </div>
        {visiveis.length > 0 && (
          <div className="conc-cabecalho">
            <h3>Lançamentos do banco</h3>
            <span />
            <h3>Lançamentos do FinVision</h3>
          </div>
        )}
        <datalist id="centros-custo-conc">{opcoes.data?.centros_custo.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="clientes-conc">{clientes.data?.map((c) => <option key={c.id} value={c.nome} />)}</datalist>
        <datalist id="fornecedores-conc">{fornecedores.data?.map((c) => <option key={c.id} value={c.nome} />)}</datalist>
        {visiveis.slice(0, limite).map((i) => <LinhaConciliacao key={i.id} item={i} />)}
        {lista.data && visiveis.length === 0 && (
          <div className="vazio">{filtroTexto || sentido ? 'Nenhum movimento com esse filtro.' : aba === 'pendente' ? 'Nenhum movimento pendente nesta conta. 🎉' : 'Nenhum item aqui.'}</div>
        )}
        {visiveis.length > limite && (
          <div className="toolbar" style={{ justifyContent: 'center', borderBottom: 0 }}>
            <button className="btn" onClick={() => setLimite((l) => l + POR_VEZ)}>Mostrar mais {Math.min(POR_VEZ, visiveis.length - limite)} de {visiveis.length - limite}</button>
          </div>
        )}
        </>}
      </div>

      {importacao && (
        <PreviaImportacao
          {...importacao}
          contaNome={conta ? `${conta.nome}${conta.banco ? ' · ' + conta.banco : ''}` : ''}
          onClose={() => setImportacao(null)}
          onConfirm={importar}
        />
      )}
    </>
  );
}

type ModoLinha = 'sugestoes' | 'novo' | 'transferencia' | 'buscar' | 'varios';
const diaSemana = (iso: string) => {
  const d = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.charAt(0).toUpperCase() + d.slice(1);
};

const NOME_MOTIVO: Record<MotivoDiferenca, string> = { multa: 'Multa', juros: 'Juros', desconto: 'Desconto', parcial: 'Pagamento parcial (abater deste lançamento)', valor: 'O valor total mudou' };
const MOTIVOS: Record<'maior' | 'menor', MotivoDiferenca[]> = { maior: ['multa', 'juros', 'valor'], menor: ['parcial', 'desconto', 'valor'] };
const motivosPara = (diferenca: number) => MOTIVOS[diferenca > 0 ? 'maior' : 'menor'];
const NOME_CURTO: Record<MotivoDiferenca, string> = { multa: 'multa', juros: 'juros', desconto: 'desconto', parcial: 'parcial, restante em aberto', valor: 'valor mudou' };
// "1.234,56" → 123456 centavos; NaN quando não é número.
const paraCentavos = (s: string) => (s.trim() ? Math.round(Number(s.replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.')) * 100) : NaN);

/** Uma linha da conciliação, como no Conta Azul: o movimento do banco à esquerda, o botão no meio e o FinVision à direita. */
function LinhaConciliacao({ item }: { item: ExtratoItem }) {
  const { base, categorias, contas, recarregar } = useEmpresa();
  const acao = useAcao();
  const toast = useToast();
  const entrada = item.valor > 0;
  const pendente = !item.lancamento_id && !item.ignorado;
  const outras = contas.filter((c) => c.ativa && c.id !== item.conta_bancaria_id);

  const [modo, setModo] = useState<ModoLinha>('sugestoes');
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [motivo, setMotivo] = useState<MotivoDiferenca | null>(null);
  const [editando, setEditando] = useState<Sugestao | null>(null);
  const [varios, setVarios] = useState<Set<number>>(new Set());
  const [buscaVarios, setBuscaVarios] = useState('');
  // Vários: valor pago de cada lançamento escolhido (texto digitado) e o motivo quando é diferente do lançamento.
  const [pagosVarios, setPagosVarios] = useState<Record<number, string>>({});
  const [motivosVarios, setMotivosVarios] = useState<Record<number, MotivoDiferenca>>({});
  const [descricao, setDescricao] = useState(item.descricao ?? '');
  const [categoria, setCategoria] = useState('');
  const [contato, setContato] = useState('');
  const [centro, setCentro] = useState('');
  const [outraConta, setOutraConta] = useState<number | ''>(outras[0]?.id ?? '');
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const sugestoes = useApi<Sugestao[]>(pendente ? `${base}/extrato/${item.id}/sugestoes` : null);
  const encontrados = useApi<Sugestao[]>(pendente && modo === 'buscar' ? `${base}/extrato/${item.id}/sugestoes${q ? qs({ q }) : '?todos=1'}` : null);
  const abertos = useApi<Sugestao[]>(pendente && modo === 'varios' ? `${base}/extrato/${item.id}/sugestoes?todos=1` : null);
  const escolhidosVarios = (abertos.data ?? []).filter((l) => varios.has(l.id));
  const pagoDe = (l: Sugestao) => (pagosVarios[l.id] === undefined ? l.valor : paraCentavos(pagosVarios[l.id]));
  const somaVarios = escolhidosVarios.reduce((s, l) => s + (Number.isFinite(pagoDe(l)) ? pagoDe(l) : 0), 0);
  const faltaVarios = Math.abs(item.valor) - somaVarios;
  const termoVarios = buscaVarios.trim().toLowerCase();
  const abertosVisiveis = (abertos.data ?? []).filter((l) => !termoVarios || `${l.descricao} ${l.contato ?? ''}`.toLowerCase().includes(termoVarios) || varios.has(l.id));
  const alternarVarios = (id: number) => {
    setVarios((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    setPagosVarios((p) => { const n = { ...p }; delete n[id]; return n; });
    setMotivosVarios((m) => { const n = { ...m }; delete n[id]; return n; });
  };

  // Sem sugestão, já abre em "Novo lançamento"; com sugestão forte, ela vem marcada.
  useEffect(() => {
    if (!sugestoes.data) return;
    const forte = sugestoes.data.find((s) => s.valor_exato && s.dias <= 5);
    if (!sugestoes.data.length) setModo((m) => (m === 'sugestoes' ? 'novo' : m));
    else setEscolhido((e) => e ?? forte?.id ?? null);
  }, [sugestoes.data]);

  const rodar = async (fn: () => Promise<unknown>, msg?: string) => {
    setEnviando(true);
    const ok = await acao(fn, msg);
    setEnviando(false);
    if (ok) recarregar();
  };

  // Ao escolher um lançamento, o centro de custo dele já vem preenchido (dá para trocar antes de conciliar).
  useEffect(() => {
    const l = [...(sugestoes.data ?? []), ...(encontrados.data ?? [])].find((s) => s.id === escolhido);
    if (l) setCentro(l.centro_custo ?? '');
    setMotivo(null);
  }, [escolhido]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lançamento escolhido com valor diferente do banco: precisa dizer o que é a diferença antes de conciliar.
  const selecionado = [...(sugestoes.data ?? []), ...(encontrados.data ?? [])].find((s) => s.id === escolhido);
  const diferenca = selecionado && (modo === 'sugestoes' || modo === 'buscar') ? Math.abs(item.valor) - (selecionado.valor_pago ?? selecionado.valor) : 0;
  const motivosPossiveis = motivosPara(diferenca);

  const conciliar = () => {
    if (modo === 'varios') {
      if (varios.size < 2) return toast('Escolha pelo menos dois lançamentos.', true);
      for (const l of escolhidosVarios) {
        const pago = pagoDe(l);
        if (!Number.isFinite(pago) || pago <= 0) return toast(`Valor pago inválido em "${l.descricao}".`, true);
        if (pago !== l.valor && !motivosPara(pago - l.valor).includes(motivosVarios[l.id])) return toast(`"${l.descricao}" foi pago por outro valor: escolha o motivo da diferença.`, true);
      }
      if (faltaVarios !== 0) return toast('A soma dos valores pagos precisa ser igual ao valor do banco.', true);
      return rodar(() => api.post(`${base}/extrato/${item.id}/conciliar-varios`, {
        itens: escolhidosVarios.map((l) => ({ id: l.id, valor_pago: pagoDe(l), ...(pagoDe(l) !== l.valor && { motivo: motivosVarios[l.id] }) })),
      }), `${varios.size} lançamentos conciliados.`);
    }
    if (modo === 'sugestoes' || modo === 'buscar') {
      if (!escolhido) return toast('Escolha um lançamento para conciliar.', true);
      if (diferenca !== 0 && !motivo) return toast('O valor é diferente: informe o que é a diferença antes de conciliar.', true);
      return rodar(() => api.post(`${base}/extrato/${item.id}/conciliar`, { lancamento_id: escolhido, centro_custo: centro, ...(diferenca !== 0 && { motivo_diferenca: motivo }) }), 'Conciliado.');
    }
    if (modo === 'novo') {
      if (!descricao.trim()) return toast('Informe a descrição.', true);
      return rodar(() => api.post(`${base}/extrato/${item.id}/criar-lancamento`, { descricao, categoria_id: categoria || null, contato: contato || null, centro_custo: centro || null }), 'Lançamento criado e conciliado.');
    }
    if (!outraConta) return toast('Escolha a outra conta da transferência.', true);
    const nome = outras.find((c) => c.id === outraConta)?.nome;
    return rodar(async () => {
      const r = await api.post<{ outra_conta_conciliada: boolean }>(`${base}/extrato/${item.id}/criar-transferencia`, { descricao, outra_conta_id: outraConta });
      toast(r.outra_conta_conciliada ? `Transferência conciliada aqui e no extrato da ${nome}.` : `Transferência criada e conciliada. Na ${nome} ela já aparece como paga.`);
    });
  };

  const listaEscolha = (lista: Sugestao[] | null | undefined, vazio: string) => (
    <div className="lista">
      {lista?.map((s) => (
        <label key={s.id} className={'sugestao conc-opcao' + (escolhido === s.id ? ' forte' : '')}>
          <input type="radio" name={`conc-${item.id}`} checked={escolhido === s.id} onChange={() => setEscolhido(s.id)} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="desc-principal">{s.descricao}</div>
            <div className="desc-sub">{s.contato ?? '—'} · {s.data_pagamento ? `pago ${dataBR(s.data_pagamento)}` : `venc. ${dataBR(s.vencimento)}`}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              <StatusBadge status={s.status} tipo={s.tipo} />
              {s.valor_exato ? <span className="badge badge-pago">valor exato</span> : <span className="badge badge-aviso">valor diferente</span>}
              <span className="badge badge-neutro">{s.dias === 0 ? 'mesma data' : `${s.dias} dia(s) de diferença`}</span>
            </div>
          </div>
          <span className="num desc-principal">{brl(s.valor_pago ?? s.valor)}</span>
          <button className="btn btn-sm btn-ghost" title="Editar este lançamento" aria-label="Editar" onClick={(e) => (e.preventDefault(), setEditando(s))}><Icon name="editar" /></button>
        </label>
      ))}
      {lista && lista.length === 0 && <div className="muted small">{vazio}</div>}
    </div>
  );

  return (
    <div className="conc-linha">
      <div className={'conc-banco' + (item.lancamento_id ? ' ok' : '')}>
        <div className="conc-banco-topo">
          <span><b className="num">{dataBR(item.data)}</b> <span className="muted">{diaSemana(item.data)}</span></span>
          <b className={'num ' + (entrada ? 'entrada' : 'saida')}>{brl(item.valor)}</b>
        </div>
        <div className="conc-banco-desc">{item.descricao || '(sem descrição)'}</div>
        <div className="conc-banco-rodape">
          <span className={'badge ' + (item.lancamento_id ? 'badge-pago' : item.ignorado ? 'badge-neutro' : 'badge-aberto')}>
            {item.lancamento_id ? 'Conciliado' : item.ignorado ? 'Ignorado' : entrada ? 'Recebimento' : 'Pagamento'}
          </span>
          {pendente && (
            <button className="btn btn-sm" title="Para estornos do banco e movimentos que não entram no financeiro" disabled={enviando}
              onClick={() => rodar(() => api.post(`${base}/extrato/${item.id}/ignorar`, { ignorado: true }), 'Item ignorado.')}>Ignorar</button>
          )}
        </div>
      </div>

      <div className="conc-meio">
        {pendente && <button className="btn btn-primary" onClick={conciliar} disabled={enviando}>Conciliar</button>}
        {!!item.lancamento_id && (
          <button className="btn" disabled={enviando} title="Se a baixa foi feita pela conciliação, o lançamento volta a ficar em aberto. Transferência criada aqui é desfeita nas duas contas."
            onClick={() => rodar(() => api.post(`${base}/extrato/${item.id}/desfazer`), 'Conciliação desfeita.')}><Icon name="desfazer" /> Desfazer</button>
        )}
        {!!item.ignorado && (
          <button className="btn" disabled={enviando} onClick={() => rodar(() => api.post(`${base}/extrato/${item.id}/ignorar`, { ignorado: false }), 'Item restaurado.')}>
            <Icon name="desfazer" /> Restaurar
          </button>
        )}
      </div>

      <div className="conc-fv">
        {item.lancamento_id ? (
          <div className="sugestao forte">
            <div style={{ minWidth: 0 }}>
              <div className="muted small">Conciliado com{item.lote ? ` ${item.lote.length} lançamentos` : ''}</div>
              {item.lote ? item.lote.map((m) => (
                <div key={m.id} className="desc-sub">
                  {m.descricao}{m.contato ? ` · ${m.contato}` : ''} · venc. {dataBR(m.vencimento)} · <span className="num">{brl(m.valor)}</span>
                  {m.ajuste_motivo && <> · {NOME_CURTO[m.ajuste_motivo]} <span className="num">{brl(Math.abs(m.ajuste_valor ?? 0))}</span></>}
                </div>
              )) : <>
                <div className="desc-principal">{item.lancamento_descricao}</div>
                <div className="desc-sub">{item.lancamento_contato ?? '—'} · venc. {dataBR(item.lancamento_vencimento)}</div>
              </>}
              {item.ajuste_motivo && (
                <div className="desc-sub">
                  {item.ajuste_motivo === 'parcial' ? 'Pagamento parcial, restante em aberto' : NOME_MOTIVO[item.ajuste_motivo]}: {brl(Math.abs(item.ajuste_valor ?? 0))}
                </div>
              )}
            </div>
            <span className="num desc-principal">{brl(item.lote ? Math.abs(item.valor) : item.lancamento_valor ?? 0)}</span>
          </div>
        ) : item.ignorado ? (
          <div className="muted small" style={{ padding: 12 }}>Movimento ignorado: não entra no financeiro.</div>
        ) : (
          <>
            <div className="conc-fv-abas">
              <div className="tabs">
                <button className={'tab' + (modo === 'sugestoes' ? ' ativo' : '')} onClick={() => setModo('sugestoes')}>
                  Sugestões{sugestoes.data ? ` (${sugestoes.data.length})` : ''}
                </button>
                <button className={'tab' + (modo === 'varios' ? ' ativo' : '')} onClick={() => setModo('varios')}>Vários lançamentos</button>
                <button className={'tab' + (modo === 'novo' ? ' ativo' : '')} onClick={() => setModo('novo')}>Novo lançamento</button>
                <button className={'tab' + (modo === 'transferencia' ? ' ativo' : '')} onClick={() => setModo('transferencia')}>Nova transferência</button>
              </div>
              <button className={'btn btn-ghost btn-sm' + (modo === 'buscar' ? ' btn-ativo' : '')} onClick={() => setModo('buscar')}>Buscar lançamento</button>
            </div>
            {modo === 'sugestoes' && listaEscolha(sugestoes.data, 'Nenhum lançamento deste mês com valor e data parecidos. Use Novo lançamento, Nova transferência ou Buscar.')}
            {modo === 'buscar' && (
              <>
                <input className="input" style={{ width: '100%' }} placeholder="Filtrar os lançamentos do mês por descrição ou contato…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
                {listaEscolha(encontrados.data, q ? 'Nada encontrado com essa busca neste mês.' : 'Nenhum lançamento em aberto neste mês.')}
              </>
            )}
            {modo === 'varios' && (
              <>
                <input className="input" style={{ width: '100%' }} placeholder="Filtrar por descrição ou contato…" value={buscaVarios} onChange={(e) => setBuscaVarios(e.target.value)} />
                <div className="lista conc-varios">
                  {abertosVisiveis.map((l) => {
                    const pago = pagoDe(l);
                    const dif = Number.isFinite(pago) ? pago - l.valor : 0;
                    return (
                      <div key={l.id}>
                        <label className={'sugestao conc-opcao' + (varios.has(l.id) ? ' forte' : '')}>
                          <input type="checkbox" checked={varios.has(l.id)} onChange={() => alternarVarios(l.id)} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="desc-principal">{l.descricao}</div>
                            <div className="desc-sub">{l.contato ?? '—'} · venc. {dataBR(l.vencimento)}</div>
                          </div>
                          <span className="num desc-principal">{brl(l.valor)}</span>
                        </label>
                        {varios.has(l.id) && (
                          <div className="conc-ajuste">
                            <span className="muted">Valor pago</span>
                            <input className="input num" inputMode="decimal" aria-label={`Valor pago de ${l.descricao}`}
                              value={pagosVarios[l.id] ?? (l.valor / 100).toFixed(2).replace('.', ',')}
                              onChange={(e) => setPagosVarios((p) => ({ ...p, [l.id]: e.target.value }))} />
                            {!Number.isFinite(pago) && <span className="alerta">valor inválido</span>}
                            {dif !== 0 && (
                              <select className="select input" aria-label={`Motivo da diferença de ${l.descricao}`}
                                value={motivosVarios[l.id] && motivosPara(dif).includes(motivosVarios[l.id]) ? motivosVarios[l.id] : ''}
                                onChange={(e) => setMotivosVarios((m) => ({ ...m, [l.id]: e.target.value as MotivoDiferenca }))}>
                                <option value="">{dif > 0 ? `+${brl(dif)}: o que é?` : `−${brl(-dif)}: o que é?`}</option>
                                {motivosPara(dif).map((m) => <option key={m} value={m}>{NOME_MOTIVO[m]}</option>)}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {abertos.data && abertosVisiveis.length === 0 && <div className="muted small">Nenhum lançamento em aberto neste mês.</div>}
                </div>
                <div className={'small ' + (varios.size && faltaVarios !== 0 ? 'alerta' : 'muted')}>
                  {varios.size} escolhido(s), valor pago <b className="num">{brl(somaVarios)}</b> · banco <b className="num">{brl(Math.abs(item.valor))}</b>
                  {faltaVarios === 0 ? ' · valores iguais' : ` · ${faltaVarios > 0 ? 'faltam' : 'sobram'} ${brl(Math.abs(faltaVarios))}`}
                </div>
                <div className="muted small">Teve multa, juros, desconto, pagamento parcial ou o valor mudou? Altere o valor pago do lançamento e escolha o motivo.</div>
              </>
            )}
            {(modo === 'novo' || modo === 'transferencia') && (
              <div className="form-grid">
                <Field label="Descrição *">
                  <input className="input" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
                </Field>
                {modo === 'novo' ? (
                  <>
                    <Field label="Categoria">
                      <select className="select input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                        <option value="">Sem categoria</option>
                        {categorias.filter((c) => c.tipo === (entrada ? 'receita' : 'despesa')).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </Field>
                    <Field label={entrada ? 'Cliente' : 'Fornecedor'}>
                      <input className="input" list={entrada ? 'clientes-conc' : 'fornecedores-conc'} value={contato} onChange={(e) => setContato(e.target.value)} placeholder="Escolha ou digite um novo" />
                    </Field>
                    <Field label="Centro de custo">
                      <input className="input" list="centros-custo-conc" value={centro} onChange={(e) => setCentro(e.target.value)} placeholder="Opcional" />
                    </Field>
                  </>
                ) : (
                  <Field label={entrada ? 'Veio da conta' : 'Foi para a conta'}>
                    <select className="select input" value={outraConta} onChange={(e) => setOutraConta(e.target.value === '' ? '' : Number(e.target.value))}>
                      <option value="">Selecione…</option>
                      {outras.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            )}
            {diferenca !== 0 && selecionado && (
              <fieldset className="conc-diferenca">
                <legend>
                  O banco tem <b className="num">{brl(Math.abs(item.valor))}</b> e o lançamento <b className="num">{brl(selecionado.valor_pago ?? selecionado.valor)}</b>.
                  {' '}O que é a diferença de <b className="num">{brl(Math.abs(diferenca))}</b>?
                </legend>
                {motivosPossiveis.map((m) => (
                  <label key={m} className="check">
                    <input type="radio" name={`motivo-${item.id}`} checked={motivo === m} onChange={() => setMotivo(m)} /> {NOME_MOTIVO[m]}
                  </label>
                ))}
                {motivo === 'valor' && <div className="muted small">O lançamento passa a ser de {brl(Math.abs(item.valor))}.</div>}
                {motivo === 'parcial' && <div className="muted small">Baixa de {brl(Math.abs(item.valor))}; {brl(Math.abs(diferenca))} continuam em aberto, com o mesmo vencimento.</div>}
              </fieldset>
            )}
            {(modo === 'sugestoes' || modo === 'buscar') && escolhido && (
              <Field label="Centro de custo do lançamento escolhido">
                <input className="input" list="centros-custo-conc" value={centro} onChange={(e) => setCentro(e.target.value)} placeholder="Sem centro de custo" />
              </Field>
            )}
            {modo === 'transferencia' && <div className="muted small">Não entra na DRE nem no Forecast; o saldo das duas contas é ajustado.</div>}
          </>
        )}
      </div>
      {editando && (
        <LancamentoForm tipo={editando.tipo} lancamento={editando} onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); sugestoes.recarregar(); encontrados.recarregar(); setMotivo(null); recarregar(); }} />
      )}
    </div>
  );
}

function PreviaImportacao({
  nome,
  itens,
  ignoradas,
  contaNome,
  onClose,
  onConfirm,
}: {
  nome: string;
  itens: ItemExtrato[];
  ignoradas: number;
  contaNome: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const datas = itens.map((i) => i.data).sort();
  const entradas = itens.filter((i) => i.valor > 0).reduce((s, i) => s + i.valor, 0);
  const saidas = itens.filter((i) => i.valor < 0).reduce((s, i) => s + i.valor, 0);

  return (
    <Modal
      titulo="Importar extrato"
      onClose={onClose}
      largura={640}
      rodape={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={enviando} onClick={() => (setEnviando(true), onConfirm())}>
            Importar {itens.length} transações
          </button>
        </>
      }
    >
      <div>
        <div className="aviso-box" style={{ marginBottom: 8 }}>
          <Icon name="alerta" /> Este extrato vai entrar na conta <b>{contaNome}</b>. Confira se é o banco certo antes de importar.
        </div>
        <b>{nome}</b> → <b>{contaNome}</b>
        <div className="muted">
          De {dataBR(datas[0])} a {dataBR(datas[datas.length - 1])} · {itens.length} transações
          {ignoradas > 0 && ` · ${ignoradas} linha(s) ignorada(s) (saldos/cabeçalhos)`}
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card kpi">
          <div className="kpi-label">Entradas</div>
          <div className="kpi-valor entrada">{brl(entradas)}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Saídas</div>
          <div className="kpi-valor saida">{brl(saidas)}</div>
        </div>
      </div>
      <div className="card table-wrap" style={{ maxHeight: 260 }}>
        <table>
          <tbody>
            {itens.slice(0, 50).map((i) => (
              <tr key={i.fitid}>
                <td className="num muted">{dataBR(i.data)}</td>
                <td>{i.descricao}</td>
                <td className={'r num ' + (i.valor > 0 ? 'entrada' : 'saida')}>{brl(i.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {itens.length > 50 && <div className="muted small">…e mais {itens.length - 50}.</div>}
    </Modal>
  );
}
