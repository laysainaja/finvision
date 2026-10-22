import express from 'express';
import { all, get, transaction, hoje, STATUS_SQL } from './db.js';
import { check, isDate, isCents, optText, optId, idParam, diffDays, pgArray } from './util.js';
import { pertence, inserirLancamento, buscarLancamento, criarTransferencia } from './api.js';

export const conciliacaoRouter = express.Router({ mergeParams: true });

const ITEM_SELECT = `
  SELECT x.*, cb.nome AS conta_nome, l.descricao AS lancamento_descricao, l.contato AS lancamento_contato,
    l.vencimento AS lancamento_vencimento, l.valor AS lancamento_valor
  FROM extrato_itens x
  JOIN contas_bancarias cb ON cb.id = x.conta_bancaria_id
  LEFT JOIN lancamentos l ON l.id = x.lancamento_id`;

async function buscarItem(id, eid) {
  const item = await get(`${ITEM_SELECT} WHERE x.id = :id AND x.empresa_id = :eid`, { id: idParam(id), eid });
  check(item, 'Item do extrato não encontrado.', 404);
  return item;
}

conciliacaoRouter.get('/extrato', async (req, res) => {
  const { conta_id, status, de, ate } = req.query;
  const where = ['x.empresa_id = :eid'];
  const p = { eid: req.eid };
  if (conta_id) (where.push('x.conta_bancaria_id = :conta'), (p.conta = idParam(conta_id)));
  if (status === 'pendente') where.push('x.lancamento_id IS NULL AND x.ignorado = 0');
  if (status === 'conciliado') where.push('x.lancamento_id IS NOT NULL');
  if (status === 'ignorado') where.push('x.ignorado = 1');
  if (isDate(de)) (where.push('x.data >= :de'), (p.de = de));
  if (isDate(ate)) (where.push('x.data <= :ate'), (p.ate = ate));
  res.json(await all(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY x.data DESC, x.id DESC LIMIT 2000`, p));
});

// Visão por dia de uma conta: o que veio no extrato do banco e o que está lançado no FinVision (pago nesta conta),
// conciliado ou lançado à mão. Um dia tem pendência quando sobra movimento do banco sem conciliar.
conciliacaoRouter.get('/extrato/dias', async (req, res) => {
  const conta = optId(req.query.conta_id);
  check(conta, 'Escolha a conta bancária.');
  await pertence('contas_bancarias', conta, req.eid);
  check(isDate(req.query.de) && isDate(req.query.ate) && req.query.de <= req.query.ate, 'Período inválido.');
  const p = { eid: req.eid, conta, de: req.query.de, ate: req.query.ate };
  const [banco, finvision] = await Promise.all([
    all(
      `SELECT x.id, x.data, x.descricao, x.valor, x.lancamento_id, x.ignorado
       FROM extrato_itens x WHERE x.empresa_id = :eid AND x.conta_bancaria_id = :conta AND x.data BETWEEN :de AND :ate
       ORDER BY x.data, x.id`,
      p,
    ),
    all(
      `SELECT l.id, l.data_pagamento AS data, l.tipo, l.descricao, COALESCE(ct.nome, l.contato) AS contato, c.nome AS categoria,
         CASE WHEN l.tipo = 'receber' THEN l.valor_pago ELSE -l.valor_pago END AS valor, l.transferencia_id IS NOT NULL AS transferencia,
         EXISTS (SELECT 1 FROM extrato_itens x WHERE x.lancamento_id = l.id) AS conciliado
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id LEFT JOIN contatos ct ON ct.id = l.contato_id
       WHERE l.empresa_id = :eid AND l.conta_bancaria_id = :conta AND l.data_pagamento BETWEEN :de AND :ate
       ORDER BY l.data_pagamento, l.id`,
      p,
    ),
  ]);
  const dias = new Map();
  const dia = (d) => {
    if (!dias.has(d)) dias.set(d, { data: d, banco: [], finvision: [], total_banco: 0, total_finvision: 0, pendentes: 0 });
    return dias.get(d);
  };
  for (const x of banco) {
    const d = dia(x.data);
    d.banco.push(x);
    if (!x.ignorado) d.total_banco += x.valor;
    if (!x.lancamento_id && !x.ignorado) d.pendentes++;
  }
  for (const l of finvision) {
    const d = dia(l.data);
    d.finvision.push(l);
    d.total_finvision += l.valor;
  }
  res.json([...dias.values()].sort((a, b) => a.data.localeCompare(b.data)));
});

// Recebe os itens já lidos do OFX/CSV pelo navegador. O FITID evita importar duas vezes a mesma transação.
conciliacaoRouter.post('/extrato/importar', async (req, res) => {
  const contaId = optId(req.body.conta_bancaria_id);
  check(contaId, 'Selecione a conta bancária.');
  await pertence('contas_bancarias', contaId, req.eid);
  const itens = req.body.itens;
  check(Array.isArray(itens) && itens.length, 'Nenhuma transação encontrada no arquivo.');
  check(itens.length <= 20000, 'Arquivo grande demais.');
  for (const [i, it] of itens.entries()) {
    check(isDate(it.data), `Linha ${i + 1}: data inválida.`);
    check(isCents(it.valor) && it.valor !== 0, `Linha ${i + 1}: valor inválido.`);
    check(optText(it.fitid), `Linha ${i + 1}: identificador ausente.`);
  }

  // Um único INSERT com os arrays desempacotados: rápido mesmo com milhares de linhas.
  const inseridos = await all(
    `INSERT INTO extrato_itens (empresa_id, conta_bancaria_id, data, descricao, valor, fitid)
     SELECT :eid::bigint, :conta::bigint, d, NULLIF(t, ''), v, f
     FROM unnest(:datas::date[], :descricoes::text[], :valores::bigint[], :fitids::text[]) AS u(d, t, v, f)
     ON CONFLICT (conta_bancaria_id, fitid) DO NOTHING
     RETURNING id`,
    {
      eid: req.eid,
      conta: contaId,
      datas: pgArray(itens.map((i) => i.data)),
      descricoes: pgArray(itens.map((i) => optText(i.descricao) ?? '')),
      valores: pgArray(itens.map((i) => i.valor)),
      fitids: pgArray(itens.map((i) => String(i.fitid))),
    },
  );
  res.json({ inseridos: inseridos.length, duplicados: itens.length - inseridos.length });
});

const palavras = (s) =>
  new Set(
    (s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4),
  );

const MESMO_MES_SQL = `date_trunc('month', COALESCE(l.data_pagamento, l.vencimento)) = date_trunc('month', :data::date)`;
const mesDe = (d) => d.slice(0, 7);

// Pontua candidatos por valor (peso maior), proximidade de data e semelhança do texto.
async function sugestoes(item, eid, q) {
  const tipo = item.valor > 0 ? 'receber' : 'pagar';
  const valorItem = Math.abs(item.valor);
  const p = { eid, tipo, conta: item.conta_bancaria_id, hoje: hoje(), data: item.data, q: `%${q}%` };
  // Só lançamentos do mesmo mês do movimento (pela data do pagamento, ou do vencimento se em aberto), com ou sem busca.
  const filtro = `AND ${MESMO_MES_SQL} ${q ? 'AND (l.descricao ILIKE :q OR l.contato ILIKE :q OR l.documento ILIKE :q)' : ''}`;

  const candidatos = await all(
    `SELECT l.*, ${STATUS_SQL} AS status FROM lancamentos l
     WHERE l.empresa_id = :eid AND l.tipo = :tipo
       AND NOT EXISTS (SELECT 1 FROM extrato_itens x WHERE x.lancamento_id = l.id)
       AND (l.data_pagamento IS NULL OR l.conta_bancaria_id = :conta)
       ${filtro}
     LIMIT 500`,
    p,
  );

  const termos = palavras(item.descricao);
  return candidatos
    .map((l) => {
      const valorRef = l.valor_pago ?? l.valor;
      const dif = Math.abs(valorRef - valorItem) / valorItem;
      const dias = Math.abs(diffDays(l.data_pagamento ?? l.vencimento, item.data));
      let score = dif === 0 ? 60 : dif <= 0.02 ? 25 : dif <= 0.1 ? 10 : 0;
      score += dias <= 1 ? 30 : dias <= 5 ? 20 : dias <= 15 ? 10 : 0;
      const texto = palavras(`${l.descricao} ${l.contato ?? ''} ${l.documento ?? ''}`);
      if ([...termos].some((t) => texto.has(t))) score += 10;
      return { ...l, score, valor_exato: dif === 0, valor_proximo: dif <= 0.1, dias };
    })
    // Sem busca, só sugere valores até 10% diferentes (juros/descontos); data parecida sozinha não basta.
    .filter((l) => q || (l.valor_proximo && l.score >= 20))
    .sort((a, b) => b.score - a.score || a.dias - b.dias)
    .slice(0, q ? 20 : 8);
}

conciliacaoRouter.get('/extrato/:id/sugestoes', async (req, res) => {
  const item = await buscarItem(req.params.id, req.eid);
  res.json(await sugestoes(item, req.eid, optText(req.query.q)));
});

async function conciliar(item, lancamentoId, eid) {
  check(!item.lancamento_id, 'Este item já está conciliado.', 409);
  check(!item.ignorado, 'Este item está marcado como ignorado.', 409);
  const l = await buscarLancamento(lancamentoId, eid);
  check(l.tipo === (item.valor > 0 ? 'receber' : 'pagar'), 'Entradas só conciliam com contas a receber, e saídas com contas a pagar.');
  check(!l.extrato_id, 'Este lançamento já está conciliado com outro item do extrato.', 409);
  const dataLanc = l.data_pagamento ?? l.vencimento;
  check(mesDe(dataLanc) === mesDe(item.data),
    `Este lançamento é de ${dataLanc.split('-').reverse().join('/')}, outro mês. A conciliação só aceita lançamentos do mesmo mês do movimento do banco.`);
  if (l.data_pagamento) {
    check(l.conta_bancaria_id === item.conta_bancaria_id, 'Este lançamento foi pago por outra conta bancária.');
  } else {
    // Conciliar um lançamento em aberto dá a baixa com a data e o valor do banco.
    await all(
      "UPDATE lancamentos SET data_pagamento = :data, valor_pago = :valor, conta_bancaria_id = :conta, origem_baixa = 'conciliacao' WHERE id = :id",
      { data: item.data, valor: Math.abs(item.valor), conta: item.conta_bancaria_id, id: l.id },
    );
  }
  await all('UPDATE extrato_itens SET lancamento_id = :lid WHERE id = :id', { lid: l.id, id: item.id });
}

conciliacaoRouter.post('/extrato/auto-conciliar', async (req, res) => {
  const contaId = optId(req.body.conta_bancaria_id);
  const pendentes = await all(
    `${ITEM_SELECT} WHERE x.empresa_id = :eid AND x.lancamento_id IS NULL AND x.ignorado = 0 ${contaId ? 'AND x.conta_bancaria_id = :conta' : ''}
     ORDER BY x.data`,
    { eid: req.eid, conta: contaId },
  );

  // Concilia só quando há um candidato claramente melhor: valor exato, data próxima e sem empate.
  const conciliados = await transaction(async () => {
    let n = 0;
    for (const item of pendentes) {
      const [melhor, segundo] = await sugestoes(item, req.eid);
      if (melhor && melhor.valor_exato && melhor.dias <= 5 && (!segundo || segundo.score < melhor.score)) {
        await conciliar(item, melhor.id, req.eid);
        n++;
      }
    }
    return n;
  });
  res.json({ conciliados, analisados: pendentes.length });
});

conciliacaoRouter.post('/extrato/:id/conciliar', async (req, res) => {
  const item = await buscarItem(req.params.id, req.eid);
  await transaction(() => conciliar(item, req.body.lancamento_id, req.eid));
  res.json(await buscarItem(item.id, req.eid));
});

// Para movimentos que só aparecem no banco (tarifas, rendimentos...): cria o lançamento já pago e conciliado.
conciliacaoRouter.post('/extrato/:id/criar-lancamento', async (req, res) => {
  const item = await buscarItem(req.params.id, req.eid);
  check(!item.lancamento_id && !item.ignorado, 'Este item não está pendente.', 409);
  const categoriaId = optId(req.body.categoria_id);
  await pertence('categorias', categoriaId, req.eid);
  const descricao = optText(req.body.descricao) ?? item.descricao ?? 'Movimento bancário';
  await transaction(async () => {
    const id = await inserirLancamento({
      empresa_id: req.eid,
      tipo: item.valor > 0 ? 'receber' : 'pagar',
      descricao,
      contato: optText(req.body.contato),
      categoria_id: categoriaId,
      conta_bancaria_id: item.conta_bancaria_id,
      valor: Math.abs(item.valor),
      vencimento: item.data,
      documento: null,
      observacao: 'Criado a partir do extrato bancário',
      data_pagamento: item.data,
      valor_pago: Math.abs(item.valor),
      origem_baixa: 'conciliacao',
    });
    await all('UPDATE extrato_itens SET lancamento_id = :lid WHERE id = :id', { lid: id, id: item.id });
  });
  res.json(await buscarItem(item.id, req.eid));
});

const CRIADO_DO_EXTRATO = 'Criado a partir do extrato bancário';

// Movimento que é transferência entre contas próprias: cria as duas pernas e concilia esta.
// Se a outra conta já tem no extrato o movimento contrário (mesmo valor, até 3 dias), concilia aquele também.
conciliacaoRouter.post('/extrato/:id/criar-transferencia', async (req, res) => {
  const item = await buscarItem(req.params.id, req.eid);
  check(!item.lancamento_id && !item.ignorado, 'Este item não está pendente.', 409);
  const outra = optId(req.body.outra_conta_id);
  check(outra, 'Escolha a outra conta da transferência.');
  const saiu = item.valor < 0;
  const t = await transaction(async () => {
    const t = await criarTransferencia(req.eid, {
      origem: saiu ? item.conta_bancaria_id : outra, destino: saiu ? outra : item.conta_bancaria_id, data: item.data, valor: Math.abs(item.valor),
      descricao: optText(req.body.descricao) ?? item.descricao ?? 'Transferência entre contas', observacao: CRIADO_DO_EXTRATO,
    });
    await all('UPDATE extrato_itens SET lancamento_id = :lid WHERE id = :id', { lid: saiu ? t.saida : t.entrada, id: item.id });
    const par = await get(
      `SELECT id FROM extrato_itens WHERE empresa_id = :eid AND conta_bancaria_id = :outra AND lancamento_id IS NULL AND ignorado = 0
         AND valor = :valor AND data BETWEEN (:data::date - 3) AND (:data::date + 3) ORDER BY abs(data - :data::date), id LIMIT 1`,
      { eid: req.eid, outra, valor: -item.valor, data: item.data },
    );
    if (par) await all('UPDATE extrato_itens SET lancamento_id = :lid WHERE id = :id', { lid: saiu ? t.entrada : t.saida, id: par.id });
    return { ...t, par: !!par };
  });
  res.json({ ...(await buscarItem(item.id, req.eid)), outra_conta_conciliada: t.par });
});

conciliacaoRouter.post('/extrato/:id/desfazer', async (req, res) => {
  const item = await buscarItem(req.params.id, req.eid);
  check(item.lancamento_id, 'Este item não está conciliado.', 409);
  const lanc = await get('SELECT transferencia_id, observacao FROM lancamentos WHERE id = :id', { id: item.lancamento_id });
  if (lanc?.transferencia_id) {
    // Transferência: se nasceu daqui, sai inteira (as duas pernas); se foi lançada à mão, só solta o item.
    await transaction(async () => {
      if (lanc.observacao === CRIADO_DO_EXTRATO) await all('DELETE FROM lancamentos WHERE transferencia_id = :t AND empresa_id = :eid', { t: lanc.transferencia_id, eid: req.eid });
      else await all('UPDATE extrato_itens SET lancamento_id = NULL WHERE id = :id', { id: item.id });
    });
    return res.json(await buscarItem(item.id, req.eid));
  }
  await transaction(async () => {
    await all('UPDATE extrato_itens SET lancamento_id = NULL WHERE id = :id', { id: item.id });
    // Só desfaz a baixa se foi a própria conciliação que a fez; baixas manuais continuam valendo.
    await all(
      "UPDATE lancamentos SET data_pagamento = NULL, valor_pago = NULL, origem_baixa = NULL WHERE id = :id AND origem_baixa = 'conciliacao'",
      { id: item.lancamento_id },
    );
  });
  res.json(await buscarItem(item.id, req.eid));
});

conciliacaoRouter.post('/extrato/:id/ignorar', async (req, res) => {
  const item = await buscarItem(req.params.id, req.eid);
  check(!item.lancamento_id, 'Desfaça a conciliação antes de ignorar o item.', 409);
  await all('UPDATE extrato_itens SET ignorado = :v WHERE id = :id', { v: req.body.ignorado === false ? 0 : 1, id: item.id });
  res.json(await buscarItem(item.id, req.eid));
});

conciliacaoRouter.delete('/extrato/:id', async (req, res) => {
  const item = await buscarItem(req.params.id, req.eid);
  check(!item.lancamento_id, 'Desfaça a conciliação antes de excluir o item.', 409);
  await all('DELETE FROM extrato_itens WHERE id = :id', { id: item.id });
  res.json({ ok: true });
});
