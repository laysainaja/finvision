import { useState } from 'react';
import { api } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR, hoje, addMeses } from '../lib/format';
import type { Lancamento, TipoLancamento } from '../types';
import { Field, Modal, MoneyInput, useToast } from './ui';

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
  const [f, setF] = useState({
    descricao: lancamento?.descricao ?? '',
    contato: lancamento?.contato ?? '',
    categoria_id: lancamento?.categoria_id ?? '',
    conta_bancaria_id: lancamento?.conta_bancaria_id ?? contas.find((c) => c.ativa)?.id ?? '',
    valor: lancamento?.valor ?? 0,
    vencimento: lancamento?.vencimento ?? hoje(),
    documento: lancamento?.documento ?? '',
    observacao: lancamento?.observacao ?? '',
    parcelas: 1,
    repeticao: 'parcelar' as 'parcelar' | 'repetir',
    jaPago: false,
    data_pagamento: hoje(),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const { salvando, erro, salvar } = useSalvar();
  const cats = categorias.filter((c) => c.tipo === (tipo === 'pagar' ? 'despesa' : 'receita'));

  const enviar = async () => {
    const corpo = {
      tipo,
      descricao: f.descricao,
      contato: f.contato,
      categoria_id: f.categoria_id || null,
      conta_bancaria_id: f.conta_bancaria_id || null,
      valor: f.valor,
      vencimento: f.vencimento,
      documento: f.documento,
      observacao: f.observacao,
      ...(!editando && {
        parcelas: f.parcelas,
        repeticao: f.repeticao,
        pagamento: f.jaPago ? { data_pagamento: f.data_pagamento } : undefined,
      }),
    };
    const ok = await salvar(() => (editando ? api.put(`${base}/lancamentos/${lancamento.id}`, corpo) : api.post(`${base}/lancamentos`, corpo)));
    if (ok) {
      toast(editando ? 'Lançamento atualizado.' : f.parcelas > 1 ? `${f.parcelas} parcelas criadas.` : 'Lançamento criado.');
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
          <input className="input" list="contatos" value={f.contato} onChange={(e) => set('contato', e.target.value)} />
          <datalist id="contatos">
            {contatos.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
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
  const [valor, setValor] = useState(unico?.valor ?? 0);
  const [conta, setConta] = useState<number | ''>(unico?.conta_bancaria_id ?? contas.find((c) => c.ativa)?.id ?? '');
  const { salvando, erro, salvar } = useSalvar();
  const total = lancamentos.reduce((s, l) => s + l.valor, 0);
  const diferenca = unico ? valor - unico.valor : 0;

  const enviar = async () => {
    const ok = await salvar(() =>
      unico
        ? api.post(`${base}/lancamentos/${unico.id}/baixa`, { data_pagamento: data, valor_pago: valor, conta_bancaria_id: conta || null })
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
          <button className="btn btn-primary" onClick={enviar} disabled={salvando}>
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
          <Field label={`Valor ${nomes.feito.toLowerCase()}`}>
            <MoneyInput value={valor} onChange={setValor} />
          </Field>
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
      {diferenca !== 0 && (
        <div className="muted small">
          {diferenca > 0 ? 'Acréscimo (juros/multa)' : 'Desconto'} de <b className="num">{brl(Math.abs(diferenca))}</b> em relação ao valor original.
        </div>
      )}
    </Modal>
  );
}
