import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { linkDoConvite } from '../lib/convite';
import { dataBR } from '../lib/format';
import type { Convite, Membro, Papel } from '../types';
import { Field, Icon, Modal, useAcao, useToast } from '../components/ui';

const NOME_PAPEL: Record<Papel, string> = { dono: 'Dono', membro: 'Membro' };

function mensagemConvite(empresa: string, link: string) {
  return `Olá! Você foi convidado(a) para acessar o financeiro da ${empresa} no FinVision. Entre ou crie sua conta por este link: ${link}`;
}

/** Mostra o link de um convite com atalhos para copiar e compartilhar. */
function LinkConvite({ convite, empresa, onClose }: { convite: Convite; empresa: string; onClose: () => void }) {
  const toast = useToast();
  const link = linkDoConvite(convite.token);
  const texto = mensagemConvite(empresa, link);
  const copiar = async (t: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast(msg);
    } catch {
      toast('Não foi possível copiar automaticamente. Selecione o link e copie com Ctrl+C.', true);
    }
  };
  return (
    <Modal titulo="Convite criado" onClose={onClose} rodape={<button className="btn btn-primary" onClick={onClose}>Concluir</button>}>
      {convite.email_enviado && (
        <div className="convite-box">
          <b>✓ E-mail enviado para {convite.email}</b>
          <span className="small">Se não chegar em alguns minutos, peça para olhar o spam ou envie o link abaixo.</span>
        </div>
      )}
      {convite.email_enviado === false && convite.email_motivo !== 'nao_configurado' && (
        <div className="aviso-box">
          {convite.email_motivo === 'modo_teste'
            ? 'O e-mail não foi enviado: o Resend está em modo de teste (falta verificar um domínio). Envie o link abaixo pelo WhatsApp ou e-mail.'
            : 'Não foi possível enviar o e-mail agora. Envie o link abaixo pelo WhatsApp ou e-mail.'}
        </div>
      )}
      <p style={{ margin: 0 }}>
        {convite.email_enviado ? 'Você também pode enviar' : 'Envie'} este link para <b>{convite.email}</b>. Ele vale até{' '}
        <b>{dataBR(convite.expira_em.slice(0, 10))}</b> e só funciona com esse e-mail.
      </p>
      <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Link do convite" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => copiar(link, 'Link copiado.')}>Copiar link</button>
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">Enviar no WhatsApp</a>
        <a className="btn" href={`mailto:${convite.email}?subject=${encodeURIComponent(`Convite para ${empresa} no FinVision`)}&body=${encodeURIComponent(texto)}`}>
          Enviar por e-mail
        </a>
      </div>
    </Modal>
  );
}

function NovoConvite({ onClose, onCriado }: { onClose: () => void; onCriado: (c: Convite) => void }) {
  const { base } = useEmpresa();
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<Papel>('membro');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const criar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      onCriado(await api.post<Convite>(`${base}/convites`, { email, papel }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      titulo="Convidar pessoa"
      onClose={onClose}
      rodape={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={criar} disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar convite'}</button>
        </>
      }
    >
      {erro && <div className="erro-box">{erro}</div>}
      <Field label="E-mail da pessoa">
        <input className="input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && criar()} placeholder="nome@empresa.com.br" />
      </Field>
      <Field label="Papel">
        <select className="select input" value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
          <option value="membro">Membro: usa o financeiro (lançamentos, fluxo, conciliação)</option>
          <option value="dono">Dono: tudo, inclusive equipe e dados da empresa</option>
        </select>
      </Field>
      <div className="muted small">Enviamos o convite por e-mail (quando disponível) e você também recebe um link para mandar pelo WhatsApp. A pessoa precisa entrar (ou criar a conta) com este mesmo e-mail.</div>
    </Modal>
  );
}

export function Equipe() {
  const { base, empresa, versao, recarregar } = useEmpresa();
  const acao = useAcao();
  const dados = useApi<{ membros: Membro[]; meu_papel: Papel }>(`${base}/membros?v=${versao}`);
  const souDono = dados.data?.meu_papel === 'dono';
  const convites = useApi<Convite[]>(souDono ? `${base}/convites?v=${versao}` : null);
  const [novo, setNovo] = useState(false);
  const [mostrar, setMostrar] = useState<Convite | null>(null);

  const mudarPapel = async (m: Membro, papel: Papel) => {
    if (await acao(() => api.put(`${base}/membros/${m.user_id}`, { papel }), `${m.email} agora é ${NOME_PAPEL[papel].toLowerCase()}.`)) recarregar();
  };
  const remover = async (m: Membro) => {
    const msg = m.voce ? `Sair de ${empresa?.nome}? Você perderá o acesso a esta empresa.` : `Remover ${m.email} da empresa?`;
    if (!confirm(msg)) return;
    if (await acao(() => api.del(`${base}/membros/${m.user_id}`), m.voce ? 'Você saiu da empresa.' : 'Pessoa removida.')) recarregar();
  };
  const cancelar = async (c: Convite) => {
    if (!confirm(`Cancelar o convite de ${c.email}? O link deixará de funcionar.`)) return;
    if (await acao(() => api.del(`${base}/convites/${c.id}`), 'Convite cancelado.')) recarregar();
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>Equipe</h2>
          <div className="muted small">Quem tem acesso a {empresa?.nome}</div>
        </div>
        {souDono && (
          <button className="btn btn-primary btn-sm" onClick={() => setNovo(true)}>
            <Icon name="mais" /> Convidar pessoa
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <tbody>
            {dados.data?.membros.map((m) => (
              <tr key={m.user_id}>
                <td>
                  <div className="desc-principal">
                    {m.email} {m.voce && <span className="badge badge-neutro">você</span>}
                  </div>
                  <div className="desc-sub">desde {dataBR(m.criado_em.slice(0, 10))}</div>
                </td>
                <td style={{ width: 170 }}>
                  {souDono && !m.voce ? (
                    <select className="select input" value={m.papel} onChange={(e) => mudarPapel(m, e.target.value as Papel)} aria-label={`Papel de ${m.email}`}>
                      <option value="membro">Membro</option>
                      <option value="dono">Dono</option>
                    </select>
                  ) : (
                    <span className={'badge ' + (m.papel === 'dono' ? 'badge-aberto' : 'badge-neutro')}>{NOME_PAPEL[m.papel]}</span>
                  )}
                </td>
                <td className="acoes">
                  {(souDono || m.voce) && (
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remover(m)}>
                      {m.voce ? 'Sair da empresa' : 'Remover'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {convites.data?.map((c) => (
              <tr key={'c' + c.id}>
                <td>
                  <div className="desc-principal">{c.email}</div>
                  <div className="desc-sub">
                    {c.expirado ? 'Convite expirado' : `Convite pendente · vale até ${dataBR(c.expira_em.slice(0, 10))}`}
                  </div>
                </td>
                <td>
                  <span className={'badge ' + (c.expirado ? 'badge-vencido' : 'badge-aviso')}>{c.expirado ? 'Expirado' : 'Aguardando'}</span>
                </td>
                <td className="acoes">
                  {!c.expirado && <button className="btn btn-sm" onClick={() => setMostrar(c)}>Ver link</button>}
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={() => cancelar(c)}>Cancelar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {dados.erro && <div className="vazio alerta">{dados.erro}</div>}
      </div>
      {!souDono && dados.data && <div className="card-pad muted small" style={{ borderTop: '1px solid var(--border)' }}>Só o dono da empresa pode convidar ou remover pessoas.</div>}

      {novo && (
        <NovoConvite
          onClose={() => setNovo(false)}
          onCriado={(c) => {
            setNovo(false);
            setMostrar(c);
            recarregar();
          }}
        />
      )}
      {mostrar && empresa && <LinkConvite convite={mostrar} empresa={empresa.nome} onClose={() => setMostrar(null)} />}
    </div>
  );
}
