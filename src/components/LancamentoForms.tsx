import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR, hoje, addMeses } from '../lib/format';
import type { Contato, Lancamento, TipoLancamento, TipoReceita } from '../types';
import { Field, Modal, MoneyInput, useToast } from './ui';

export const FORMAS_PAGAMENTO = ['Pix', 'Boleto bancário', 'Transferência bancária', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro', 'Débito automático', 'Cheque', 'Outro'];

export const NOME_TIPO = {
  pagar: { singular: 'conta a pagar', acao: 'Pagar', feito: 'Pago', contato: 'Fornecedor', data: 'Data do pagamento' },
  receber: { singular: 'conta a receber', acao: 'Receber', feito: 'Recebido', contato: 'Cliente', data: 'Data do recebimento' },
} as const;

function useSalvar() {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = async (fn: () => Promise<unknown>) => {
    setSalvando(true);
    setErro(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setSalvando(false);
    }
  };
  return { salvando, erro, salvar };
}

export function LancamentoForm({
  tipo,
  lancamento,
  contatos = [],
  onClose,
  onSaved,
}: {
  tipo: TipoLancamento;
  lancamento?: Lancamento;
  contatos?: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { base, categorias, contas } = useEmpresa();
  const toast = useToast();
  const nomes = NOME_TIPO[tipo];
  const editando = !!lancamento;
  // Sugestões do cadastro de clientes/fornecedores; um nome novo é cadastrado sozinho ao salvar.
  const centros = useApi<{ centros_custo: string[] }>(`${base}/movimentacoes/opcoes`);
  const cadastro = useApi<Contato[]>(`${base}/contatos?tipo=${tipo === 'pagar' ? 'fornecedor' : 'cliente'}`);
  const sugestoes = [...new Set([...(cadastro.data?.map((c) => c.nome) ?? []), ...contatos])].sort((a, b) => a.localeCompare(b));
  const [f, setF] = useState({
    tipo_receita: (lancamento?.tipo_receita ?? 'auto') as TipoReceita | 'auto',
    descricao: lancamento?.descricao ?? '',
    contato: lancamento?.contato ?? '',
    categoria_id: lancamento?.categoria_id ?? '',
    conta_bancaria_id: lancamento?.conta_bancaria_id ?? contas.find((c) => c.ativa)?.id ?? '',
    valor: lancamento?.valor ?? 0,
    vencimento: lancamento?.vencimento ?? hoje(),
    documento: lancamento?.documento ?? '',
    observacao: lancamento?.observacao ?? '',
    centro_custo: lancamento?.centro_custo ?? '',
    forma_pagamento: lancamento?.forma_pagamento ?? '',
    data_prevista: lancamento?.data_prevista ?? '',
    parcelas: 1,
    repeticao: 'parcelar' as 'parcelar' | 'repetir',
    jaPago: false,
    data_pagamento: hoje(),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // Editando uma parcela/repetição: aplicar só nela, nela e nas próximas, ou em todas do grupo.
  const emGrupo = editando && !!lancamento.grupo_parcelas && (lancamento.total_parcelas ?? 0) > 1;
  const [escopo, setEscopo] = useState<'este' | 'proximos' | 'todos'>('este');
  const { salvando, erro, salvar } = useSalvar();
  const cats = categorias.filter((c) => c.tipo === (tipo === 'pagar' ? 'despesa' : 'receita'));

  const enviar = async () => {
    const corpo = {
      tipo,
      descricao: f.descricao,
      contato: f.contato,
      tipo_receita: tipo === 'receber' ? f.tipo_receita : undefined,
      categoria_id: f.categoria_id || null,
      conta_bancaria_id: f.conta_bancaria_id || null,
      valor: f.valor,
      vencimento: f.vencimento,
      documento: f.documento,
      observacao: f.observacao,
      centro_custo: f.centro_custo,
      forma_pagamento: f.forma_pagamento || null,
      data_prevista: f.data_prevista || null,
      ...(!editando && {
        parcelas: f.parcelas,
        repeticao: f.repeticao,
        pagamento: f.jaPago ? { data_pagamento: f.data_pagamento } : undefined,
      }),
    };
    let outras = 0;
    const ok = await salvar(async () => {
      if (!editando) return api.post(`${base}/lancamentos`, corpo);
      const r = await api.put<{ outras_atualizadas?: number }>(`${base}/lancamentos/${lancamento.id}`, { ...corpo, escopo: emGrupo ? escopo : 'este' });
      outras = r.outras_atualizadas ?? 0;
    });
    if (ok) {
      toast(editando ? (outras ? `Lançamento atualizado, e mais ${outras} do mesmo grupo.` : 'Lançamento atualizado.') : f.parcelas > 1 ? `${f.parcelas} parcelas criadas.` : 'Lançamento criado.');
      onSaved();
    }
  };

  const valorParcela = f.repeticao === 'parcelar' ? Math.floor(f.valor / f.parcelas) : f.valor;

  return (
    <Modal
      titulo={editando ? 'Editar lançamento' : `Nova ${nomes.singular}`}
      onClose={onClose}
      largura={620}
      rodape={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      {erro && <div className="erro-box">{erro}</div>}
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <Field label="Descrição" className="full">
          <input className="input" autoFocus value={f.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Ex.: Aluguel de outubro" />
        </Field>
        <Field label={nomes.contato}>
          <input className="input" list="contatos" value={f.contato} onChange={(e) => set('contato', e.target.value)} placeholder="Escolha ou digite um novo" />
          <datalist id="contatos">
            {sugestoes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        {tipo === 'receber' && (
          <Field label="Tipo de receita">
            <select className="select input" value={f.tipo_receita} onChange={(e) => set('tipo_receita', e.target.value as TipoReceita | 'auto')}>
              {!editando && <option value="auto">Automático (o sistema sugere)</option>}
              <option value="nova">Nova venda (cliente entrando na recorrência)</option>
              <option value="recorrente">Recorrente (mensalidade/contrato)</option>
              <option value="avulsa">Avulsa (venda única)</option>
            </select>
          </Field>
        )}
        <Field label="Categoria">
          <select className="select input" value={f.categoria_id} onChange={(e) => set('categoria_id', e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Sem categoria</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </Field>
        <Field label={f.parcelas > 1 && f.repeticao === 'parcelar' ? 'Valor total' : 'Valor'}>
          <MoneyInput value={f.valor} onChange={(v) => set('valor', v)} />
        </Field>
        <Field label={f.parcelas > 1 ? 'Vencimento da 1ª parcela' : 'Vencimento'}>
          <input className="input" type="date" value={f.vencimento} onChange={(e) => set('vencimento', e.target.value)} />
        </Field>
        <Field label="Conta bancária">
          <select className="select input" value={f.conta_bancaria_id} onChange={(e) => set('conta_bancaria_id', e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Não definida</option>
            {contas.filter((c) => c.ativa || c.id === f.conta_bancaria_id).map((c) => (
              <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Nº do documento / NF">
          <input className="input" value={f.documento} onChange={(e) => set('documento', e.target.value)} />
        </Field>
        <Field label="Forma de pagamento">
          <select className="select input" value={f.forma_pagamento} onChange={(e) => set('forma_pagamento', e.target.value)}>
            <option value="">Não informada</option>
            {FORMAS_PAGAMENTO.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Centro de custo">
          <input className="input" list="centros-custo" value={f.centro_custo} onChange={(e) => set('centro_custo', e.target.value)} placeholder="Opcional (ex.: Operacional)" />
          <datalist id="centros-custo">{centros.data?.centros_custo.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label={tipo === 'pagar' ? 'Previsão de pagamento' : 'Previsão de recebimento'}>
          <input className="input" type="date" value={f.data_prevista} onChange={(e) => set('data_prevista', e.target.value)} title="Se espera pagar/receber numa data diferente do vencimento" />
        </Field>

        {!editando && (
          <>
            <Field label="Parcelas / repetições">
              <input className="input" type="number" min={1} max={120} value={f.parcelas} onChange={(e) => set('parcelas', Math.max(1, Math.min(120, Number(e.target.value) || 1)))} />
            </Field>
            {f.parcelas > 1 ? (
              <Field label="Como lançar">
                <select className="select input" value={f.repeticao} onChange={(e) => set('repeticao', e.target.value as 'parcelar' | 'repetir')}>
                  <option value="parcelar">Dividir o valor em {f.parcelas}x</option>
                  <option value="repetir">Repetir o valor todo mês</option>
                </select>
              </Field>
            ) : (
              <Field label="Situação">
                <label className="check" style={{ height: 36 }}>
                  <input type="checkbox" checked={f.jaPago} onChange={(e) => set('jaPago', e.target.checked)} />
                  Já foi {nomes.feito.toLowerCase()}
                </label>
              </Field>
            )}
            {f.parcelas > 1 && f.valor > 0 && (
              <div className="full muted small">
                {f.parcelas}x de {brl(valorParcela)} · de {dataBR(f.vencimento)} a {dataBR(addMeses(f.vencimento, f.parcelas - 1))}
                {f.repeticao === 'parcelar' && f.valor % f.parcelas !== 0 && ' (a diferença de centavos fica na 1ª parcela)'}
              </div>
            )}
            {f.jaPago && f.parcelas === 1 && (
              <Field label={nomes.data}>
                <input className="input" type="date" value={f.data_pagamento} onChange={(e) => set('data_pagamento', e.target.value)} />
              </Field>
            )}
          </>
        )}

        <Field label="Observação" className="full">
          <textarea className="input" rows={2} value={f.observacao} onChange={(e) => set('observacao', e.target.value)} />
        </Field>
        {emGrupo && (
          <fieldset className="full escopo-edicao">
            <legend>Este lançamento é a parcela {lancamento.parcela}/{lancamento.total_parcelas}. Aplicar a alteração em:</legend>
            {(
              [
                ['este', 'Somente este lançamento'],
                ['proximos', 'Este e os próximos'],
                ['todos', `Todos os ${lancamento.total_parcelas}`],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="check">
                <input type="radio" name="escopo" checked={escopo === v} onChange={() => setEscopo(v)} /> {label}
              </label>
            ))}
            {escopo !== 'este' && (
              <div className="muted small">
                Descrição, {nomes.contato.toLowerCase()}, categoria, documento e observação mudam em todos; valor, conta e data (deslocada pelos mesmos dias) só nos que ainda estão em aberto.
              </div>
            )}
          </fieldset>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Baixa (pagamento/recebimento) de um ou vários lançamentos. */
export function BaixaModal({ lancamentos, onClose, onSaved }: { lancamentos: Lancamento[]; onClose: () => void; onSaved: () => void }) {
  const { base, contas } = useEmpresa();
  const toast = useToast();
  const unico = lancamentos.length === 1 ? lancamentos[0] : null;
  const tipo = lancamentos[0].tipo;
  const nomes = NOME_TIPO[tipo];
  const [data, setData] = useState(hoje());
  const [juros, setJuros] = useState(0);
  const [multa, setMulta] = useState(0);
  const [desconto, setDesconto] = useState(0);
  const [parcial, setParcial] = useState(false);
  const [pagoManual, setPagoManual] = useState<number | null>(null);
  const [vencRestante, setVencRestante] = useState(unico?.vencimento ?? hoje());
  const [conta, setConta] = useState<number | ''>(unico?.conta_bancaria_id ?? contas.find((c) => c.ativa)?.id ?? '');
  const { salvando, erro, salvar } = useSalvar();
  const total = lancamentos.reduce((s, l) => s + l.valor, 0);
  // Valor pago: original + juros + multa − desconto, a menos que a pessoa digite outro (no parcial, digita quanto pagou agora).
  const calculado = (unico?.valor ?? 0) + juros + multa - desconto;
  const valor = pagoManual ?? (parcial ? 0 : calculado);
  const quitado = valor - juros - multa + desconto; // quanto do valor original foi pago
  const restante = unico ? unico.valor - quitado : 0;
  const diferenca = unico && !parcial ? valor - calculado : 0;

  const enviar = async () => {
    const ok = await salvar(() =>
      unico
        ? api.post(`${base}/lancamentos/${unico.id}/baixa`, {
            data_pagamento: data, valor_pago: valor, conta_bancaria_id: conta || null, juros, multa, desconto,
            ...(parcial && { parcial: true, vencimento_restante: vencRestante }),
          })
        : api.post(`${base}/lancamentos/baixa-lote`, { ids: lancamentos.map((l) => l.id), data_pagamento: data, conta_bancaria_id: conta || null }),
    );
    if (ok) {
      toast(unico ? `${nomes.feito}: ${unico.descricao}` : `${lancamentos.length} lançamentos baixados.`);
      onSaved();
    }
  };

  return (
    <Modal
      titulo={unico ? `${nomes.acao}: ${unico.descricao}` : `${nomes.acao} ${lancamentos.length} lançamentos`}
      onClose={onClose}
      rodape={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={salvando || (parcial && !(quitado > 0 && restante > 0))}>
            Confirmar {nomes.acao.toLowerCase()}
          </button>
        </>
      }
    >
      {erro && <div className="erro-box">{erro}</div>}
      <div className="muted">
        {unico ? (
          <>Vencimento {dataBR(unico.vencimento)} · valor original <b className="num">{brl(unico.valor)}</b></>
        ) : (
          <>Total selecionado: <b className="num">{brl(total)}</b> (cada um é baixado pelo valor original)</>
        )}
      </div>
      <div className="form-grid">
        <Field label={nomes.data}>
          <input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} autoFocus />
        </Field>
        {unico && (
          <>
            <Field label="Juros"><MoneyInput value={juros} onChange={setJuros} /></Field>
            <Field label="Multa"><MoneyInput value={multa} onChange={setMulta} /></Field>
            <Field label="Desconto"><MoneyInput value={desconto} onChange={setDesconto} /></Field>
            <Field label={parcial ? `Valor ${nomes.feito.toLowerCase()} agora` : `Valor ${nomes.feito.toLowerCase()}`}>
              <MoneyInput value={valor} onChange={setPagoManual} />
            </Field>
            <label className="check full">
              <input type="checkbox" checked={parcial} onChange={(e) => (setParcial(e.target.checked), setPagoManual(null))} />
              {tipo === 'pagar' ? 'Pagamento parcial (antecipei uma parte; o restante continua a pagar)' : 'Recebimento parcial (o restante continua a receber)'}
            </label>
            {parcial && (
              <Field label="Vencimento do restante">
                <input className="input" type="date" value={vencRestante} onChange={(e) => setVencRestante(e.target.value)} />
              </Field>
            )}
          </>
        )}
        <Field label="Conta bancária" className="full">
          <select className="select input" value={conta} onChange={(e) => setConta(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Selecione…</option>
            {contas.filter((c) => c.ativa).map((c) => (
              <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>
            ))}
          </select>
        </Field>
      </div>
      {unico && !parcial && (juros > 0 || multa > 0 || desconto > 0 || diferenca !== 0) && (
        <div className="muted small">
          Valor original <b className="num">{brl(unico.valor)}</b>
          {juros > 0 && <> + juros <b className="num">{brl(juros)}</b></>}
          {multa > 0 && <> + multa <b className="num">{brl(multa)}</b></>}
          {desconto > 0 && <> − desconto <b className="num">{brl(desconto)}</b></>}
          {' '}= <b className="num">{brl(calculado)}</b>
          {diferenca !== 0 && <> · valor {nomes.feito.toLowerCase()} {diferenca > 0 ? 'maior' : 'menor'} em <b className="num">{brl(Math.abs(diferenca))}</b></>}
        </div>
      )}
      {unico && parcial && (
        <div className={'small ' + (quitado > 0 && restante > 0 ? 'muted' : 'alerta')}>
          {quitado > 0 && restante > 0 ? (
            <>Quita <b className="num">{brl(quitado)}</b> do valor original. Fica em aberto <b className="num">{brl(restante)}</b> com vencimento em {dataBR(vencRestante)}.</>
          ) : (
            <>Informe quanto foi {nomes.feito.toLowerCase()} agora: precisa ser menor que {brl(unico.valor + juros + multa - desconto)}.</>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Transferência entre contas próprias: sai de uma, entra na outra, no mesmo dia. Não é receita nem despesa. */
export function TransferenciaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { base, contas } = useEmpresa();
  const toast = useToast();
  const ativas = contas.filter((c) => c.ativa);
  const [data, setData] = useState(hoje());
  const [valor, setValor] = useState(0);
  const [origem, setOrigem] = useState<number | ''>(ativas[0]?.id ?? '');
  const [destino, setDestino] = useState<number | ''>(ativas[1]?.id ?? '');
  const [descricao, setDescricao] = useState('');
  const { salvando, erro, salvar } = useSalvar();
  const nome = (id: number | '') => ativas.find((c) => c.id === id)?.nome ?? '';

  const enviar = async () => {
    const ok = await salvar(() => api.post(`${base}/transferencias`, { data, valor, conta_origem_id: origem || null, conta_destino_id: destino || null, descricao: descricao || null }));
    if (ok) {
      toast(`Transferência de ${brl(valor)}: ${nome(origem)} → ${nome(destino)}.`);
      onSaved();
    }
  };
  const opcoes = ativas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>);

  return (
    <Modal titulo="Nova transferência entre contas" onClose={onClose}
      rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={enviar} disabled={salvando || !valor || !origem || !destino || origem === destino}>Transferir</button></>}>
      {erro && <div className="erro-box">{erro}</div>}
      {ativas.length < 2 && <div className="aviso-box">É preciso ter pelo menos duas contas bancárias ativas. Cadastre em Configurações → Empresa, contas e categorias.</div>}
      <div className="form-grid">
        <Field label="Sai da conta">
          <select className="select input" value={origem} onChange={(e) => setOrigem(e.target.value === '' ? '' : Number(e.target.value))}><option value="">Selecione…</option>{opcoes}</select>
        </Field>
        <Field label="Entra na conta">
          <select className="select input" value={destino} onChange={(e) => setDestino(e.target.value === '' ? '' : Number(e.target.value))}><option value="">Selecione…</option>{opcoes}</select>
        </Field>
        <Field label="Data"><input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
        <Field label="Valor"><MoneyInput value={valor} onChange={setValor} /></Field>
        <Field label="Descrição (opcional)" className="full">
          <input className="input" placeholder="Transferência entre contas" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Field>
      </div>
      {origem !== '' && origem === destino && <div className="small alerta">Escolha contas diferentes.</div>}
      <div className="muted small">Mexe no saldo das duas contas, mas não entra na DRE, nas análises nem no Forecast.</div>
    </Modal>
  );
}
