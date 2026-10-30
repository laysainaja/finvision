import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { brl, dataBR } from '../lib/format';
import type { Lancamento } from '../types';
import { Field, Icon, Modal, useAcao } from './ui';

// Pagamentos pelo Asaas: preparar (só no FinVision) → OK do dono (sobe agendado ao Asaas) → aprovação com token no
// Asaas → baixa quando o Asaas confirma. O FinVision nunca aprova a transferência.

type StatusPagamento = 'preparado' | 'enviado' | 'pago' | 'falhou' | 'cancelado';
export interface PagamentoAsaas {
  lancamento_id: number; conta_bancaria_id: number; conta_nome: string; status: StatusPagamento;
  valor: number | null; data_envio: string | null; autorizado: boolean | null; status_asaas: string | null; erro: string | null;
  descricao: string; contato: string | null; valor_lancamento: number; vencimento: string; data_pagamento: string | null;
  chave_pix: string | null; chave_pix_atual: string | null; tipo_chave_pix_atual: string | null;
}

const NOME_CHAVE: Record<string, string> = { CPF: 'CPF', CNPJ: 'CNPJ', EMAIL: 'e-mail', PHONE: 'celular', EVP: 'chave aleatória' };

/** Contas liberadas para pagar pelo Asaas e os pagamentos preparados/enviados da empresa. */
export function useAsaasPagamentos() {
  const { base, versao, contas } = useEmpresa();
  const cfg = useApi<Record<string, { pagamentos?: boolean; tem_chave: boolean }>>(`${base}/asaas?v=${versao}`);
  const lista = useApi<PagamentoAsaas[]>(`${base}/asaas/pagamentos?v=${versao}`);
  const contasPagamento = contas.filter((c) => cfg.data?.[c.id]?.pagamentos && cfg.data[c.id].tem_chave);
  const porLancamento = new Map((lista.data ?? []).map((p) => [p.lancamento_id, p]));
  return { contasPagamento, pagamentos: lista.data ?? [], porLancamento, recarregar: lista.recarregar };
}

/** Escolhe a conta Asaas e prepara o pagamento (nada vai ao Asaas ainda). */
export function PrepararPagamento({ lancamento, contas, onClose, onSalvo }: { lancamento: Lancamento; contas: { id: number; nome: string }[]; onClose: () => void; onSalvo: () => void }) {
  const { base } = useEmpresa();
  const acao = useAcao();
  const [conta, setConta] = useState(contas[0]?.id ?? 0);
  const preparar = async () => {
    const ok = await acao(() => api.post(`${base}/asaas/pagamentos`, { lancamento_id: lancamento.id, conta_bancaria_id: conta }), 'Pagamento preparado. Confira e dê o OK em "Pagamentos pelo Asaas".');
    if (ok) onSalvo();
  };
  return (
    <Modal titulo="Pagar pelo Asaas" onClose={onClose}
      rodape={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={preparar}>Preparar pagamento</button></>}>
      <p style={{ marginTop: 0 }}><b>{lancamento.descricao}</b>{lancamento.contato && ` · ${lancamento.contato}`}<br />{brl(lancamento.valor)} · vence em {dataBR(lancamento.vencimento)}</p>
      <Field label="Pagar pela conta">
        <select className="select input" value={conta} onChange={(e) => setConta(Number(e.target.value))}>
          {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </Field>
      <p className="muted small">
        Preparar não envia nada: o pagamento fica em "Pagamentos pelo Asaas" para você conferir o valor e dar o OK.
        Depois do OK ele sobe ao Asaas agendado e só sai quando for aprovado com o token lá.
      </p>
    </Modal>
  );
}

function situacao(p: PagamentoAsaas) {
  if (p.status === 'preparado') return { texto: p.erro ? `Não foi enviado: ${p.erro}` : 'Aguardando seu OK', classe: p.erro ? 'alerta' : '' };
  if (p.status === 'enviado') {
    if (p.erro) return { texto: p.erro, classe: 'alerta' };
    if (p.autorizado === false) return { texto: 'No Asaas: aguardando aprovação com token', classe: '' };
    return { texto: p.status_asaas === 'BANK_PROCESSING' ? 'No Asaas: em processamento' : `No Asaas: agendado para ${p.data_envio ? dataBR(p.data_envio) : '—'}`, classe: '' };
  }
  if (p.status === 'pago') return { texto: `Pago${p.data_pagamento ? ` em ${dataBR(p.data_pagamento)}` : ''}`, classe: 'entrada' };
  if (p.status === 'falhou') return { texto: `Falhou: ${p.erro ?? 'veja no Asaas'}`, classe: 'alerta' };
  return { texto: 'Cancelado no Asaas', classe: 'muted' };
}

/** Lista dos pagamentos pelo Asaas, com o OK (enviar), cancelar e tirar da lista. */
export function PainelPagamentosAsaas({ pagamentos, onMudou }: { pagamentos: PagamentoAsaas[]; onMudou: () => void }) {
  const { base, empresa } = useEmpresa();
  const acao = useAcao();
  const dono = empresa?.papel === 'dono';
  if (!pagamentos.length) return null;

  const enviar = async (p: PagamentoAsaas) => {
    const hoje = new Date().toISOString().slice(0, 10);
    const data = p.vencimento > hoje ? p.vencimento : hoje;
    if (!confirm(`Enviar ao Asaas o pagamento de ${brl(p.valor_lancamento)} para ${p.contato ?? p.descricao}?\n\nChave Pix (${NOME_CHAVE[p.tipo_chave_pix_atual ?? ''] ?? '—'}): ${p.chave_pix_atual ?? '—'}\nAgendado para ${dataBR(data)}, pela conta ${p.conta_nome}.\n\nEle só sai depois de aprovado com o token no Asaas.`)) return;
    if (await acao(() => api.post(`${base}/asaas/pagamentos/${p.lancamento_id}/enviar`, {}), 'Enviado ao Asaas. Agora aprove com o token no app ou no site do Asaas.')) onMudou();
  };
  const cancelar = async (p: PagamentoAsaas) => {
    if (!confirm(`Cancelar no Asaas a transferência de ${brl(p.valor ?? p.valor_lancamento)} para ${p.contato ?? p.descricao}?`)) return;
    if (await acao(() => api.post(`${base}/asaas/pagamentos/${p.lancamento_id}/cancelar`, {}), 'Transferência cancelada no Asaas.')) onMudou();
  };
  const preparar = async (p: PagamentoAsaas) => {
    if (await acao(() => api.post(`${base}/asaas/pagamentos`, { lancamento_id: p.lancamento_id, conta_bancaria_id: p.conta_bancaria_id }), 'Pagamento preparado de novo.')) onMudou();
  };
  const tirar = async (p: PagamentoAsaas) => {
    if (await acao(() => api.del(`${base}/asaas/pagamentos/${p.lancamento_id}`), 'Tirado dos pagamentos pelo Asaas.')) onMudou();
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Pagamentos pelo Asaas</h2>
        <span className="muted small">preparar → seu OK → aprovação com token no Asaas → baixa automática</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Vencimento</th><th>Pagamento</th><th>Chave Pix</th><th className="r">Valor</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {pagamentos.map((p) => {
              const s = situacao(p);
              const mudou = p.status === 'enviado' && p.valor !== null && p.valor !== p.valor_lancamento;
              return (
                <tr key={p.lancamento_id}>
                  <td className="num">{dataBR(p.vencimento)}</td>
                  <td><div className="desc-principal">{p.contato ?? p.descricao}</div><div className="desc-sub">{p.descricao} · {p.conta_nome}</div></td>
                  <td className="small">
                    {p.chave_pix_atual ? <>{p.chave_pix_atual}<div className="desc-sub">{NOME_CHAVE[p.tipo_chave_pix_atual ?? ''] ?? ''}</div></> : <span className="alerta">sem chave Pix no cadastro</span>}
                  </td>
                  <td className="r num">
                    {brl(p.status === 'preparado' ? p.valor_lancamento : p.valor ?? p.valor_lancamento)}
                    {mudou && <div className="desc-sub alerta">lançamento agora: {brl(p.valor_lancamento)}</div>}
                  </td>
                  <td className={'small ' + s.classe}>
                    {s.texto}
                    {mudou && <div className="alerta">O valor mudou depois do envio: cancele e envie de novo.</div>}
                  </td>
                  <td className="acoes">
                    {p.status === 'preparado' && dono && <button className="btn btn-sm btn-primary" onClick={() => enviar(p)} disabled={!p.chave_pix_atual}><Icon name="raio" /> OK, enviar ao Asaas</button>}
                    {p.status === 'enviado' && dono && <button className="btn btn-sm" onClick={() => cancelar(p)}>Cancelar envio</button>}
                    {(p.status === 'falhou' || p.status === 'cancelado') && <button className="btn btn-sm" onClick={() => preparar(p)}>Preparar de novo</button>}
                    {['preparado', 'falhou', 'cancelado'].includes(p.status) && <button className="btn btn-sm btn-ghost" onClick={() => tirar(p)} title="Tirar da lista">Tirar</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!dono && pagamentos.some((p) => p.status === 'preparado') && <div className="vazio small">Só o dono da empresa dá o OK para enviar ao Asaas.</div>}
    </div>
  );
}
