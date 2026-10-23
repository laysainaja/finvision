import express from 'express';
import { all, get, hoje } from './db.js';
import { check, isDate, isCents, optId, optText, addMonths, addDays } from './util.js';
import { FORMAS_PAGAMENTO } from './api.js';

// De onde veio o lançamento (filtro "Origem do lançamento").
export const ORIGENS = {
  manual: 'Lançado no FinVision',
  conta_azul: 'Importado do Conta Azul',
  planilha: 'Importado de planilha',
  conciliacao: 'Criado na conciliação',
  transferencia: 'Transferência entre contas',
  parcial: 'Restante de pagamento parcial',
};
const ORIGEM_SQL = `CASE
    WHEN l.transferencia_id IS NOT NULL THEN 'transferencia'
    WHEN l.restante_de IS NOT NULL THEN 'parcial'
    WHEN l.observacao LIKE 'Importado do Conta Azul%' THEN 'conta_azul'
    WHEN l.observacao LIKE 'Despesa recorrente (planilha%' THEN 'planilha'
    WHEN l.observacao = 'Criado a partir do extrato bancário' THEN 'conciliacao'
    ELSE 'manual' END`;

// Extrato de movimentações: contas a receber e a pagar numa lista única, em ordem de data,
// com o saldo acumulado do caixa (só o que já foi pago/recebido mexe no saldo).
export const extratoRouter = express.Router({ mergeParams: true });

extratoRouter.get('/movimentacoes', async (req, res) => {
  const h = hoje();
  const de = isDate(req.query.de) ? req.query.de : h.slice(0, 8) + '01';
  const ate = isDate(req.query.ate) ? req.query.ate : addDays(addMonths(de.slice(0, 8) + '01', 1), -1);
  check(de <= ate, 'A data inicial deve ser anterior à final.');
  const contaId = optId(req.query.conta_id);
  // Categorias desmarcadas no filtro (0 = sem categoria). Vazio = todas.
  const ocultas = new Set(String(req.query.ocultar_categorias ?? '').split(',').filter((x) => /^\d+$/.test(x)).map(Number));
  const q = optText(req.query.q);
  const tipo = ['receita', 'despesa'].includes(req.query.tipo) ? req.query.tipo : null;
  const situacao = ['aberto', 'vencido', 'realizado', 'em_aberto'].includes(req.query.situacao) ? req.query.situacao : null;
  // Mais filtros (todos opcionais). Valores em centavos; datas 'YYYY-MM-DD'.
  const qv = (k) => (req.query[k] === undefined || req.query[k] === '' ? null : String(req.query[k]));
  const centavos = (k) => { const v = qv(k); if (v === null) return null; const n = Number(v); check(isCents(n), `Valor inválido em ${k}.`); return n; };
  const data = (k) => { const v = qv(k); if (v === null) return null; check(isDate(v), `Data inválida em ${k}.`); return v; };
  const f = {
    contato: optId(req.query.contato_id),
    origem: Object.keys(ORIGENS).includes(qv('origem')) ? qv('origem') : null,
    recorrencia: ['com', 'sem'].includes(qv('recorrencia')) ? qv('recorrencia') : null,
    conciliacao: ['conciliado', 'nao_conciliado'].includes(qv('conciliacao')) ? qv('conciliacao') : null,
    baixa: ['manual', 'conciliacao', 'sem'].includes(qv('baixa')) ? qv('baixa') : null,
    centro: qv('centro_custo'),
    forma: qv('forma_pagamento'),
    abertoMin: centavos('aberto_min'), abertoMax: centavos('aberto_max'),
    pagoMin: centavos('pago_min'), pagoMax: centavos('pago_max'),
    vencDe: data('venc_de'), vencAte: data('venc_ate'),
    cadDe: data('cad_de'), cadAte: data('cad_ate'),
    prevDe: data('prev_de'), prevAte: data('prev_ate'),
  };
  const passa = (l, pago) => {
    if (f.contato && l.contato_id !== f.contato) return false;
    if (f.origem && l.origem !== f.origem) return false;
    if (f.recorrencia && (f.recorrencia === 'com') !== ((l.total_parcelas ?? 0) > 1)) return false;
    if (f.conciliacao && (f.conciliacao === 'conciliado') !== !!l.extrato_id) return false;
    if (f.baixa === 'sem' && pago) return false;
    if (f.baixa && f.baixa !== 'sem' && l.origem_baixa !== f.baixa) return false;
    if (f.centro && (f.centro === '__sem' ? l.centro_custo : l.centro_custo !== f.centro)) return false;
    if (f.forma && (f.forma === '__sem' ? l.forma_pagamento : l.forma_pagamento !== f.forma)) return false;
    if (f.abertoMin !== null || f.abertoMax !== null) {
      if (pago || (f.abertoMin !== null && l.valor < f.abertoMin) || (f.abertoMax !== null && l.valor > f.abertoMax)) return false;
    }
    if (f.pagoMin !== null || f.pagoMax !== null) {
      if (!pago || (f.pagoMin !== null && l.valor_pago < f.pagoMin) || (f.pagoMax !== null && l.valor_pago > f.pagoMax)) return false;
    }
    if ((f.vencDe && l.vencimento < f.vencDe) || (f.vencAte && l.vencimento > f.vencAte)) return false;
    if ((f.cadDe && l.cadastro < f.cadDe) || (f.cadAte && l.cadastro > f.cadAte)) return false;
    const prev = l.data_prevista ?? l.vencimento;
    if ((f.prevDe && prev < f.prevDe) || (f.prevAte && prev > f.prevAte)) return false;
    return true;
  };

  // Data que vale no extrato: a do pagamento, se já foi pago; senão a do vencimento.
  const where = ['l.empresa_id = :eid', 'COALESCE(l.data_pagamento, l.vencimento) BETWEEN :de AND :ate'];
  const p = { eid: req.eid, de, ate, hoje: h };
  if (contaId) (where.push('l.conta_bancaria_id = :conta'), (p.conta = contaId));
  // Categoria e busca são aplicadas depois, em memória: o saldo acumulado precisa de todos os movimentos da conta.
  const normalizar = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const termo = q && normalizar(q);

  const linhas = await all(
    `SELECT l.id, l.tipo, l.descricao, l.contato, l.contato_id, l.tipo_receita, l.documento, l.valor, l.valor_pago, l.vencimento, l.data_pagamento,
       l.parcela, l.total_parcelas, l.categoria_id, l.conta_bancaria_id, l.transferencia_id,
       l.centro_custo, l.forma_pagamento, l.data_prevista, l.origem_baixa, ${ORIGEM_SQL} AS origem,
       to_char(l.criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS cadastro,
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

    if (ocultas.has(l.categoria_id ?? 0)) continue;
    if (!passa(l, pago)) continue;
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

// Opções dos filtros: clientes/fornecedores com lançamento, centros de custo usados, formas de pagamento e origens.
extratoRouter.get('/movimentacoes/opcoes', async (req, res) => {
  const [contatos, centros] = await Promise.all([
    all(
      `SELECT DISTINCT ct.id, ct.nome FROM contatos ct JOIN lancamentos l ON l.contato_id = ct.id
       WHERE ct.empresa_id = :eid ORDER BY ct.nome`,
      { eid: req.eid },
    ),
    all(`SELECT DISTINCT centro_custo AS nome FROM lancamentos WHERE empresa_id = :eid AND centro_custo IS NOT NULL ORDER BY 1`, { eid: req.eid }),
  ]);
  res.json({ contatos, centros_custo: centros.map((c) => c.nome), formas_pagamento: FORMAS_PAGAMENTO, origens: ORIGENS });
});
