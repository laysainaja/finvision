import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../lib/api';
import { useEmpresa } from '../lib/empresa';
import { dataBR } from '../lib/format';
import { Field, Icon, Modal, useAcao, useToast } from './ui';

interface ConfigAsaas {
  categoria_receita_id: number | null; categoria_tarifa_id: number | null; desde: string; ativo: boolean;
  sincronizado_em: string | null; ultimo_erro: string | null; tem_chave: boolean; pagamentos: boolean;
  webhook_caminho?: string; webhook_token?: string;
}
interface ResumoSync { cobrancas: Record<string, number>; movimentos: number; conciliados: number }

const ATUALIZAR_A_CADA = 15 * 60 * 1000; // ao abrir a conciliação, atualiza se a última vez foi há mais de 15 min

function haQuanto(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return `em ${dataBR(iso.slice(0, 10))}`;
}

function textoResumo(r: ResumoSync) {
  const c = r.cobrancas;
  const novas = (c.criada ?? 0) + (c.criada_paga ?? 0);
  const baixas = (c.baixada ?? 0) + (c.criada_paga ?? 0);
  const partes = [
    novas && `${novas} cobrança(s) nova(s)`,
    baixas && `${baixas} recebimento(s) com baixa`,
    c.removida && `${c.removida} cobrança(s) apagada(s) no Asaas`,
    r.movimentos && `${r.movimentos} movimento(s) no extrato (${r.conciliados} já conciliado(s))`,
  ].filter(Boolean);
  return partes.length ? `Asaas: ${partes.join(', ')}.` : 'Asaas: nada de novo.';
}

/** Faixa da conta na conciliação: liga a conta ao Asaas e traz cobranças e movimentações sozinho. */
export function AsaasConta({ contaId, contaNome }: { contaId: number; contaNome: string }) {
  const { base, empresa, versao, recarregar } = useEmpresa();
  const toast = useToast();
  const dono = empresa?.papel === 'dono';
  const { data, recarregar: recarregarCfg } = useApi<Record<string, ConfigAsaas>>(`${base}/asaas?v=${versao}`);
  const cfg = data?.[contaId];
  const [config, setConfig] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const tentou = useRef<number | null>(null);

  const atualizar = async (silencioso = false) => {
    setAtualizando(true);
    try {
      const r = await api.post<ResumoSync>(`${base}/asaas/${contaId}/sincronizar`, {});
      if (!silencioso || r.movimentos || Object.keys(r.cobrancas).length) toast(textoResumo(r));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setAtualizando(false);
      recarregarCfg();
      recarregar();
    }
  };

  // Ao abrir a conta, atualiza sozinho se já faz um tempo (uma vez por conta).
  useEffect(() => {
    if (!cfg?.ativo || !cfg.tem_chave || tentou.current === contaId) return;
    tentou.current = contaId;
    if (!cfg.sincronizado_em || Date.now() - new Date(cfg.sincronizado_em).getTime() > ATUALIZAR_A_CADA) atualizar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, contaId]);

  if (!data) return null;
  if (!cfg) {
    if (!dono) return null;
    return (
      <div className="asaas-faixa">
        <span className="muted small">Conta do Asaas? Ligue para trazer as cobranças e o extrato sozinho, sem importar arquivo.</span>
        <button className="btn btn-sm" onClick={() => setConfig(true)}><Icon name="raio" /> Ligar ao Asaas</button>
        {config && <ConfigurarAsaas contaId={contaId} contaNome={contaNome} onClose={() => setConfig(false)} onSalvo={() => (recarregarCfg(), setConfig(false))} />}
      </div>
    );
  }
  return (
    <div className={'asaas-faixa ligada' + (cfg.ultimo_erro ? ' erro' : '')}>
      <span className="small">
        <b>Ligada ao Asaas</b>
        {!cfg.ativo ? ' · pausada' : cfg.sincronizado_em ? ` · atualizada ${haQuanto(cfg.sincronizado_em)}` : ' · ainda não atualizada'}
        {cfg.ultimo_erro && <span className="alerta"> · {cfg.ultimo_erro}</span>}
      </span>
      {cfg.ativo && (
        <button className="btn btn-sm" onClick={() => atualizar()} disabled={atualizando}>
          <Icon name="raio" /> {atualizando ? 'Atualizando…' : 'Atualizar agora'}
        </button>
      )}
      {dono && <button className="btn btn-sm" onClick={() => setConfig(true)}>Configurar</button>}
      {config && <ConfigurarAsaas contaId={contaId} contaNome={contaNome} atual={cfg} onClose={() => setConfig(false)} onSalvo={() => (recarregarCfg(), setConfig(false))} />}
    </div>
  );
}

function ConfigurarAsaas({ contaId, contaNome, atual, onClose, onSalvo }: { contaId: number; contaNome: string; atual?: ConfigAsaas; onClose: () => void; onSalvo: () => void }) {
  const { base, categorias } = useEmpresa();
  const acao = useAcao();
  const toast = useToast();
  const receitas = categorias.filter((c) => c.tipo === 'receita');
  const despesas = categorias.filter((c) => c.tipo === 'despesa');
  const padrao = (lista: typeof categorias, re: RegExp) => lista.find((c) => re.test(c.nome))?.id ?? '';
  const [chave, setChave] = useState('');
  const [desde, setDesde] = useState(atual?.desde ?? new Date().toISOString().slice(0, 8) + '01');
  const [catReceita, setCatReceita] = useState<number | ''>(atual ? atual.categoria_receita_id ?? '' : padrao(receitas, /servi[cç]o|venda/i));
  const [catTarifa, setCatTarifa] = useState<number | ''>(atual ? atual.categoria_tarifa_id ?? '' : padrao(despesas, /tarifa|taxa/i));
  const [ativo, setAtivo] = useState(atual?.ativo ?? true);
  const [pagamentos, setPagamentos] = useState(atual?.pagamentos ?? false);
  const webhook = atual?.webhook_caminho ? `${location.origin}${atual.webhook_caminho}` : null;

  const salvar = () => acao(async () => {
    await api.put(`${base}/asaas/${contaId}`, { chave: chave || undefined, desde, categoria_receita_id: catReceita || null, categoria_tarifa_id: catTarifa || null, ativo, pagamentos });
    toast(atual ? 'Integração com o Asaas atualizada.' : 'Conta ligada ao Asaas. Agora cadastre o webhook no painel do Asaas para as baixas chegarem na hora.');
    onSalvo();
  });
  const desligar = () => acao(async () => {
    if (!confirm('Desligar esta conta do Asaas? A chave de API é apagada; os lançamentos e o extrato já trazidos continuam.')) return;
    await api.del(`${base}/asaas/${contaId}`);
    toast('Integração desligada.');
    onSalvo();
  });
  const copiar = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Copiado.'));

  return (
    <Modal titulo={`Asaas · ${contaNome}`} onClose={onClose} largura={560}
      rodape={<>
        {atual && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={desligar}>Desligar</button>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={salvar}>Salvar</button>
      </>}>
      <div className="form-grid">
        <Field label="Chave de API do Asaas" className="full">
          <input className="input" type="password" autoComplete="off" value={chave} onChange={(e) => setChave(e.target.value)}
            placeholder={atual?.tem_chave ? 'Chave já cadastrada (cole outra só para trocar)' : 'Cole a chave (Asaas → Integrações → Chave de API)'} />
        </Field>
        <Field label="Buscar a partir de">
          <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
        <Field label="Situação">
          <label className="check"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativa</label>
        </Field>
        <Field label="Categoria das cobranças">
          <select className="select input" value={catReceita} onChange={(e) => setCatReceita(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Sem categoria</option>
            {receitas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Field>
        <Field label="Categoria das taxas do Asaas">
          <select className="select input" value={catTarifa} onChange={(e) => setCatTarifa(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Sem categoria</option>
            {despesas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Field>
      </div>
      <label className="check asaas-pagar">
        <input type="checkbox" checked={pagamentos} onChange={(e) => setPagamentos(e.target.checked)} />
        <span>
          <b>Pagar contas por esta conta (Pix)</b><br />
          <span className="small">Ligue só depois de confirmar no Asaas que transferências pedem aprovação com token. O pagamento sobe ao Asaas só com o seu OK, agendado, e sai quando o responsável aprova lá.</span>
        </span>
      </label>
      <p className="muted small">
        O FinVision lê cobranças e extrato e não cria cobranças. A chave fica guardada no cofre e não aparece de novo.
        Movimentos antes da data escolhida não são trazidos (use a importação de arquivo para eles).
      </p>
      {webhook && atual?.webhook_token && (
        <div className="asaas-webhook">
          <div className="kpi-label">Webhook (Asaas → Integrações → Webhooks: eventos de Cobranças e de Transferências)</div>
          <div className="small">URL: <code>{webhook}</code> <button className="btn-texto" onClick={() => copiar(webhook)}>copiar</button></div>
          <div className="small">Token de autenticação: <code>{atual.webhook_token}</code> <button className="btn-texto" onClick={() => copiar(atual.webhook_token!)}>copiar</button></div>
          <div className="muted small">Com o webhook, a baixa de uma cobrança paga chega na hora; sem ele, chega quando a conciliação for aberta.</div>
        </div>
      )}
    </Modal>
  );
}
