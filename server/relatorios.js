import express from 'express';
import { all, get, hoje } from './db.js';
import { check, isDate, optId, addMonths, addDays, diffDays } from './util.js';

export const relatoriosRouter = express.Router({ mergeParams: true });

/** Filtro SQL (categorias com alias "c") que deixa de fora transferências e empréstimos: não são receita nem despesa. */
export const DENTRO_DO_RESULTADO = "COALESCE(c.dre, '') <> 'fora_resultado'";

// ---------- Período e regime ----------

/** Lista de meses 'YYYY-MM' entre duas datas (inclusive). */
function mesesEntre(de, ate) {
  const meses = [];
  for (let m = de.slice(0, 8) + '01'; m <= ate; m = addMonths(m, 1)) {
    meses.push(m.slice(0, 7));
    check(meses.length <= 36, 'Escolha um período de até 36 meses.');
  }
  return meses;
}

function lerPeriodo(q) {
  const h = hoje();
  const fimMesAtual = addDays(addMonths(h.slice(0, 8) + '01', 1), -1);
  const ate = isDate(q.ate) ? q.ate : fimMesAtual;
  const de = isDate(q.de) ? q.de : addMonths(ate.slice(0, 8) + '01', -11); // últimos 12 meses
  check(de <= ate, 'A data inicial deve ser anterior à final.');
  // Caixa: o que foi pago/recebido, na data do pagamento. Competência: tudo, pela data de vencimento.
  const regime = q.regime === 'competencia' ? 'competencia' : 'caixa';
  return { de, ate, regime, meses: mesesEntre(de, ate), contaId: optId(q.conta_id) };
}

/** Valores agrupados por mês e pela chave pedida, já no regime escolhido. */
function movimentos({ eid, de, ate, regime, contaId }, chave) {
  const data = regime === 'caixa' ? 'l.data_pagamento' : 'l.vencimento';
  const valor = regime === 'caixa' ? 'l.valor_pago' : 'COALESCE(l.valor_pago, l.valor)';
  return all(
    `SELECT l.tipo, to_char(${data}, 'YYYY-MM') AS mes, ${chave} AS chave, SUM(${valor})::bigint AS valor
     FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id LEFT JOIN contatos ct ON ct.id = l.contato_id
     WHERE l.empresa_id = :eid AND ${data} BETWEEN :de AND :ate AND ${DENTRO_DO_RESULTADO} ${contaId ? 'AND l.conta_bancaria_id = :conta' : ''}
     GROUP BY 1, 2, 3`,
    { eid, de, ate, ...(contaId && { conta: contaId }) },
  );
}

const somaMeses = (meses) => Object.fromEntries(meses.map((m) => [m, 0]));

// ---------- DRE gerencial ----------

const GRUPOS_DRE = [
  { id: 'receita_bruta', nome: 'Receita bruta', sinal: 1 },
  { id: 'deducao', nome: '(−) Deduções e impostos sobre o faturamento', sinal: -1 },
  { id: '=receita_liquida', nome: '= Receita líquida', soma: ['receita_bruta', 'deducao'] },
  { id: 'custo', nome: '(−) Custos (mercadorias e serviços)', sinal: -1 },
  { id: '=lucro_bruto', nome: '= Lucro bruto', soma: ['receita_bruta', 'deducao', 'custo'] },
  { id: 'despesa_operacional', nome: '(−) Despesas operacionais', sinal: -1 },
  { id: '=resultado_operacional', nome: '= Resultado operacional', soma: ['receita_bruta', 'deducao', 'custo', 'despesa_operacional'] },
  { id: 'receita_financeira', nome: '(+) Receitas financeiras', sinal: 1 },
  { id: 'despesa_financeira', nome: '(−) Despesas financeiras', sinal: -1 },
  { id: 'outra_receita', nome: '(+) Outras receitas', sinal: 1 },
  { id: 'outra_despesa', nome: '(−) Outras despesas', sinal: -1 },
  { id: '=resultado_liquido', nome: '= Resultado líquido', soma: ['receita_bruta', 'deducao', 'custo', 'despesa_operacional', 'receita_financeira', 'despesa_financeira', 'outra_receita', 'outra_despesa'] },
];

relatoriosRouter.get('/relatorios/dre', async (req, res) => {
  const p = lerPeriodo(req.query);
  const linhas = await movimentos({ eid: req.eid, ...p }, `json_build_array(COALESCE(l.categoria_id, 0), COALESCE(c.nome, 'Sem categoria'), COALESCE(c.dre, ''))::text`);

  // Agrupa por linha da DRE e, dentro dela, por categoria. Receitas entram positivas, despesas negativas.
  const grupos = new Map(GRUPOS_DRE.filter((g) => !g.soma).map((g) => [g.id, { valores: somaMeses(p.meses), categorias: new Map() }]));
  for (const r of linhas) {
    const [catNum, nome, dreCat] = JSON.parse(r.chave);
    const catId = String(catNum);
    const receita = r.tipo === 'receber';
    const grupo = grupos.has(dreCat) ? dreCat : receita ? 'receita_bruta' : 'despesa_operacional';
    const v = receita ? r.valor : -r.valor;
    const g = grupos.get(grupo);
    g.valores[r.mes] += v;
    if (!g.categorias.has(catId)) g.categorias.set(catId, { id: Number(catId) || null, nome, valores: somaMeses(p.meses) });
    g.categorias.get(catId).valores[r.mes] += v;
  }

  const total = (valores) => Object.values(valores).reduce((s, v) => s + v, 0);
  const receitaBruta = total(grupos.get('receita_bruta').valores);
  const av = (t) => (receitaBruta ? Math.round((t / receitaBruta) * 10000) / 100 : null);
  const resultado = [];
  for (const g of GRUPOS_DRE) {
    if (g.soma) {
      const valores = somaMeses(p.meses);
      for (const id of g.soma) for (const m of p.meses) valores[m] += grupos.get(id).valores[m];
      const t = total(valores);
      resultado.push({ id: g.id.slice(1), nome: g.nome, tipo: 'resultado', valores, total: t, av: av(t) });
      continue;
    }
    const dados = grupos.get(g.id);
    const t = total(dados.valores);
    const categorias = [...dados.categorias.values()]
      .map((c) => ({ ...c, total: total(c.valores), av: av(total(c.valores)) }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    resultado.push({ id: g.id, nome: g.nome, tipo: 'grupo', valores: dados.valores, total: t, av: av(t), categorias });
  }
  res.json({ de: p.de, ate: p.ate, regime: p.regime, meses: p.meses, linhas: resultado });
});

// ---------- Análise de recebimentos / pagamentos ----------

/** Como cada linha da análise é agrupada. Por cliente/fornecedor: pelo cadastro (o mesmo cliente escrito de jeitos diferentes soma junto). */
function chaveAnalise(q) {
  const tipo = q.tipo === 'pagar' ? 'pagar' : 'receber';
  const agrupar = ['categoria', 'contato'].includes(q.agrupar) ? q.agrupar : 'categoria';
  const chave = agrupar === 'categoria' ? `COALESCE(c.nome, 'Sem categoria')` : `COALESCE(ct.nome, NULLIF(trim(l.contato), ''), 'Sem ${tipo === 'receber' ? 'cliente' : 'fornecedor'} informado')`;
  return { tipo, agrupar, chave };
}

// Os lançamentos que formam uma linha da análise (ao clicar na categoria ou no cliente/fornecedor).
relatoriosRouter.get('/relatorios/analise/lancamentos', async (req, res) => {
  const p = lerPeriodo(req.query);
  const { tipo, chave } = chaveAnalise(req.query);
  check(typeof req.query.nome === 'string' && req.query.nome, 'Informe a linha da análise.');
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes ?? '') ? req.query.mes : null;
  const data = p.regime === 'caixa' ? 'l.data_pagamento' : 'l.vencimento';
  const valor = p.regime === 'caixa' ? 'l.valor_pago' : 'COALESCE(l.valor_pago, l.valor)';
  res.json(await all(
    `SELECT l.id, ${data} AS data, l.descricao, COALESCE(ct.nome, l.contato) AS contato, c.nome AS categoria, cb.nome AS conta,
       ${valor} AS valor, l.data_pagamento, l.vencimento, l.juros, l.multa, l.desconto
     FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id LEFT JOIN contatos ct ON ct.id = l.contato_id
       LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id
     WHERE l.empresa_id = :eid AND l.tipo = :tipo AND ${data} BETWEEN :de AND :ate AND ${DENTRO_DO_RESULTADO} AND ${chave} = :nome
       ${mes ? `AND to_char(${data}, 'YYYY-MM') = :mes` : ''} ${p.contaId ? 'AND l.conta_bancaria_id = :conta' : ''}
     ORDER BY ${data}, l.id LIMIT 2000`,
    { eid: req.eid, tipo, de: p.de, ate: p.ate, nome: req.query.nome, ...(mes && { mes }), ...(p.contaId && { conta: p.contaId }) },
  ));
});

relatoriosRouter.get('/relatorios/analise', async (req, res) => {
  const p = lerPeriodo(req.query);
  const { tipo, agrupar, chave } = chaveAnalise(req.query);
  const linhas = (await movimentos({ eid: req.eid, ...p }, chave)).filter((r) => r.tipo === tipo);

  const itens = new Map();
  const totais = somaMeses(p.meses);
  for (const r of linhas) {
    if (!itens.has(r.chave)) itens.set(r.chave, { nome: r.chave, valores: somaMeses(p.meses), total: 0 });
    const it = itens.get(r.chave);
    it.valores[r.mes] += r.valor;
    it.total += r.valor;
    totais[r.mes] += r.valor;
  }
  const totalGeral = Object.values(totais).reduce((s, v) => s + v, 0);
  const lista = [...itens.values()]
    .map((i) => ({ ...i, av: totalGeral ? Math.round((i.total / totalGeral) * 10000) / 100 : 0 }))
    .sort((a, b) => b.total - a.total);
  res.json({ de: p.de, ate: p.ate, regime: p.regime, tipo, agrupar, meses: p.meses, itens: lista, totais, total: totalGeral });
});

// ---------- Contas vencidas (inadimplência) por faixa de atraso ----------

const FAIXAS = [
  { id: 'ate30', nome: '1 a 30 dias', max: 30 },
  { id: 'ate60', nome: '31 a 60 dias', max: 60 },
  { id: 'ate90', nome: '61 a 90 dias', max: 90 },
  { id: 'mais90', nome: 'Mais de 90 dias', max: Infinity },
];

// ---------- Relatório do mês (o que já foi realizado) ----------
// Receitas e despesas pagas/recebidas no período (toda despesa conta, como no Forecast; transferências entre contas
// próprias ficam de fora porque se anulam), receita por cliente e pagamentos por categoria.
relatoriosRouter.get('/relatorios/mensal', async (req, res) => {
  check(isDate(req.query.de) && isDate(req.query.ate) && req.query.de <= req.query.ate, 'Período inválido.');
  const p = { eid: req.eid, de: req.query.de, ate: req.query.ate };
  const base = `FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id LEFT JOIN contatos ct ON ct.id = l.contato_id
    WHERE l.empresa_id = :eid AND l.data_pagamento BETWEEN :de AND :ate AND l.transferencia_id IS NULL`;
  const [totais, clientes, pagamentos] = await Promise.all([
    get(`SELECT COALESCE(SUM(CASE WHEN l.tipo = 'receber' THEN l.valor_pago END), 0)::bigint AS receitas,
           COALESCE(SUM(CASE WHEN l.tipo = 'pagar' THEN l.valor_pago END), 0)::bigint AS despesas,
           COUNT(*) FILTER (WHERE l.tipo = 'receber')::int AS n_receitas, COUNT(*) FILTER (WHERE l.tipo = 'pagar')::int AS n_despesas ${base}`, p),
    all(`SELECT COALESCE(ct.nome, NULLIF(trim(l.contato), ''), 'Sem cliente informado') AS nome, SUM(l.valor_pago)::bigint AS total, COUNT(*)::int AS n
         ${base} AND l.tipo = 'receber' GROUP BY 1 ORDER BY 2 DESC`, p),
    all(`SELECT COALESCE(c.nome, 'Sem categoria') AS nome, SUM(l.valor_pago)::bigint AS total, COUNT(*)::int AS n
         ${base} AND l.tipo = 'pagar' GROUP BY 1 ORDER BY 2 DESC`, p),
  ]);
  res.json({ de: p.de, ate: p.ate, ...totais, total: totais.receitas - totais.despesas, clientes, pagamentos });
});

relatoriosRouter.get('/relatorios/vencidos', async (req, res) => {
  const h = hoje();
  const tipo = req.query.tipo === 'pagar' ? 'pagar' : 'receber';
  const abertos = await all(
    `SELECT l.id, l.descricao, COALESCE(ct.nome, l.contato) AS contato, l.vencimento, l.valor, l.parcela, l.total_parcelas, c.nome AS categoria_nome
     FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id LEFT JOIN contatos ct ON ct.id = l.contato_id
     WHERE l.empresa_id = :eid AND l.tipo = :tipo AND l.data_pagamento IS NULL AND l.vencimento < :hoje
     ORDER BY l.vencimento`,
    { eid: req.eid, tipo, hoje: h },
  );
  const totais = Object.fromEntries(FAIXAS.map((f) => [f.id, 0]));
  const porContato = new Map();
  for (const l of abertos) {
    const dias = diffDays(h, l.vencimento);
    const faixa = FAIXAS.find((f) => dias <= f.max).id;
    totais[faixa] += l.valor;
    const nome = l.contato?.trim() || `Sem ${tipo === 'receber' ? 'cliente' : 'fornecedor'} informado`;
    if (!porContato.has(nome)) porContato.set(nome, { nome, ...Object.fromEntries(FAIXAS.map((f) => [f.id, 0])), total: 0, qtd: 0, maior_atraso: 0, lancamentos: [] });
    const c = porContato.get(nome);
    c[faixa] += l.valor;
    c.total += l.valor;
    c.qtd += 1;
    c.maior_atraso = Math.max(c.maior_atraso, dias);
    c.lancamentos.push({ ...l, dias });
  }
  res.json({
    hoje: h,
    tipo,
    faixas: FAIXAS.map(({ id, nome }) => ({ id, nome })),
    totais,
    total: Object.values(totais).reduce((s, v) => s + v, 0),
    contatos: [...porContato.values()].sort((a, b) => b.total - a.total),
  });
});
