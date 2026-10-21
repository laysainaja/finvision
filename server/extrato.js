import express from 'express';
import { all, get, hoje } from './db.js';
import { check, isDate, optId, optText, addMonths, addDays } from './util.js';

// Extrato de movimentações: contas a receber e a pagar numa lista única, em ordem de data,
// com o saldo acumulado do caixa (só o que já foi pago/recebido mexe no saldo).
export const extratoRouter = express.Router({ mergeParams: true });

extratoRouter.get('/movimentacoes', async (req, res) => {
  const h = hoje();
  const de = isDate(req.query.de) ? req.query.de : h.slice(0, 8) + '01';
  const ate = isDate(req.query.ate) ? req.query.ate : addDays(addMonths(de.slice(0, 8) + '01', 1), -1);
  check(de <= ate, 'A data inicial deve ser anterior à final.');
  const contaId = optId(req.query.conta_id);
  const categoriaId = optId(req.query.categoria_id);
  const q = optText(req.query.q);
  const tipo = ['receita', 'despesa'].includes(req.query.tipo) ? req.query.tipo : null;
  const situacao = ['aberto', 'vencido', 'realizado', 'em_aberto'].includes(req.query.situacao) ? req.query.situacao : null;

  // Data que vale no extrato: a do pagamento, se já foi pago; senão a do vencimento.
  const where = ['l.empresa_id = :eid', 'COALESCE(l.data_pagamento, l.vencimento) BETWEEN :de AND :ate'];
  const p = { eid: req.eid, de, ate, hoje: h };
  if (contaId) (where.push('l.conta_bancaria_id = :conta'), (p.conta = contaId));
  // Categoria e busca são aplicadas depois, em memória: o saldo acumulado precisa de todos os movimentos da conta.
  const normalizar = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const termo = q && normalizar(q);

  const linhas = await all(
    `SELECT l.id, l.tipo, l.descricao, l.contato, l.contato_id, l.tipo_receita, l.documento, l.valor, l.valor_pago, l.vencimento, l.data_pagamento,
       l.parcela, l.total_parcelas, l.categoria_id, l.conta_bancaria_id,
       c.nome AS categoria_nome, cb.nome AS conta_nome,
       COALESCE(l.data_pagamento, l.vencimento) AS data,
       (SELECT x.id FROM extrato_itens x WHERE x.lancamento_id = l.id) AS extrato_id
     FROM lancamentos l
     LEFT JOIN categorias c ON c.id = l.categoria_id
     LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(l.data_pagamento, l.vencimento), l.data_pagamento IS NULL, l.id`,
    p,
  );

  // Saldo antes do período (mesma regra do saldo das contas: considera movimentos a partir da data do saldo inicial).
  const filtroConta = contaId ? 'AND cb.id = :conta' : '';
  const baseSaldo = { eid: req.eid, de, ...(contaId && { conta: contaId }) };
  const [iniContas, movAntes] = await Promise.all([
    get(`SELECT COALESCE(SUM(cb.saldo_inicial), 0)::bigint AS s FROM contas_bancarias cb WHERE cb.empresa_id = :eid ${filtroConta}`, baseSaldo),
    get(
      `SELECT COALESCE(SUM(CASE WHEN l.tipo = 'receber' THEN l.valor_pago ELSE -l.valor_pago END), 0)::bigint AS s
       FROM lancamentos l JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id
       WHERE l.empresa_id = :eid AND l.data_pagamento < :de AND l.data_pagamento >= cb.data_saldo_inicial ${filtroConta}`,
      baseSaldo,
    ),
  ]);
  const saldoInicial = iniContas.s + movAntes.s;

  const resumo = { receitas_aberto: 0, receitas_realizadas: 0, despesas_aberto: 0, despesas_realizadas: 0, total_periodo: 0 };
  let saldo = saldoInicial;
  const itens = [];
  for (const l of linhas) {
    const pago = !!l.data_pagamento;
    const receita = l.tipo === 'receber';
    const valor = pago ? l.valor_pago : l.valor;
    const sit = pago ? (receita ? 'recebido' : 'pago') : l.vencimento < h ? 'vencido' : 'aberto';
    if (pago) saldo += receita ? valor : -valor;

    if (categoriaId && l.categoria_id !== categoriaId) continue;
    if (termo && ![l.descricao, l.contato, l.documento, l.categoria_nome].some((t) => normalizar(t).includes(termo))) continue;
    // Os cartões somam o período com busca/conta/categoria, mas sem o filtro de tipo e situação,
    // para que funcionem como atalhos de filtro.
    resumo[`${receita ? 'receitas' : 'despesas'}_${pago ? 'realizadas' : 'aberto'}`] += valor;

    if (tipo && (tipo === 'receita') !== receita) continue;
    if (situacao === 'realizado' && !pago) continue;
    if (situacao === 'em_aberto' && pago) continue;
    if (situacao === 'aberto' && sit !== 'aberto') continue;
    if (situacao === 'vencido' && sit !== 'vencido') continue;
    itens.push({ ...l, situacao: sit, valor_extrato: receita ? valor : -valor, saldo: pago ? saldo : null });
  }
  resumo.total_periodo = resumo.receitas_aberto + resumo.receitas_realizadas - resumo.despesas_aberto - resumo.despesas_realizadas;

  res.json({ de, ate, hoje: h, saldo_inicial: saldoInicial, saldo_final: saldo, resumo, itens });
});
