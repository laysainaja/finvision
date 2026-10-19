import express from 'express';
import { all, get, hoje } from './db.js';
import { check, isDate, optId, addMonths, addDays, inicioPeriodo, proximoPeriodo } from './util.js';

export const fluxoRouter = express.Router({ mergeParams: true });

// Fluxo de caixa:
// - realizado = lançamentos pagos, na data do pagamento;
// - previsto  = lançamentos em aberto, no vencimento (os vencidos entram como "hoje", pois ainda vão sair/entrar do caixa).
fluxoRouter.get('/fluxo-caixa', async (req, res) => {
  const h = hoje();
  const agrupar = ['dia', 'semana', 'mes'].includes(req.query.agrupar) ? req.query.agrupar : 'mes';
  const de = isDate(req.query.de) ? req.query.de : addMonths(h.slice(0, 8) + '01', -2);
  const ate = isDate(req.query.ate) ? req.query.ate : addDays(addMonths(h.slice(0, 8) + '01', 4), -1);
  check(de <= ate, 'A data inicial deve ser anterior à final.');
  const contaId = optId(req.query.conta_id);

  const filtroConta = contaId ? 'AND l.conta_bancaria_id = :conta' : '';
  const base = { eid: req.eid, ...(contaId && { conta: contaId }) };
  // Mesma regra do saldo das contas: movimentos anteriores à data do saldo inicial já estão embutidos nele.
  const dentroDoSaldo = '(cb.id IS NULL OR l.data_pagamento >= cb.data_saldo_inicial)';

  const [saldoContas, movAntes, realizados, abertos, categoriasLista] = await Promise.all([
    get(`SELECT COALESCE(SUM(saldo_inicial), 0)::bigint AS s FROM contas_bancarias WHERE empresa_id = :eid ${contaId ? 'AND id = :conta' : ''}`, base),
    get(
      `SELECT COALESCE(SUM(CASE WHEN l.tipo = 'receber' THEN l.valor_pago ELSE -l.valor_pago END), 0)::bigint AS s
       FROM lancamentos l LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id
       WHERE l.empresa_id = :eid AND l.data_pagamento < :de AND ${dentroDoSaldo} ${filtroConta}`,
      { ...base, de },
    ),
    all(
      `SELECT l.tipo, l.data_pagamento AS data, l.valor_pago AS valor, l.categoria_id
       FROM lancamentos l LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id
       WHERE l.empresa_id = :eid AND l.data_pagamento BETWEEN :de AND :ate AND ${dentroDoSaldo} ${filtroConta}`,
      { ...base, de, ate },
    ),
    ate < h
      ? []
      : all(
          `SELECT l.tipo, l.vencimento AS data, l.valor, l.categoria_id
           FROM lancamentos l WHERE l.empresa_id = :eid AND l.data_pagamento IS NULL AND l.vencimento <= :ate ${filtroConta}`,
          { ...base, ate },
        ),
    all('SELECT id, nome, tipo FROM categorias WHERE empresa_id = :eid', { eid: req.eid }),
  ]);
  const saldoInicial = saldoContas.s + movAntes.s;
  const previstos = abertos.map((l) => ({ ...l, data: l.data < h ? h : l.data })).filter((l) => l.data >= de);

  // Monta os períodos vazios primeiro, para que dias/meses sem movimento também apareçam.
  const periodos = [];
  const indice = new Map();
  for (let ini = inicioPeriodo(de, agrupar); ini <= ate; ini = proximoPeriodo(ini, agrupar)) {
    check(periodos.length < 400, 'Período longo demais para esse agrupamento. Use semana ou mês.');
    indice.set(ini, periodos.length);
    periodos.push({
      inicio: ini,
      fim: addDays(proximoPeriodo(ini, agrupar), -1),
      entradas_realizadas: 0,
      saidas_realizadas: 0,
      entradas_previstas: 0,
      saidas_previstas: 0,
      saldo_final: 0,
    });
  }

  const categorias = new Map(categoriasLista.map((c) => [c.id, c]));
  const porCategoria = new Map();

  const acumular = (lista, sufixo) => {
    for (const l of lista) {
      const p = periodos[indice.get(inicioPeriodo(l.data, agrupar))];
      if (!p) continue;
      p[(l.tipo === 'receber' ? 'entradas_' : 'saidas_') + sufixo] += l.valor;

      const chave = l.categoria_id ?? `sem-${l.tipo}`;
      if (!porCategoria.has(chave)) {
        const c = categorias.get(l.categoria_id);
        porCategoria.set(chave, { categoria_id: l.categoria_id, nome: c?.nome ?? 'Sem categoria', tipo: l.tipo, realizado: 0, previsto: 0 });
      }
      porCategoria.get(chave)[sufixo === 'realizadas' ? 'realizado' : 'previsto'] += l.valor;
    }
  };
  acumular(realizados, 'realizadas');
  acumular(previstos, 'previstas');

  let saldo = saldoInicial;
  let menor = null;
  for (const p of periodos) {
    saldo += p.entradas_realizadas + p.entradas_previstas - p.saidas_realizadas - p.saidas_previstas;
    p.saldo_final = saldo;
    if (p.fim >= h && (!menor || saldo < menor.saldo)) menor = { inicio: p.inicio, saldo };
  }

  const soma = (k) => periodos.reduce((s, p) => s + p[k], 0);
  res.json({
    de,
    ate,
    agrupar,
    hoje: h,
    saldo_inicial: saldoInicial,
    saldo_final: saldo,
    totais: {
      entradas_realizadas: soma('entradas_realizadas'),
      saidas_realizadas: soma('saidas_realizadas'),
      entradas_previstas: soma('entradas_previstas'),
      saidas_previstas: soma('saidas_previstas'),
    },
    menor_saldo_futuro: menor,
    periodos,
    por_categoria: [...porCategoria.values()].sort((a, b) => b.realizado + b.previsto - (a.realizado + a.previsto)),
  });
});
