import { useEffect, useRef, useState } from 'react';
import { api, qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR } from '../lib/format';
import { lerExtrato, type ItemExtrato } from '../lib/extrato';
import type { ExtratoItem, Sugestao } from '../types';
import { Field, Icon, Modal, StatusBadge, useAcao, useToast } from '../components/ui';
import { ConciliacaoDias } from '../components/ConciliacaoDias';

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

type ModoLinha = 'sugestoes' | 'novo' | 'transferencia' | 'buscar';
const diaSemana = (iso: string) => {
  const d = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.charAt(0).toUpperCase() + d.slice(1);
};

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
  const encontrados = useApi<Sugestao[]>(pendente && modo === 'buscar' && q ? `${base}/extrato/${item.id}/sugestoes${qs({ q })}` : null);

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
  }, [escolhido]); // eslint-disable-line react-hooks/exhaustive-deps

  const conciliar = () => {
    if (modo === 'sugestoes' || modo === 'buscar') {
      if (!escolhido) return toast('Escolha um lançamento para conciliar.', true);
      return rodar(() => api.post(`${base}/extrato/${item.id}/conciliar`, { lancamento_id: escolhido, centro_custo: centro }), 'Conciliado.');
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
              <div className="muted small">Conciliado com</div>
              <div className="desc-principal">{item.lancamento_descricao}</div>
              <div className="desc-sub">{item.lancamento_contato ?? '—'} · venc. {dataBR(item.lancamento_vencimento)}</div>
            </div>
            <span className="num desc-principal">{brl(item.lancamento_valor ?? 0)}</span>
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
                <button className={'tab' + (modo === 'novo' ? ' ativo' : '')} onClick={() => setModo('novo')}>Novo lançamento</button>
                <button className={'tab' + (modo === 'transferencia' ? ' ativo' : '')} onClick={() => setModo('transferencia')}>Nova transferência</button>
              </div>
              <button className={'btn btn-ghost btn-sm' + (modo === 'buscar' ? ' btn-ativo' : '')} onClick={() => setModo('buscar')}>Buscar lançamento</button>
            </div>
            {modo === 'sugestoes' && listaEscolha(sugestoes.data, 'Nenhum lançamento deste mês com valor e data parecidos. Use Novo lançamento, Nova transferência ou Buscar.')}
            {modo === 'buscar' && (
              <>
                <input className="input" style={{ width: '100%' }} placeholder="Buscar lançamento do mês por descrição ou contato…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
                {q ? listaEscolha(encontrados.data, 'Nada encontrado com essa busca neste mês.') : <div className="muted small">Digite para buscar.</div>}
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
                      <input className="input" value={contato} onChange={(e) => setContato(e.target.value)} placeholder="Opcional" />
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
            {(modo === 'sugestoes' || modo === 'buscar') && escolhido && (
              <Field label="Centro de custo do lançamento escolhido">
                <input className="input" list="centros-custo-conc" value={centro} onChange={(e) => setCentro(e.target.value)} placeholder="Sem centro de custo" />
              </Field>
            )}
            {modo === 'transferencia' && <div className="muted small">Não entra na DRE nem no Forecast; o saldo das duas contas é ajustado.</div>}
          </>
        )}
      </div>
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
