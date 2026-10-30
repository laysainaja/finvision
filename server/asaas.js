// Integração com o Asaas, só leitura (nenhum dinheiro é movido daqui):
// - cobranças viram contas a receber; quando pagas, recebem baixa sozinhas e a taxa do Asaas vira uma despesa paga;
// - as movimentações da conta entram no extrato da conciliação (e as que já têm lançamento saem conciliadas).
// Roda ao abrir a conciliação, no botão "Atualizar agora" e pelo webhook do Asaas (cobrança criada, paga, apagada...).
// A chave de API de cada conta fica no Vault do Supabase ('asaas_conta_<id>'); só o dono cadastra e ninguém a lê de volta.
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { all, get, transaction, hoje } from './db.js';
import { check, isDate, optId, idParam, addDays, pgArray } from './util.js';
import { pertence, inserirLancamento } from './api.js';
import { resolverContato } from './contatos.js';
import { casarJaLancados } from './conciliacao.js';

export const asaasRouter = express.Router({ mergeParams: true });

const nomeSegredo = (contaId) => `asaas_conta_${contaId}`;
const ABERTAS = ['PENDING', 'OVERDUE', 'CONFIRMED', 'AWAITING_RISK_ANALYSIS']; // CONFIRMED = cartão aprovado, ainda não caiu
const PAGAS = ['RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'];
const FORMA = { PIX: 'Pix', BOLETO: 'Boleto bancário', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito', TRANSFER: 'Transferência bancária' };
const centavos = (v) => Math.round(Number(v) * 100);

// ---------- Cliente HTTP do Asaas ----------
// Chave de sandbox ("hmlg") vai para o sandbox; ASAAS_URL troca o endereço (usado nos testes).
function urlBase(chave) {
  return process.env.ASAAS_URL ?? (chave.includes('_hmlg_') ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3');
}

async function asaas(chave, caminho, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)).toString();
  const r = await fetch(`${urlBase(chave)}${caminho}${qs ? '?' + qs : ''}`, {
    headers: { access_token: chave, 'User-Agent': 'FinVision/1.0', accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 401) throw new Error('O Asaas recusou a chave de API (401). Confira a chave cadastrada.');
  if (!r.ok) throw new Error(`O Asaas respondeu ${r.status} em ${caminho}.`);
  return r.json();
}

// Lista paginada (o Asaas devolve no máximo 100 por vez).
async function todas(chave, caminho, params) {
  const itens = [];
  for (let offset = 0, pagina = 0; pagina < 100; pagina++, offset += 100) {
    const r = await asaas(chave, caminho, { ...params, offset, limit: 100 });
    itens.push(...(r.data ?? []));
    if (!r.hasMore) break;
  }
  return itens;
}

async function lerChave(contaId) {
  const r = await get('SELECT decrypted_secret AS chave FROM vault.decrypted_secrets WHERE name = :n', { n: nomeSegredo(contaId) });
  return r?.chave ?? null;
}

async function guardarChave(contaId, chave) {
  const existente = await get('SELECT id FROM vault.secrets WHERE name = :n', { n: nomeSegredo(contaId) });
  if (existente) await get('SELECT vault.update_secret(:id::uuid, :s)', { id: existente.id, s: chave });
  else await get("SELECT vault.create_secret(:s, :n, 'Chave de API do Asaas (FinVision)')", { s: chave, n: nomeSegredo(contaId) });
}

// ---------- Cobranças → contas a receber ----------

/**
 * Cria ou atualiza o lançamento de uma cobrança. Acha pelo id do Asaas ou pelo número da fatura (cobranças que já
 * tinham sido lançadas à mão ou por planilha, com "Fatura 123" no documento). O que já foi pago à mão não é mexido.
 */
async function aplicarCobranca(cfg, p, clientes, chave, apagada = false) {
  const eid = cfg.empresa_id;
  const documento = p.invoiceNumber ? `Fatura ${p.invoiceNumber}` : null;
  const atual = await get(
    `SELECT id, data_pagamento, asaas_id FROM lancamentos WHERE empresa_id = :eid AND tipo = 'receber'
       AND (asaas_id = :aid OR (asaas_id IS NULL AND :doc::text IS NOT NULL AND documento = :doc)) ORDER BY asaas_id NULLS LAST LIMIT 1`,
    { eid, aid: p.id, doc: documento },
  );
  if (apagada || p.deleted || p.status === 'REFUNDED' || p.status === 'REFUND_REQUESTED') {
    // Cobrança apagada/estornada antes de pagar: some das contas a receber. Paga e estornada fica como está (o estorno aparece no extrato).
    if (atual && !atual.data_pagamento) {
      await all('DELETE FROM lancamentos WHERE id = :id', { id: atual.id });
      return 'removida';
    }
    return null;
  }
  const paga = PAGAS.includes(p.status);
  if (!paga && !ABERTAS.includes(p.status)) return null;
  const valor = centavos(p.value);
  const dataPagamento = paga ? (p.paymentDate ?? p.clientPaymentDate) : null;

  if (atual) {
    if (atual.data_pagamento) return null; // já baixado (à mão ou antes): não mexe
    await all(
      `UPDATE lancamentos SET asaas_id = :aid, valor = :valor, vencimento = :venc, conta_bancaria_id = COALESCE(conta_bancaria_id, :conta),
         data_pagamento = :pg, valor_pago = :vp, origem_baixa = :origem WHERE id = :id`,
      { id: atual.id, aid: p.id, valor, venc: p.dueDate, conta: cfg.conta_bancaria_id, pg: dataPagamento, vp: paga ? valor : null, origem: paga ? 'asaas' : null },
    );
    if (paga) await aplicarTarifa(cfg, p, dataPagamento);
    return paga ? 'baixada' : 'atualizada';
  }

  const nome = await nomeCliente(chave, p.customer, clientes);
  const contato = nome ? await resolverContato(eid, nome, 'receber') : null;
  const tipoCobranca = p.installment ? 'Cobrança Parcelada' : p.subscription ? 'Cobrança Recorrente' : 'Cobrança Avulsa';
  const descricao = p.description && !/^descri[cç][aã]o n[aã]o informada$/i.test(p.description) ? p.description : null;
  const id = await inserirLancamento({
    empresa_id: eid, tipo: 'receber',
    descricao: contato?.nome ?? descricao ?? 'Cobrança Asaas',
    contato: contato?.nome ?? null, contato_id: contato?.id ?? null,
    tipo_receita: p.installment || p.subscription ? 'recorrente' : 'avulsa',
    categoria_id: cfg.categoria_receita_id, conta_bancaria_id: cfg.conta_bancaria_id,
    valor, vencimento: p.dueDate, documento,
    observacao: [descricao, `Asaas: ${tipoCobranca}`].filter(Boolean).join(' · '),
    forma_pagamento: FORMA[p.billingType] ?? null,
    data_pagamento: dataPagamento, valor_pago: paga ? valor : null, origem_baixa: paga ? 'asaas' : null,
  });
  await all('UPDATE lancamentos SET asaas_id = :aid WHERE id = :id', { aid: p.id, id });
  if (paga) await aplicarTarifa(cfg, p, dataPagamento);
  return paga ? 'criada_paga' : 'criada';
}

// Nome do cliente no Asaas, em maiúsculas como os demais cadastros de cliente (guardado em `clientes` para não repetir a busca).
async function nomeCliente(chave, id, clientes) {
  if (!id) return null;
  if (!clientes.has(id)) {
    const c = await asaas(chave, `/customers/${encodeURIComponent(id)}`).catch(() => null);
    clientes.set(id, c?.name ? String(c.name).trim().toUpperCase() : null);
  }
  return clientes.get(id);
}

// A taxa do Asaas (valor − valor líquido) vira uma despesa paga no mesmo dia, como sai no extrato.
async function aplicarTarifa(cfg, p, data) {
  const taxa = centavos(p.value) - centavos(p.netValue ?? p.value);
  if (taxa <= 0) return;
  const aid = `tarifa:${p.id}`;
  if (await get('SELECT 1 FROM lancamentos WHERE empresa_id = :eid AND asaas_id = :aid', { eid: cfg.empresa_id, aid })) return;
  const id = await inserirLancamento({
    empresa_id: cfg.empresa_id, tipo: 'pagar', descricao: 'TARIFA ASAAS', contato: null,
    categoria_id: cfg.categoria_tarifa_id, conta_bancaria_id: cfg.conta_bancaria_id,
    valor: taxa, vencimento: data, documento: p.invoiceNumber ? `Fatura ${p.invoiceNumber}` : null,
    observacao: 'Taxa da cobrança no Asaas', data_pagamento: data, valor_pago: taxa, origem_baixa: 'asaas',
  });
  await all('UPDATE lancamentos SET asaas_id = :aid WHERE id = :id', { aid, id });
}

// ---------- Sincronização ----------

async function configDaConta(contaId, eid = null) {
  return get(
    `SELECT a.*, cb.nome AS conta_nome FROM asaas_contas a JOIN contas_bancarias cb ON cb.id = a.conta_bancaria_id
     WHERE a.conta_bancaria_id = :c ${eid ? 'AND a.empresa_id = :eid' : ''}`,
    { c: contaId, eid },
  );
}

/** Busca cobranças e movimentações desde a última vez (com 5 dias de folga) e grava. Devolve o que mudou. */
export async function sincronizar(cfg) {
  const chave = await lerChave(cfg.conta_bancaria_id);
  check(chave, 'Esta conta ainda não tem a chave de API do Asaas.');
  const ultima = cfg.sincronizado_em ? addDays(new Date(cfg.sincronizado_em).toISOString().slice(0, 10), -5) : cfg.desde;
  const desde = ultima > cfg.desde ? ultima : cfg.desde;
  const ate = hoje();
  try {
    // Abertas: todas (vencidas e a vencer). Pagas: as que caíram desde a última vez.
    const abertas = [];
    for (const status of ['PENDING', 'OVERDUE', 'CONFIRMED']) abertas.push(...(await todas(chave, '/payments', { status })));
    const pagas = await todas(chave, '/payments', { 'paymentDate[ge]': desde, 'paymentDate[le]': ate });
    const movimentos = await todas(chave, '/financialTransactions', { startDate: desde, finishDate: ate, order: 'asc' });
    // Nomes dos clientes antes da transação, para não segurar o banco esperando o Asaas.
    const clientes = new Map();
    for (const p of [...abertas, ...pagas]) await nomeCliente(chave, p.customer, clientes);

    const resumo = await transaction(async () => {
      const contagem = {};
      for (const p of [...abertas, ...pagas]) {
        const r = await aplicarCobranca(cfg, p, clientes, chave);
        if (r) contagem[r] = (contagem[r] ?? 0) + 1;
      }
      const validos = movimentos.filter((m) => isDate(m.date) && centavos(m.value) !== 0);
      const inseridos = validos.length ? await all(
        `INSERT INTO extrato_itens (empresa_id, conta_bancaria_id, data, descricao, valor, fitid)
         SELECT :eid::bigint, :conta::bigint, d, NULLIF(t, ''), v, f
         FROM unnest(:datas::date[], :descricoes::text[], :valores::bigint[], :fitids::text[]) AS u(d, t, v, f)
         ON CONFLICT (conta_bancaria_id, fitid) DO NOTHING RETURNING id`,
        {
          eid: cfg.empresa_id, conta: cfg.conta_bancaria_id,
          datas: pgArray(validos.map((m) => m.date)), descricoes: pgArray(validos.map((m) => String(m.description ?? '').trim())),
          valores: pgArray(validos.map((m) => centavos(m.value))), fitids: pgArray(validos.map((m) => `asaas:${m.id}`)),
        },
      ) : [];
      const conciliados = inseridos.length ? await casarJaLancados(cfg.empresa_id, cfg.conta_bancaria_id, inseridos.map((i) => i.id)) : 0;
      await all('UPDATE asaas_contas SET sincronizado_em = now(), ultimo_erro = NULL WHERE conta_bancaria_id = :c', { c: cfg.conta_bancaria_id });
      return { cobrancas: contagem, movimentos: inseridos.length, conciliados };
    });
    return resumo;
  } catch (e) {
    await all('UPDATE asaas_contas SET ultimo_erro = :e WHERE conta_bancaria_id = :c', { e: String(e.message).slice(0, 300), c: cfg.conta_bancaria_id });
    throw e;
  }
}

// ---------- Rotas da empresa ----------

const publico = (a, dono) => a && {
  categoria_receita_id: a.categoria_receita_id, categoria_tarifa_id: a.categoria_tarifa_id, desde: a.desde, ativo: a.ativo,
  sincronizado_em: a.sincronizado_em, ultimo_erro: a.ultimo_erro, tem_chave: a.tem_chave,
  // O endereço do webhook leva o token; só o dono vê (é ele quem cadastra no painel do Asaas).
  ...(dono && { webhook_caminho: `/api/integracoes/asaas/webhook/${a.conta_bancaria_id}`, webhook_token: a.webhook_token }),
};

asaasRouter.get('/asaas', async (req, res) => {
  const linhas = await all(
    `SELECT a.*, EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'asaas_conta_' || a.conta_bancaria_id) AS tem_chave
     FROM asaas_contas a WHERE a.empresa_id = :eid`,
    { eid: req.eid },
  );
  res.json(Object.fromEntries(linhas.map((a) => [a.conta_bancaria_id, publico(a, req.papel === 'dono')])));
});

asaasRouter.put('/asaas/:conta', async (req, res) => {
  check(req.papel === 'dono', 'Só o dono pode ligar uma conta ao Asaas.', 403);
  const contaId = idParam(req.params.conta);
  await pertence('contas_bancarias', contaId, req.eid);
  const catReceita = optId(req.body.categoria_receita_id);
  const catTarifa = optId(req.body.categoria_tarifa_id);
  await pertence('categorias', catReceita, req.eid);
  await pertence('categorias', catTarifa, req.eid);
  const desde = req.body.desde;
  check(isDate(desde), 'Informe a partir de que data buscar.');
  const chave = typeof req.body.chave === 'string' ? req.body.chave.trim() : '';
  const existente = await configDaConta(contaId, req.eid);
  check(chave || (existente && (await lerChave(contaId))), 'Cole a chave de API do Asaas.');
  if (chave) {
    check(chave.length >= 20 && chave.length <= 500 && !/\s/.test(chave), 'Chave de API inválida.');
    // Testa a chave antes de guardar (só lê o saldo).
    try {
      await asaas(chave, '/finance/balance');
    } catch (e) {
      check(false, e.message);
    }
    await guardarChave(contaId, chave);
  }
  await all(
    `INSERT INTO asaas_contas (conta_bancaria_id, empresa_id, categoria_receita_id, categoria_tarifa_id, desde, ativo)
     VALUES (:c, :eid, :cr, :ct, :desde, :ativo)
     ON CONFLICT (conta_bancaria_id) DO UPDATE SET categoria_receita_id = excluded.categoria_receita_id,
       categoria_tarifa_id = excluded.categoria_tarifa_id, desde = excluded.desde, ativo = excluded.ativo`,
    { c: contaId, eid: req.eid, cr: catReceita, ct: catTarifa, desde, ativo: req.body.ativo !== false },
  );
  res.json({ ok: true });
});

asaasRouter.delete('/asaas/:conta', async (req, res) => {
  check(req.papel === 'dono', 'Só o dono pode desligar a integração.', 403);
  const contaId = idParam(req.params.conta);
  await pertence('contas_bancarias', contaId, req.eid);
  await transaction(async () => {
    await all('DELETE FROM asaas_contas WHERE conta_bancaria_id = :c AND empresa_id = :eid', { c: contaId, eid: req.eid });
    await all('DELETE FROM vault.secrets WHERE name = :n', { n: nomeSegredo(contaId) });
  });
  res.json({ ok: true });
});

asaasRouter.post('/asaas/:conta/sincronizar', async (req, res) => {
  const cfg = await configDaConta(idParam(req.params.conta), req.eid);
  check(cfg, 'Esta conta não está ligada ao Asaas.', 404);
  check(cfg.ativo, 'A integração desta conta está pausada.');
  try {
    res.json(await sincronizar(cfg));
  } catch (e) {
    if (e.status) throw e;
    check(false, `Não foi possível atualizar pelo Asaas: ${e.message}`, 502);
  }
});

// ---------- Webhook (público; protegido pelo token da conta) ----------
// O Asaas manda o token cadastrado no cabeçalho asaas-access-token. Responde 200 rápido mesmo quando ignora o evento,
// porque erros seguidos fazem o Asaas pausar a fila de webhooks.
export async function webhookAsaas(req, res) {
  const contaId = Number(req.params.conta);
  const cfg = Number.isInteger(contaId) ? await configDaConta(contaId) : null;
  const token = String(req.get('asaas-access-token') ?? '');
  const esperado = cfg ? String(cfg.webhook_token) : '';
  const ok = cfg && token.length === esperado.length && timingSafeEqual(Buffer.from(token), Buffer.from(esperado));
  if (!ok) return res.status(401).json({ erro: 'Token inválido.' });
  const { event, payment } = req.body ?? {};
  if (!cfg.ativo || !payment?.id || !String(event ?? '').startsWith('PAYMENT_')) return res.json({ ok: true, ignorado: true });
  try {
    const chave = await lerChave(cfg.conta_bancaria_id);
    if (!chave) return res.json({ ok: true, ignorado: true });
    const r = await transaction(() => aplicarCobranca(cfg, payment, new Map(), chave, event === 'PAYMENT_DELETED'));
    res.json({ ok: true, resultado: r });
  } catch (e) {
    console.error('webhook asaas:', e.message);
    res.status(500).json({ erro: 'Falha ao processar.' });
  }
}
