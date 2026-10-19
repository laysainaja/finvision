import { useEffect, useRef, useState } from 'react';
import { api, qs, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR } from '../lib/format';
import { lerExtrato, type ItemExtrato } from '../lib/extrato';
import type { ExtratoItem, Sugestao } from '../types';
import { Field, Icon, Modal, StatusBadge, useAcao, useToast } from '../components/ui';

type Aba = 'pendente' | 'conciliado' | 'ignorado' | 'todos';

export function Conciliacao() {
  const { base, contas, versao, recarregar } = useEmpresa();
  const acao = useAcao();
  const ativas = contas.filter((c) => c.ativa);
  const [contaId, setContaId] = useState<number | ''>(ativas[0]?.id ?? '');
  const [aba, setAba] = useState<Aba>('pendente');
  const [selId, setSelId] = useState<number | null>(null);
  const [importacao, setImportacao] = useState<{ nome: string; itens: ItemExtrato[]; ignoradas: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (contaId === '' && ativas[0]) setContaId(ativas[0].id);
  }, [ativas, contaId]);

  const lista = useApi<ExtratoItem[]>(contaId ? `${base}/extrato${qs({ conta_id: contaId, status: aba === 'todos' ? null : aba, v: versao })}` : null);
  const itens = lista.data ?? [];
  const sel = itens.find((i) => i.id === selId) ?? null;
  const conta = contas.find((c) => c.id === contaId);

  // Mantém sempre um item selecionado: o anterior se ainda existir, senão o primeiro da lista.
  useEffect(() => {
    if (!lista.data) return;
    if (!lista.data.some((i) => i.id === selId)) setSelId(lista.data[0]?.id ?? null);
  }, [lista.data, selId]);

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
      const r = await api.post<{ inseridos: number; duplicados: number }>(`${base}/extrato/importar`, {
        conta_bancaria_id: contaId,
        itens: importacao.itens,
      });
      toast(`${r.inseridos} transação(ões) importada(s)` + (r.duplicados ? `, ${r.duplicados} já existiam` : '') + '.');
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
        <div style={{ display: 'flex', gap: 10 }}>
          <select className="select input" value={contaId} onChange={(e) => setContaId(Number(e.target.value))} aria-label="Conta bancária">
            {ativas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}{c.banco ? ` · ${c.banco}` : ''}
              </option>
            ))}
          </select>
          <button className="btn" onClick={autoConciliar} disabled={!conta?.pendentes_conciliacao}>
            <Icon name="raio" /> Conciliar automaticamente
          </button>
        </div>
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
        <div style={{ fontWeight: 600, marginTop: 6 }}>Arraste o extrato aqui ou clique para escolher</div>
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

      <div className="conc-layout">
        <div className="card">
          <div className="toolbar">
            <div className="tabs">
              {(
                [
                  ['pendente', 'Pendentes'],
                  ['conciliado', 'Conciliados'],
                  ['ignorado', 'Ignorados'],
                  ['todos', 'Todos'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={'tab' + (aba === v ? ' ativo' : '')} onClick={() => setAba(v)}>
                  {label}
                  {v === 'pendente' && conta?.pendentes_conciliacao ? ` (${conta.pendentes_conciliacao})` : ''}
                </button>
              ))}
            </div>
          </div>
          {itens.map((i) => (
            <div key={i.id} className={'conc-item' + (i.id === selId ? ' ativo' : '')} onClick={() => setSelId(i.id)}>
              <div className="num muted">{dataBR(i.data).slice(0, 5)}</div>
              <div style={{ minWidth: 0 }}>
                <div className="desc-principal" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.descricao || '(sem descrição)'}</div>
                <div className="desc-sub">
                  {i.lancamento_id ? <>✓ {i.lancamento_descricao}</> : i.ignorado ? 'Ignorado' : 'Pendente'}
                </div>
              </div>
              <div className={'num desc-principal ' + (i.valor > 0 ? 'entrada' : 'saida')}>{brl(i.valor)}</div>
            </div>
          ))}
          {lista.data && itens.length === 0 && (
            <div className="vazio">{aba === 'pendente' ? 'Nenhum movimento pendente nesta conta. 🎉' : 'Nenhum item aqui.'}</div>
          )}
        </div>

        <div className="conc-painel">{sel ? <PainelItem key={sel.id} item={sel} /> : <div className="card vazio">Selecione um movimento do extrato.</div>}</div>
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

function PainelItem({ item }: { item: ExtratoItem }) {
  const { base, categorias, recarregar } = useEmpresa();
  const acao = useAcao();
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [criando, setCriando] = useState(false);
  const [descricao, setDescricao] = useState(item.descricao ?? '');
  const [categoria, setCategoria] = useState('');
  const entrada = item.valor > 0;
  const pendente = !item.lancamento_id && !item.ignorado;

  useEffect(() => {
    const t = setTimeout(() => setQ(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const sugestoes = useApi<Sugestao[]>(pendente ? `${base}/extrato/${item.id}/sugestoes${qs({ q })}` : null);

  const executar = async (fn: () => Promise<unknown>, msg: string) => {
    if (await acao(fn, msg)) recarregar();
  };

  return (
    <div className="card">
      <div className="card-header" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="muted small">{entrada ? 'Entrada' : 'Saída'} no extrato · {dataBR(item.data)}</div>
          <h2 style={{ wordBreak: 'break-word' }}>{item.descricao || '(sem descrição)'}</h2>
        </div>
        <div className={'kpi-valor ' + (entrada ? 'entrada' : 'saida')}>{brl(item.valor)}</div>
      </div>

      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {item.lancamento_id && (
          <>
            <div className="sugestao forte">
              <div>
                <div className="muted small">Conciliado com</div>
                <div className="desc-principal">{item.lancamento_descricao}</div>
                <div className="desc-sub">
                  {item.lancamento_contato ?? '—'} · venc. {dataBR(item.lancamento_vencimento)} · {brl(item.lancamento_valor ?? 0)}
                </div>
              </div>
              <Icon name="check" />
            </div>
            <button className="btn" onClick={() => executar(() => api.post(`${base}/extrato/${item.id}/desfazer`), 'Conciliação desfeita.')}>
              <Icon name="desfazer" /> Desfazer conciliação
            </button>
            <div className="muted small">Se a baixa foi feita pela conciliação, o lançamento volta a ficar em aberto.</div>
          </>
        )}

        {!!item.ignorado && (
          <button className="btn" onClick={() => executar(() => api.post(`${base}/extrato/${item.id}/ignorar`, { ignorado: false }), 'Item restaurado.')}>
            <Icon name="desfazer" /> Voltar para pendentes
          </button>
        )}

        {pendente && (
          <>
            <div>
              <h3 style={{ marginBottom: 8 }}>Sugestões de {entrada ? 'contas a receber' : 'contas a pagar'}</h3>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <input className="input" style={{ width: '100%' }} placeholder="Buscar outro lançamento por descrição ou contato…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <div className="lista">
                {sugestoes.data?.map((s, idx) => (
                  <div key={s.id} className={'sugestao' + (!q && idx === 0 && s.valor_exato && s.dias <= 5 ? ' forte' : '')}>
                    <div style={{ minWidth: 0 }}>
                      <div className="desc-principal">{s.descricao}</div>
                      <div className="desc-sub">
                        {s.contato ?? '—'} · venc. {dataBR(s.vencimento)} · <span className="num">{brl(s.valor_pago ?? s.valor)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        <StatusBadge status={s.status} tipo={s.tipo} />
                        {s.valor_exato ? <span className="badge badge-pago">valor exato</span> : <span className="badge badge-aviso">valor diferente</span>}
                        <span className="badge badge-neutro">{s.dias === 0 ? 'mesma data' : `${s.dias} dia(s) de diferença`}</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => executar(() => api.post(`${base}/extrato/${item.id}/conciliar`, { lancamento_id: s.id }), 'Conciliado.')}
                    >
                      Conciliar
                    </button>
                  </div>
                ))}
                {sugestoes.data?.length === 0 && (
                  <div className="muted small">
                    {q ? 'Nada encontrado com essa busca.' : 'Nenhum lançamento com valor e data parecidos. Busque acima ou crie um novo lançamento.'}
                  </div>
                )}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              {!criando ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={() => setCriando(true)}>
                    <Icon name="mais" /> Criar lançamento a partir deste item
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => executar(() => api.post(`${base}/extrato/${item.id}/ignorar`, { ignorado: true }), 'Item ignorado.')}
                    title="Para transferências entre contas próprias, estornos do banco etc."
                  >
                    Ignorar
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="muted small">Útil para tarifas, rendimentos e outros movimentos que só aparecem no banco. O lançamento já nasce pago e conciliado.</div>
                  <Field label="Descrição">
                    <input className="input" value={descricao} onChange={(e) => setDescricao(e.target.value)} autoFocus />
                  </Field>
                  <Field label="Categoria">
                    <select className="select input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                      <option value="">Sem categoria</option>
                      {categorias.filter((c) => c.tipo === (entrada ? 'receita' : 'despesa')).map((c) => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                      ))}
                    </select>
                  </Field>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        executar(
                          () => api.post(`${base}/extrato/${item.id}/criar-lancamento`, { descricao, categoria_id: categoria || null }),
                          'Lançamento criado e conciliado.',
                        )
                      }
                    >
                      Criar e conciliar
                    </button>
                    <button className="btn" onClick={() => setCriando(false)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
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
