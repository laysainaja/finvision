import express from 'express';
import { all, hoje } from './db.js';
import { check, isDate, addMonths } from './util.js';
import { DENTRO_DO_RESULTADO, SEM_TRANSFERENCIA } from './relatorios.js';

// Dashboard: indicadores do período, pelo que foi de fato recebido e pago (caixa, data do pagamento).
// Mesmas definições do Forecast: cliente = cadastro (ou o nome digitado), base recorrente = quem pagou receita
// recorrente ou nova venda no mês, churn = quem estava na base do mês anterior e não pagou neste.
export const dashboardRouter = express.Router({ mergeParams: true });

const NORM_SQL = (col) => `regexp_replace(translate(lower(trim(${col})), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '\\s+', ' ', 'g')`;
const div = (a, b) => (b ? Math.round(a / b) : null); // centavos
const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);

dashboardRouter.get('/relatorios/dashboard', async (req, res) => {
  check(isDate(req.query.de) && isDate(req.query.ate) && req.query.de <= req.query.ate, 'Período inválido.');
  const { de, ate } = req.query;
  const meses = [];
  for (let m = de.slice(0, 8) + '01'; m <= ate; m = addMonths(m, 1)) {
    meses.push(m.slice(0, 7));
    check(meses.length <= 36, 'Escolha um período de até 36 meses.');
  }
  // Um mês antes do período, para saber quem já era da base (churn do primeiro mês).
  const antes = addMonths(de.slice(0, 8) + '01', -1);
  const p = { eid: req.eid, de, ate, antes };

  const mesHoje = hoje().slice(0, 7);
  const [receitas, abertos, despesas, fora, historico] = await Promise.all([
    all(
      `SELECT to_char(l.data_pagamento, 'YYYY-MM') AS mes, l.data_pagamento >= :de::date AS no_periodo, l.tipo_receita, COALESCE(c.dre, '') AS dre,
         COALESCE('c' || l.contato_id, 'n' || NULLIF(${NORM_SQL('l.contato')}, ''), 'l' || l.id) AS cliente, l.valor_pago AS valor
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.tipo = 'receber' AND l.data_pagamento BETWEEN :antes AND :ate AND ${DENTRO_DO_RESULTADO}`,
      p,
    ),
    // Cobrança recorrente em aberto no mês: o cliente continua na base (está atrasado, não saiu).
    all(
      `SELECT to_char(l.vencimento, 'YYYY-MM') AS mes,
         COALESCE('c' || l.contato_id, 'n' || NULLIF(${NORM_SQL('l.contato')}, ''), 'l' || l.id) AS cliente
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.tipo = 'receber' AND l.data_pagamento IS NULL AND l.tipo_receita IN ('recorrente', 'nova')
         AND l.vencimento BETWEEN :antes AND :ate AND ${DENTRO_DO_RESULTADO}`,
      p,
    ),
    all(
      `SELECT to_char(l.data_pagamento, 'YYYY-MM') AS mes, COALESCE(c.grupo_forecast, 'fixo') AS grupo, SUM(l.valor_pago)::bigint AS valor
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.tipo = 'pagar' AND l.data_pagamento BETWEEN :de AND :ate AND ${DENTRO_DO_RESULTADO}
       GROUP BY 1, 2`,
      p,
    ),
    // Aportes, reserva e empréstimos entram no resultado (como no Forecast); transferências entre contas se anulam.
    all(
      `SELECT to_char(l.data_pagamento, 'YYYY-MM') AS mes, SUM(CASE WHEN l.tipo = 'receber' THEN 1 ELSE -1 END * l.valor_pago)::bigint AS valor
       FROM lancamentos l JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND c.dre = 'fora_resultado' AND c.nome !~* '^transfer' AND l.transferencia_id IS NULL
         AND l.data_pagamento BETWEEN :de AND :ate
       GROUP BY 1`,
      p,
    ),
    // Tudo o que cada cliente já pagou, mês a mês (para o LTV: mesmo critério do LTV por cliente, menos transferências).
    all(
      `SELECT COALESCE('c' || l.contato_id, 'n' || NULLIF(${NORM_SQL('l.contato')}, ''), 'l' || l.id) AS cliente,
         to_char(l.data_pagamento, 'YYYY-MM') AS mes, SUM(l.valor_pago)::bigint AS valor
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.tipo = 'receber' AND l.data_pagamento <= :ate AND ${SEM_TRANSFERENCIA}
       GROUP BY 1, 2`,
      p,
    ),
  ]);

  // ---------- Por mês ----------
  const vazio = () => ({ receita: 0, nova: 0, recorrente: 0, ativos: new Set(), novos: new Set(), recorrentes: new Set(), base: new Set(),
    clientes: new Set(), variavel: 0, midia: 0, fixo: 0, fora: 0 });
  const mesAnterior = antes.slice(0, 7);
  const porMes = Object.fromEntries([mesAnterior, ...meses].map((m) => [m, vazio()]));
  for (const r of receitas) {
    const m = porMes[r.mes];
    if (!m) continue;
    const venda = !r.dre || r.dre === 'receita_bruta'; // reembolsos e receitas financeiras não são venda
    if (venda && (r.tipo_receita === 'recorrente' || r.tipo_receita === 'nova')) m.base.add(r.cliente);
    if (!r.no_periodo) continue; // mês anterior: só serve para a base
    m.receita += r.valor;
    m.ativos.add(r.cliente);
    if (!venda) continue;
    m.clientes.add(r.cliente); // cliente ativo no mês: comprou (de qualquer tipo) ou tem cobrança recorrente em aberto
    if (r.tipo_receita === 'nova') (m.nova += r.valor, m.novos.add(r.cliente));
    if (r.tipo_receita === 'recorrente') (m.recorrente += r.valor, m.recorrentes.add(r.cliente));
  }
  for (const a of abertos) {
    porMes[a.mes]?.base.add(a.cliente);
    if (a.mes !== mesAnterior) porMes[a.mes]?.clientes.add(a.cliente);
  }
  // Total pago por cliente até o fim de um mês
  const pagos = new Map();
  for (const h of historico) (pagos.get(h.cliente) ?? pagos.set(h.cliente, []).get(h.cliente)).push(h);
  const pagoAte = (cliente, mes) => (pagos.get(cliente) ?? []).reduce((s, h) => s + (h.mes <= mes ? h.valor : 0), 0);
  for (const d of despesas) {
    const m = porMes[d.mes];
    if (!m) continue;
    if (d.grupo === 'variavel') m.variavel += d.valor;
    else if (d.grupo === 'investimento' || d.grupo === 'imposto_anuncio') m.midia += d.valor;
    else m.fixo += d.valor;
  }
  for (const f of fora) if (porMes[f.mes]) porMes[f.mes].fora += f.valor;

  const indicadores = (lista) => {
    const soma = (fn) => lista.reduce((s, x) => s + fn(x), 0);
    const receita = soma((x) => x.m.receita);
    const nova = soma((x) => x.m.nova);
    const recorrente = soma((x) => x.m.recorrente);
    // "cliente-mês": cada cliente conta uma vez em cada mês em que pagou
    const novosCM = soma((x) => x.m.novos.size);
    const recorrentesCM = soma((x) => x.m.recorrentes.size);
    const ambosCM = soma((x) => new Set([...x.m.novos, ...x.m.recorrentes]).size);
    const ativosCM = soma((x) => x.m.ativos.size);
    const custosVariaveis = soma((x) => x.m.variavel + x.m.midia);
    const fixo = soma((x) => x.m.fixo);
    const foraR = soma((x) => x.m.fora);
    const contribuicao = receita - custosVariaveis;
    const resultado = contribuicao - fixo + foraR;
    // Churn só nos meses que já chegaram (nos futuros ninguém pagou ainda).
    const comChurn = lista.filter((x) => x.mes <= mesHoje);
    const baseAnterior = comChurn.reduce((s, x) => s + x.anterior.base.size, 0);
    const perdidos = comChurn.reduce((s, x) => s + [...x.anterior.base].filter((c) => !x.m.base.has(c)).length, 0);
    const churn = baseAnterior ? perdidos / baseAnterior : null; // churn mensal médio
    const arpu = div(receita, ativosCM);
    const mcPct = pct(contribuicao, receita);
    // LTV: média do que cada cliente ativo no período já pagou desde o início (até o fim do período).
    const clientes = new Set(lista.flatMap((x) => [...x.m.clientes]));
    const fim = lista[lista.length - 1].mes;
    const ltv = div([...clientes].reduce((s, c) => s + pagoAte(c, fim), 0), clientes.size);
    return {
      receita, receita_nova: nova, receita_recorrente: recorrente,
      novos_clientes: new Set(lista.flatMap((x) => [...x.m.novos])).size,
      clientes_ativos: new Set(lista.flatMap((x) => [...x.m.ativos])).size,
      ticket_novos: div(nova, novosCM), ticket_recorrentes: div(recorrente, recorrentesCM), ticket_total: div(nova + recorrente, ambosCM),
      arpu,
      custos_variaveis: custosVariaveis, custos_fixos: fixo, fora_resultado: foraR,
      margem_contribuicao: contribuicao, margem_contribuicao_pct: mcPct,
      resultado, margem_lucro_pct: pct(resultado, receita),
      churn_pct: churn === null ? null : Math.round(churn * 10000) / 100,
      clientes_perdidos: perdidos,
      vida_media_meses: churn ? Math.round((1 / churn) * 10) / 10 : null,
      clientes_ltv: clientes.size,
      ltv,
      ltv_margem: ltv === null || mcPct === null ? null : Math.round(ltv * (mcPct / 100)),
    };
  };

  const lista = meses.map((mes, i) => ({ mes, m: porMes[mes], anterior: porMes[i === 0 ? mesAnterior : meses[i - 1]] }));
  res.json({
    de, ate, meses,
    total: indicadores(lista),
    por_mes: lista.map((x) => ({ mes: x.mes, ...indicadores([x]) })),
  });
});

// ---------- LTV por cliente ----------
// Todo o histórico de cada cliente: tudo o que ele já pagou (o LTV realizado), há quanto tempo é cliente e se ainda está
// ativo. Mesmo critério das análises: entra tudo o que foi recebido, menos transferências entre contas.
// O nome é o mesmo da Receita por cliente (cadastro, ou o nome digitado), para o clique abrir os mesmos lançamentos.
const NOME_CLIENTE = `COALESCE(ct.nome, NULLIF(trim(l.contato), ''))`;

dashboardRouter.get('/relatorios/ltv', async (req, res) => {
  const h = hoje();
  const mesAnterior = addMonths(h.slice(0, 8) + '01', -1); // pagou do mês passado para cá = ativo
  const p = { eid: req.eid };
  const base = `FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id LEFT JOIN contatos ct ON ct.id = l.contato_id
    WHERE l.empresa_id = :eid AND l.tipo = 'receber' AND ${SEM_TRANSFERENCIA} AND ${NOME_CLIENTE} IS NOT NULL`;
  const [clientes, abertos, margem] = await Promise.all([
    all(
      `SELECT ${NOME_CLIENTE} AS nome, min(l.data_pagamento) AS desde, max(l.data_pagamento) AS ultimo,
         count(DISTINCT to_char(l.data_pagamento, 'YYYY-MM'))::int AS meses, count(*)::int AS recebimentos, SUM(l.valor_pago)::bigint AS total
       ${base} AND l.data_pagamento IS NOT NULL GROUP BY 1`,
      p,
    ),
    // Quem tem cobrança em aberto continua sendo cliente (mesmo atrasado).
    all(`SELECT DISTINCT ${NOME_CLIENTE} AS nome ${base} AND l.data_pagamento IS NULL`, p),
    // Margem de contribuição da empresa em todo o histórico (como no Dashboard): (receita − variáveis − anúncios) ÷ receita.
    all(
      `SELECT l.tipo, COALESCE(c.grupo_forecast, 'fixo') AS grupo, SUM(l.valor_pago)::bigint AS valor
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.data_pagamento IS NOT NULL AND ${DENTRO_DO_RESULTADO}
       GROUP BY 1, 2`,
      p,
    ),
  ]);
  const receita = margem.filter((m) => m.tipo === 'receber').reduce((s, m) => s + m.valor, 0);
  const variaveis = margem.filter((m) => m.tipo === 'pagar' && ['variavel', 'investimento', 'imposto_anuncio'].includes(m.grupo)).reduce((s, m) => s + m.valor, 0);
  const mc = receita ? (receita - variaveis) / receita : null;
  const comAberto = new Set(abertos.map((a) => a.nome));
  res.json({
    hoje: h,
    margem_contribuicao_pct: mc === null ? null : Math.round(mc * 10000) / 100,
    clientes: clientes
      .map((c) => {
        const ativo = c.ultimo >= mesAnterior || comAberto.has(c.nome);
        return {
          ...c,
          ticket_mensal: Math.round(c.total / c.meses),
          ltv_margem: mc === null ? null : Math.round(c.total * mc),
          situacao: ativo ? 'ativo' : 'perdido',
          // Perdido desde o mês seguinte ao último pagamento.
          perdido_desde: ativo ? null : addMonths(c.ultimo.slice(0, 8) + '01', 1).slice(0, 7),
        };
      })
      .sort((a, b) => b.total - a.total),
  });
});

// ---------- Dashboard de produto ----------
// Para quem vende mercadoria (vendas avulsas, sem cliente fixo): faturamento e comparações, CMV, markup, margens,
// ponto de equilíbrio e onde o dinheiro está indo. Pelo que foi de fato recebido e pago; sem aportes, reserva,
// empréstimos e transferências (como na DRE).
const VARIAVEIS = ['variavel', 'investimento', 'imposto_anuncio'];
const RETIRADAS = /retirad|pr[oó].?labore/i;

dashboardRouter.get('/relatorios/dashboard-produto', async (req, res) => {
  check(isDate(req.query.de) && isDate(req.query.ate) && req.query.de <= req.query.ate, 'Período inválido.');
  const { de, ate } = req.query;
  const meses = [];
  for (let m = de.slice(0, 8) + '01'; m <= ate; m = addMonths(m, 1)) {
    meses.push(m.slice(0, 7));
    check(meses.length <= 36, 'Escolha um período de até 36 meses.');
  }
  const n = meses.length;
  const desloca = (lista, k) => lista.map((m) => addMonths(m + '-01', -k).slice(0, 7));
  const linhas = await all(
    `SELECT to_char(l.data_pagamento, 'YYYY-MM') AS mes, l.tipo, COALESCE(c.dre, '') AS dre, COALESCE(c.grupo_forecast, '') AS grupo,
       COALESCE(c.nome, 'Sem categoria') AS categoria, SUM(l.valor_pago)::bigint AS valor
     FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
     WHERE l.empresa_id = :eid AND l.data_pagamento BETWEEN :ini AND :ate AND ${DENTRO_DO_RESULTADO} AND ${SEM_TRANSFERENCIA}
     GROUP BY 1, 2, 3, 4, 5`,
    { eid: req.eid, ini: addMonths(de.slice(0, 8) + '01', -Math.max(12, n)), ate },
  );
  for (const l of linhas) l.valor = Number(l.valor);
  const venda = (l) => l.tipo === 'receber' && (l.dre === '' || l.dre === 'receita_bruta');
  const faturamentoDe = (lista) => { const s = new Set(lista); return linhas.reduce((t, l) => t + (s.has(l.mes) && venda(l) ? l.valor : 0), 0); };

  const indicadores = (lista) => {
    const s = new Set(lista);
    const sel = linhas.filter((l) => s.has(l.mes));
    const soma = (fn) => sel.reduce((t, l) => t + (fn(l) ? l.valor : 0), 0);
    const pagar = (l) => l.tipo === 'pagar';
    const faturamento = soma(venda);
    const outras = soma((l) => l.tipo === 'receber' && !venda(l));
    const deducoes = soma((l) => pagar(l) && l.dre === 'deducao');
    const cmv = soma((l) => pagar(l) && l.dre === 'custo');
    const variaveis = soma((l) => pagar(l) && VARIAVEIS.includes(l.grupo));
    const despesas = soma(pagar);
    const fixos = despesas - variaveis;
    const lucroBruto = faturamento - deducoes - cmv;
    const mc = faturamento - variaveis;
    const mcPct = pct(mc, faturamento);
    const resultado = faturamento + outras - despesas;
    // Ponto de equilíbrio: quanto precisa vender por mês para pagar os custos fixos com a margem de contribuição.
    const fixoMensal = fixos / lista.length;
    const pe = mcPct > 0 ? Math.round(fixoMensal / (mcPct / 100)) : null;
    const fatMensal = faturamento / lista.length;
    return {
      faturamento, outras_receitas: outras, deducoes, cmv, custos_variaveis: variaveis, custos_fixos: fixos, despesas,
      receita_liquida: faturamento - deducoes,
      cmv_pct: pct(cmv, faturamento),
      markup: cmv ? Math.round((faturamento / cmv) * 100) / 100 : null,
      lucro_bruto: lucroBruto, margem_bruta_pct: pct(lucroBruto, faturamento),
      margem_contribuicao: mc, margem_contribuicao_pct: mcPct,
      fixos_pct: pct(fixos, faturamento),
      faturamento_mensal: Math.round(fatMensal),
      ponto_equilibrio: pe,
      margem_seguranca_pct: pe === null || !fatMensal ? null : pct(fatMensal - pe, fatMensal),
      resultado, margem_liquida_pct: pct(resultado, faturamento),
      retiradas: soma((l) => pagar(l) && RETIRADAS.test(l.categoria)),
    };
  };

  const total = indicadores(meses);
  // Média por dia: até hoje, se o período ainda não acabou.
  const fimDias = ate < hoje() ? ate : hoje();
  const dias = fimDias < de ? 0 : Math.round((Date.parse(fimDias) - Date.parse(de)) / 86400000) + 1;
  const anterior = faturamentoDe(desloca(meses, n));
  const anoPassado = faturamentoDe(desloca(meses, 12));
  const porCategoria = new Map();
  for (const l of linhas) if (l.tipo === 'pagar' && meses.includes(l.mes)) porCategoria.set(l.categoria, (porCategoria.get(l.categoria) ?? 0) + l.valor);
  const maioresDespesas = [...porCategoria].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([categoria, valor]) => ({ categoria, valor, pct_faturamento: pct(valor, total.faturamento), pct_despesas: pct(valor, total.despesas) }));

  res.json({
    de, ate, meses,
    total: {
      ...total,
      media_dia: dias ? Math.round(total.faturamento / dias) : null,
      faturamento_anterior: anterior, variacao_anterior_pct: anterior ? pct(total.faturamento - anterior, anterior) : null,
      faturamento_ano_passado: anoPassado, variacao_ano_passado_pct: anoPassado ? pct(total.faturamento - anoPassado, anoPassado) : null,
    },
    maiores_despesas: maioresDespesas,
    por_mes: meses.map((mes) => ({ mes, ...indicadores([mes]) })),
  });
});
