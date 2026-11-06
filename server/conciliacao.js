import express from 'express';
import { all, get, transaction, hoje, STATUS_SQL } from './db.js';
import { check, isDate, isCents, optText, optId, idParam, diffDays, pgArray } from './util.js';
import { pertence, inserirLancamento, buscarLancamento, criarTransferencia } from './api.js';

export const conciliacaoRouter = express.Router({ mergeParams: true });

const ITEM_SELECT = `
  SELECT x.*, cb.nome AS conta_nome, l.descricao AS lancamento_descricao, l.contato AS lancamento_contato,
    l.vencimento AS lancamento_vencimento, l.valor AS lancamento_valor,
    (SELECT json_agg(json_build_object('id', m.id, 'descricao', m.descricao, 'contato', m.contato, 'vencimento', m.vencimento, 'valor', COALESCE(m.valor_pago, m.valor)) ORDER BY m.vencimento, m.id)
     FROM lancamentos m WHERE m.extrato_lote_id = x.id) AS lote
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
         (l.extrato_lote_id IS NOT NULL OR EXISTS (SELECT 1 FROM extrato_itens x WHERE x.lancamento_id = l.id)) AS conciliado
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
  // Já confere o que foi lançado antes (à mão, importado ou pela recorrência): esses saem conciliados e só sobra o novo.
  const jaLancados = inseridos.length ? await transaction(() => casarJaLancados(req.eid, contaId, inseridos.map((i) => i.id))) : 0;
  res.json({ inseridos: inseridos.length, duplicados: itens.length - inseridos.length, ja_lancados: jaLancados });
});

/**
 * Concilia sozinho os movimentos do extrato que já têm lançamento no FinVision: mesmo tipo, mesmo valor (pago, ou o
 * previsto se em aberto), mesmo mês e até 5 dias de diferença; fica com o de data mais próxima. Primeiro os já pagos
 * nesta conta (o caso de quem lançou à mão ou importou), depois os em aberto. Empate entre lançamentos iguais
 * (mesmo valor e data, como várias taxas de R$ 0,55 no dia) é indiferente; empate entre contas em aberto diferentes
 * fica pendente, para a pessoa escolher. Chamar dentro de uma transação. Devolve quantos conciliou.
 */
export async function casarJaLancados(eid, contaId, ids = null) {
  const itens = await all(
    `SELECT id, data, valor FROM extrato_itens WHERE empresa_id = :eid AND conta_bancaria_id = :conta AND lancamento_id IS NULL AND ignorado = 0
       ${ids ? 'AND id = ANY(:ids::bigint[])' : ''} ORDER BY data, id`,
    { eid, conta: contaId, ...(ids && { ids: pgArray(ids) }) },
  );
  if (!itens.length) return 0;
  const de = itens[0].data, ate = itens[itens.length - 1].data;
  const cands = await all(
    `SELECT l.id, l.tipo, COALESCE(l.valor_pago, l.valor) AS valor, COALESCE(l.data_pagamento, l.vencimento) AS data,
       (l.data_pagamento IS NOT NULL) AS pago, lower(COALESCE(l.descricao, '') || '|' || COALESCE(l.contato, '')) AS quem
     FROM lancamentos l
     WHERE l.empresa_id = :eid
       -- perna de transferência só casa na própria conta (já paga); em aberto não existe transferência
       AND (l.transferencia_id IS NULL OR (l.data_pagamento IS NOT NULL AND l.conta_bancaria_id = :conta))
       AND l.extrato_lote_id IS NULL AND NOT EXISTS (SELECT 1 FROM extrato_itens x WHERE x.lancamento_id = l.id)
       AND ((l.data_pagamento IS NOT NULL AND l.conta_bancaria_id = :conta) OR l.data_pagamento IS NULL)
       AND COALESCE(l.data_pagamento, l.vencimento) BETWEEN (:de::date - 5) AND (:ate::date + 5)`,
    { eid, conta: contaId, de, ate },
  );
  const usados = new Set();
  let n = 0;
  for (const item of itens) {
    const tipo = item.valor > 0 ? 'receber' : 'pagar';
    const ok = cands.filter((c) => !usados.has(c.id) && c.tipo === tipo && c.valor === Math.abs(item.valor)
      && c.data.slice(0, 7) === item.data.slice(0, 7) && Math.abs(diffDays(c.data, item.data)) <= 5);
    if (!ok.length) continue;
    const grupo = ok.some((c) => c.pago) ? ok.filter((c) => c.pago) : ok;
    const menor = Math.min(...grupo.map((c) => Math.abs(diffDays(c.data, item.data))));
    const melhores = grupo.filter((c) => Math.abs(diffDays(c.data, item.data)) === menor);
    if (!melhores[0].pago && new Set(melhores.map((c) => c.quem)).size > 1) continue; // contas em aberto diferentes: a pessoa escolhe
    const escolhido = melhores[0];
    usados.add(escolhido.id);
    await conciliar(await buscarItem(item.id, eid), escolhido.id, eid);
    n++;
  }
  return n;
}

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
async function sugestoes(item, eid, q, todos = false) {
  const tipo = item.valor > 0 ? 'receber' : 'pagar';
  const valorItem = Math.abs(item.valor);
  const p = { eid, tipo, conta: item.conta_bancaria_id, hoje: hoje(), data: item.data, q: `%${q}%` };
  // Só lançamentos do mesmo mês do movimento (pela data do pagamento, ou do vencimento se em aberto), com ou sem busca.
  const filtro = `AND ${MESMO_MES_SQL} ${q ? 'AND (l.descricao ILIKE :q OR l.contato ILIKE :q OR l.documento ILIKE :q)' : ''}`;

  const candidatos = await all(
    `SELECT l.*, ${STATUS_SQL} AS status FROM lancamentos l
     WHERE l.empresa_id = :eid AND l.tipo = :tipo
       AND l.extrato_lote_id IS NULL AND NOT EXISTS (SELECT 1 FROM extrato_itens x WHERE x.lancamento_id = l.id)
       -- Sugestões e busca: só o que está em aberto. O que já foi pago é casado sozinho ao importar o extrato
       -- (casarJaLancados), não aparece como sugestão.
       AND l.data_pagamento IS NULL
       ${filtro}
     LIMIT 500`,
    p,
  );

  // Para escolher vários: tudo o que está em aberto no mês, por vencimento.
  if (todos) return candidatos.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id - b.id).map((l) => ({ ...l, valor_exato: l.valor === valorItem, dias: Math.abs(diffDays(l.vencimento, item.data)), score: 0 }));

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
  res.json(await sugestoes(item, req.eid, optText(req.query.q), req.query.todos === '1'));
});

// Valor do banco diferente do lançamento: a pessoa diz o que é a diferença antes de conciliar. Banco maior: multa, juros
// ou o valor total mudou; banco menor: desconto, pagamento parcial (abate do lançamento e o restante continua em aberto,
// como numa previsão de anúncios) ou o valor total mudou. Fica no extrato para mostrar e para o Desfazer.
const MOTIVOS_DIFERENCA = { maior: ['multa', 'juros', 'valor'], menor: ['parcial', 'desconto', 'valor'] };

async function conciliar(item, lancamentoId, eid, motivo = null) {
  check(!item.lancamento_id, 'Este item já está conciliado.', 409);
  check(!item.ignorado, 'Este item está marcado como ignorado.', 409);
  const l = await buscarLancamento(lancamentoId, eid);
  check(l.tipo === (item.valor > 0 ? 'receber' : 'pagar'), 'Entradas só conciliam com contas a receber, e saídas com contas a pagar.');
  check(!l.extrato_id, 'Este lançamento já está conciliado com outro item do extrato.', 409);
  const dataLanc = l.data_pagamento ?? l.vencimento;
  check(mesDe(dataLanc) === mesDe(item.data),
    `Este lançamento é de ${dataLanc.split('-').reverse().join('/')}, outro mês. A conciliação só aceita lançamentos do mesmo mês do movimento do banco.`);
  const banco = Math.abs(item.valor);
  const diferenca = banco - (l.valor_pago ?? l.valor);
  if (diferenca !== 0) {
    check(!l.transferencia_id, 'Transferência precisa ter o mesmo valor do banco.');
    check(motivo, 'O valor do banco é diferente do lançamento: informe se é multa, juros, desconto ou se o valor total mudou.');
    check(MOTIVOS_DIFERENCA[diferenca > 0 ? 'maior' : 'menor'].includes(motivo),
      diferenca > 0 ? 'O banco tem valor maior que o lançamento: escolha multa, juros ou valor total.' : 'O banco tem valor menor que o lançamento: escolha pagamento parcial, desconto ou valor total.');
    check(motivo !== 'parcial' || !l.data_pagamento, 'Pagamento parcial só vale para lançamento em aberto.');
    check(!['valor', 'parcial'].includes(motivo) || l.valor + diferenca > 0, 'O valor do lançamento precisa ser maior que zero.');
  }
  const ajustes = {
    novo_valor: l.valor + (motivo === 'valor' || motivo === 'parcial' ? diferenca : 0),
    juros: l.juros + (motivo === 'juros' ? diferenca : 0),
    multa: l.multa + (motivo === 'multa' ? diferenca : 0),
    desconto: l.desconto - (motivo === 'desconto' ? diferenca : 0),
  };
  if (l.data_pagamento) {
    check(l.conta_bancaria_id === item.conta_bancaria_id, 'Este lançamento foi pago por outra conta bancária.');
    if (diferenca !== 0) {
      await all('UPDATE lancamentos SET valor = :novo_valor, valor_pago = :banco, juros = :juros, multa = :multa, desconto = :desconto WHERE id = :id', { ...ajustes, banco, id: l.id });
    }
  } else {
    // Conciliar um lançamento em aberto dá a baixa com a data e o valor do banco.
    await all(
      `UPDATE lancamentos SET data_pagamento = :data, valor_pago = :banco, conta_bancaria_id = :conta, origem_baixa = 'conciliacao',
         valor = :novo_valor, juros = :juros, multa = :multa, desconto = :desconto WHERE id = :id`,
      { ...ajustes, data: item.data, banco, conta: item.conta_bancaria_id, id: l.id },
    );
  }
  if (diferenca !== 0 && motivo === 'parcial') {
    await inserirLancamento({
      empresa_id: eid, tipo: l.tipo, descricao: l.descricao, contato: l.contato, contato_id: l.contato_id, tipo_receita: l.tipo_receita,
      categoria_id: l.categoria_id, conta_bancaria_id: l.conta_bancaria_id, valor: -diferenca, vencimento: l.vencimento, documento: l.documento,
      observacao: [`Restante do pagamento parcial de ${item.data.split('-').reverse().join('/')}`, l.observacao].filter(Boolean).join(' — '),
      grupo_parcelas: l.grupo_parcelas, parcela: l.parcela, total_parcelas: l.total_parcelas, restante_de: l.id, centro_custo: l.centro_custo, forma_pagamento: l.forma_pagamento,
    });
  }
  await all(
    'UPDATE extrato_itens SET lancamento_id = :lid, ajuste_motivo = :motivo, ajuste_valor = :dif WHERE id = :id',
    { lid: l.id, motivo: diferenca !== 0 ? motivo : null, dif: diferenca !== 0 ? diferenca : null, id: item.id },
  );
}

conciliacaoRouter.post('/extrato/auto-conciliar', async (req, res) => {
  const contaId = optId(req.body.conta_bancaria_id);
  const pendentes = await all(
    `${ITEM_SELECT} WHERE x.empresa_id = :eid AND x.lancamento_id IS NULL AND x.ignorado = 0 ${contaId ? 'AND x.conta_bancaria_id = :conta' : ''}
     ORDER BY x.data`,
    { eid: req.eid, conta: contaId },
  );

  // Primeiro o que já foi lançado (valor exato, até 5 dias); depois o restante pelas sugestões, só quando há um
  // candidato claramente melhor (valor exato, data próxima e sem empate).
  const conciliados = await transaction(async () => {
    let n = 0;
    const contas = [...new Set(pendentes.map((i) => i.conta_bancaria_id))];
    for (const c of contas) n += await casarJaLancados(req.eid, c);
    for (const item of pendentes) {
      if ((await get('SELECT lancamento_id FROM extrato_itens WHERE id = :id', { id: item.id })).lancamento_id) continue;
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
  await transaction(async () => {
    await conciliar(item, req.body.lancamento_id, req.eid, req.body.motivo_diferenca ?? null);
    // Centro de custo escolhido na hora de conciliar (vazio = sem centro de custo).
    if (req.body.centro_custo !== undefined) {
      await all('UPDATE lancamentos SET centro_custo = :cc WHERE id = :id AND empresa_id = :eid', { cc: optText(req.body.centro_custo), id: optId(req.body.lancamento_id), eid: req.eid });
    }
  });
  res.json(await buscarItem(item.id, req.eid));
});

// Pagamento em conjunto: um movimento do banco quita vários lançamentos em aberto. A soma precisa ser igual à do banco;
// cada lançamento recebe baixa pelo próprio valor. A escolha é sempre da pessoa (nada entra aqui sozinho).
conciliacaoRouter.post('/extrato/:id/conciliar-varios', async (req, res) => {
  const item = await buscarItem(req.params.id, req.eid);
  check(!item.lancamento_id, 'Este item já está conciliado.', 409);
  check(!item.ignorado, 'Este item está marcado como ignorado.', 409);
  const ids = [...new Set((Array.isArray(req.body.lancamento_ids) ? req.body.lancamento_ids : []).map(Number))];
  check(ids.length >= 2 && ids.every(Number.isInteger), 'Escolha pelo menos dois lançamentos.');
  const lista = [];
  for (const id of ids) lista.push(await buscarLancamento(id, req.eid));
  const tipo = item.valor > 0 ? 'receber' : 'pagar';
  for (const l of lista) {
    check(l.tipo === tipo, 'Entradas só conciliam com contas a receber, e saídas com contas a pagar.');
    check(!l.extrato_id, `"${l.descricao}" já está conciliado com outro item do extrato.`, 409);
    check(!l.data_pagamento, `"${l.descricao}" já está pago. Escolha só lançamentos em aberto.`, 409);
    check(!l.transferencia_id, 'Transferência não entra em conciliação em conjunto.');
    check(mesDe(l.vencimento) === mesDe(item.data), `"${l.descricao}" é de outro mês. A conciliação só aceita lançamentos do mesmo mês do movimento do banco.`);
  }
  const soma = lista.reduce((s, l) => s + l.valor, 0);
  const banco = Math.abs(item.valor);
  const reais = (c) => (c / 100).toFixed(2).replace('.', ',');
  check(soma === banco, `A soma dos lançamentos (R$ ${reais(soma)}) precisa ser igual ao valor do banco (R$ ${reais(banco)}).`);
  await transaction(async () => {
    await all(
      `UPDATE lancamentos SET data_pagamento = :data, valor_pago = valor, conta_bancaria_id = :conta, origem_baixa = 'conciliacao', extrato_lote_id = :x
       WHERE id = ANY(:ids::bigint[]) AND empresa_id = :eid`,
      { data: item.data, conta: item.conta_bancaria_id, x: item.id, ids: pgArray(ids), eid: req.eid },
    );
    await all('UPDATE extrato_itens SET lancamento_id = :lid, ajuste_motivo = NULL, ajuste_valor = NULL WHERE id = :id', { lid: ids[0], id: item.id });
  });
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
      centro_custo: optText(req.body.centro_custo),
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
    await all('UPDATE extrato_itens SET lancamento_id = NULL, ajuste_motivo = NULL, ajuste_valor = NULL WHERE id = :id', { id: item.id });
    // Conciliação em conjunto: todos os lançamentos do lote voltam a ficar em aberto.
    if (item.lote) {
      await all(
        "UPDATE lancamentos SET data_pagamento = NULL, valor_pago = NULL, origem_baixa = NULL, extrato_lote_id = NULL WHERE extrato_lote_id = :x AND empresa_id = :eid",
        { x: item.id, eid: req.eid },
      );
      return;
    }
    // O que a conciliação registrou por causa da diferença de valor volta como estava.
    if (item.ajuste_motivo) {
      const dif = item.ajuste_valor, motivo = item.ajuste_motivo;
      if (motivo === 'parcial') {
        // O restante volta para o lançamento; se já foi pago, precisa ser desfeito antes.
        const r = await get('SELECT id, data_pagamento FROM lancamentos WHERE restante_de = :id ORDER BY id LIMIT 1', { id: item.lancamento_id });
        check(!r?.data_pagamento, 'O restante deste pagamento parcial já foi pago: desfaça o pagamento do restante antes.', 409);
        if (r) await all('DELETE FROM lancamentos WHERE id = :id', { id: r.id });
      }
      await all(
        `UPDATE lancamentos SET valor_pago = valor_pago - :dif, valor = valor - :v, juros = juros - :j, multa = multa - :m, desconto = desconto + :d WHERE id = :id`,
        { dif, v: motivo === 'valor' || motivo === 'parcial' ? dif : 0, j: motivo === 'juros' ? dif : 0, m: motivo === 'multa' ? dif : 0, d: motivo === 'desconto' ? dif : 0, id: item.lancamento_id },
      );
    }
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
