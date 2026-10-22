import express from 'express';
import { all, get, hoje } from './db.js';
import { check, isDate, addMonths, addDays } from './util.js';
import { DENTRO_DO_RESULTADO } from './relatorios.js';

// Forecast: acompanhamento dos meses que passaram + projeção dos próximos, no formato da planilha do escritório.
// Tudo por competência (data de vencimento; valor pago quando já foi pago). Meses futuros = o que já está lançado
// em aberto (mensalidades repetidas, parcelas, despesas previstas).
export const forecastRouter = express.Router({ mergeParams: true });

const NORM_SQL = (col) => `regexp_replace(translate(lower(trim(${col})), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '\\s+', ' ', 'g')`;
const div = (a, b) => (b ? Math.round(a / b) : null); // valores em centavos: resultado inteiro
const razao = (a, b) => (b ? Math.round((a / b) * 100) / 100 : null); // ROAS com 2 casas (ex.: 3,25x)
const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);

forecastRouter.get('/relatorios/forecast', async (req, res) => {
  const h = hoje();
  const mesAtual = h.slice(0, 8) + '01';
  const de = (isDate(req.query.de) ? req.query.de : addMonths(mesAtual, -5)).slice(0, 8) + '01';
  const ate = isDate(req.query.ate) ? req.query.ate : addDays(addMonths(mesAtual, 7), -1);
  check(de <= ate, 'A data inicial deve ser anterior à final.');
  const meses = [];
  for (let m = de; m <= ate; m = addMonths(m, 1)) {
    meses.push(m.slice(0, 7));
    check(meses.length <= 24, 'Escolha um período de até 24 meses.');
  }
  const mesAnteriorAoPeriodo = addMonths(de, -1).slice(0, 7); // para calcular o churn do primeiro mês
  const p = { eid: req.eid, de: addMonths(de, -1), ate };

  const [receitas, despesas, saldoContas, movAntes, caixaMov, ajustes] = await Promise.all([
    all(
      `SELECT to_char(l.vencimento, 'YYYY-MM') AS mes, l.tipo_receita, COALESCE(c.dre, '') AS dre,
         COALESCE('c' || l.contato_id, 'n' || NULLIF(${NORM_SQL('l.contato')}, ''), 'l' || l.id) AS cliente,
         COALESCE(l.valor_pago, l.valor) AS valor
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.tipo = 'receber' AND l.vencimento BETWEEN :de AND :ate AND ${DENTRO_DO_RESULTADO}`,
      p,
    ),
    all(
      `SELECT to_char(l.vencimento, 'YYYY-MM') AS mes, COALESCE(c.id, 0) AS categoria_id, COALESCE(c.nome, 'Sem categoria') AS nome,
         COALESCE(c.grupo_forecast, 'fixo') AS grupo, SUM(COALESCE(l.valor_pago, l.valor))::bigint AS valor
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.tipo = 'pagar' AND l.vencimento BETWEEN :de AND :ate AND ${DENTRO_DO_RESULTADO}
       GROUP BY 1, 2, 3, 4`,
      p,
    ),
    get('SELECT COALESCE(SUM(saldo_inicial), 0)::bigint AS s FROM contas_bancarias WHERE empresa_id = :eid', { eid: req.eid }),
    get(
      `SELECT COALESCE(SUM(CASE WHEN l.tipo = 'receber' THEN l.valor_pago ELSE -l.valor_pago END), 0)::bigint AS s
       FROM lancamentos l LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id
       WHERE l.empresa_id = :eid AND l.data_pagamento < :de AND (cb.id IS NULL OR l.data_pagamento >= cb.data_saldo_inicial)`,
      { eid: req.eid, de },
    ),
    // Caixa: realizado na data do pagamento; em aberto no vencimento (os vencidos contam como hoje).
    all(
      `SELECT to_char(CASE WHEN l.data_pagamento IS NOT NULL THEN l.data_pagamento ELSE GREATEST(l.vencimento, :hoje::date) END, 'YYYY-MM') AS mes,
         SUM(CASE WHEN l.tipo = 'receber' THEN 1 ELSE -1 END * COALESCE(l.valor_pago, l.valor))::bigint AS valor
       FROM lancamentos l LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id
       WHERE l.empresa_id = :eid
         AND ((l.data_pagamento IS NOT NULL AND l.data_pagamento BETWEEN :de AND :ate AND (cb.id IS NULL OR l.data_pagamento >= cb.data_saldo_inicial))
           OR (l.data_pagamento IS NULL AND l.vencimento <= :ate))
       GROUP BY 1`,
      { eid: req.eid, de, ate, hoje: h },
    ),
    all("SELECT mes, campo, valor FROM forecast_ajustes WHERE empresa_id = :eid AND mes BETWEEN :de AND :ate", { eid: req.eid, de: de.slice(0, 7), ate: ate.slice(0, 7) }),
  ]);
  const ajuste = (campo, m) => ajustes.find((a) => a.campo === campo && a.mes === m)?.valor;

  // ---------- Receitas por mês: vendas e base recorrente ----------
  const todosMeses = [mesAnteriorAoPeriodo, ...meses];
  const porMes = Object.fromEntries(
    todosMeses.map((m) => [m, { receita: 0, nova: { n: 0, v: 0 }, avulsa: { n: 0, v: 0 }, recorrente: { n: 0, v: 0 }, semTipo: 0, base: new Map() }]),
  );
  for (const r of receitas) {
    const m = porMes[r.mes];
    if (!m) continue;
    m.receita += r.valor;
    if (r.dre && r.dre !== 'receita_bruta') continue; // outras receitas (reembolsos, financeiras) entram na receita, mas não são venda
    const tipo = r.tipo_receita ?? 'avulsa'; // sem classificação conta como venda avulsa
    if (!r.tipo_receita) m.semTipo += 1;
    m[tipo].n += 1;
    m[tipo].v += r.valor;
    if (tipo !== 'avulsa') m.base.set(r.cliente, (m.base.get(r.cliente) ?? 0) + r.valor); // base recorrente (MRR por cliente)
  }

  // ---------- Despesas por grupo e categoria ----------
  const grupos = { investimento: {}, imposto_anuncio: {}, variavel: {}, fixo: {} };
  const categorias = { variavel: new Map(), fixo: new Map() };
  for (const d of despesas) {
    if (!meses.includes(d.mes)) continue;
    grupos[d.grupo][d.mes] = (grupos[d.grupo][d.mes] ?? 0) + d.valor;
    if (categorias[d.grupo]) {
      const chave = `${d.categoria_id}`;
      if (!categorias[d.grupo].has(chave)) categorias[d.grupo].set(chave, { id: `cat-${chave}`, nome: d.nome, valores: {} });
      const c = categorias[d.grupo].get(chave);
      c.valores[d.mes] = (c.valores[d.mes] ?? 0) + d.valor;
    }
  }

  // ---------- Monta as linhas ----------
  const linha = (id, nome, formato, fn, total = 'soma') => {
    const valores = Object.fromEntries(meses.map((m, i) => [m, fn(m, i)]));
    const soma = meses.reduce((s, m) => s + (valores[m] ?? 0), 0);
    return { id, nome, formato, valores, total: total === 'soma' ? soma : typeof total === 'function' ? total() : null };
  };
  const g = (grupo, m) => grupos[grupo][m] ?? 0;
  const mesAnterior = (i) => porMes[todosMeses[i]]; // todosMeses[i] é o mês anterior a meses[i]
  const perdidos = (m, i) => [...mesAnterior(i).base.keys()].filter((c) => !porMes[m].base.has(c));
  const churnFin = (m, i) => perdidos(m, i).reduce((s, c) => s + mesAnterior(i).base.get(c), 0);
  const clientes = (m) => ajuste('clientes', m) ?? porMes[m].base.size;
  const mrr = (m) => [...porMes[m].base.values()].reduce((s, v) => s + v, 0);
  const vendasN = (m) => porMes[m].nova.n + porMes[m].avulsa.n;
  const vendasV = (m) => porMes[m].nova.v + porMes[m].avulsa.v;
  const midia = (m) => g('investimento', m) + g('imposto_anuncio', m);
  const totalVariavel = (m) => g('variavel', m);
  const totalFixo = (m) => g('fixo', m);
  const lucro = (m) => porMes[m].receita - midia(m) - totalVariavel(m) - totalFixo(m);
  const somaPeriodo = (fn) => meses.reduce((s, m) => s + fn(m), 0);

  let saldo = saldoContas.s + movAntes.s;
  const caixaPorMes = Object.fromEntries(caixaMov.map((c) => [c.mes, c.valor]));
  const caixa = Object.fromEntries(meses.map((m) => [m, (saldo += caixaPorMes[m] ?? 0)]));

  const linhasCategoria = (grupo) =>
    [...categorias[grupo].values()]
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((c) => linha(c.id, c.nome, 'moeda', (m) => c.valores[m] ?? 0));

  const blocos = [
    {
      id: 'performance', titulo: 'Investimento e Performance',
      linhas: [
        linha('investimento', 'Investimento (R$)', 'moeda', (m) => g('investimento', m)),
        linha('imposto_anuncio', 'Imposto anúncio', 'moeda', (m) => g('imposto_anuncio', m)),
        linha('roas', 'ROAS (novas vendas ÷ investimento)', 'roas', (m) => razao(vendasV(m), midia(m)), () => razao(somaPeriodo(vendasV), somaPeriodo(midia))),
      ],
    },
    {
      id: 'vendas', titulo: 'Vendas',
      linhas: [
        linha('vendas', 'Vendas (nº)', 'numero', vendasN),
        linha('vendas_recorrentes', 'Vendas recorrentes (novos contratos)', 'numero', (m) => porMes[m].nova.n),
        linha('vendas_unicas', 'Vendas únicas (avulsas)', 'numero', (m) => porMes[m].avulsa.n),
        linha('receita_vendas', 'Receita de novas vendas (R$)', 'moeda', vendasV),
      ],
      destaque: linha('ticket_vendas', 'Ticket médio (R$)', 'moeda', (m) => div(vendasV(m), vendasN(m)), () => div(somaPeriodo(vendasV), somaPeriodo(vendasN))),
    },
    {
      id: 'retencao', titulo: 'Retenção',
      linhas: [
        { ...linha('clientes', 'Número de clientes totais', 'numero', clientes, null), editavel: true, calculados: Object.fromEntries(meses.map((m) => [m, porMes[m].base.size])), ajustados: meses.filter((m) => ajuste('clientes', m) !== undefined) },
        linha('churn_clientes', 'Churn de clientes (perdidos)', 'numero', (m, i) => perdidos(m, i).length),
        linha('taxa_churn_clientes', 'Taxa de churn (clientes)', 'pct', (m, i) => pct(perdidos(m, i).length, clientes(todosMeses[i])), null),
        linha('taxa_churn_financeiro', 'Taxa de churn (financeiro)', 'pct', (m, i) => pct(churnFin(m, i), mrr(todosMeses[i])), null),
        linha('recorrencia', 'Recorrência (R$)', 'moeda', mrr),
        linha('churn_financeiro', 'Churn financeiro (R$)', 'moeda', churnFin),
        linha('ticket_recorrente', 'Ticket médio recorrente (R$)', 'moeda', (m) => div(mrr(m), clientes(m)), null),
      ],
    },
    { id: 'receita', titulo: 'Receita', linhas: [], destaque: linha('receita', 'Receita (R$)', 'moeda', (m) => porMes[m].receita) },
    { id: 'variaveis', titulo: 'Custos variáveis (R$)', linhas: linhasCategoria('variavel'), destaque: linha('total_variavel', 'Total de custos variáveis', 'moeda', totalVariavel) },
    { id: 'fixos', titulo: 'Custos fixos (R$)', linhas: linhasCategoria('fixo'), destaque: linha('total_fixo', 'Total de custos fixos', 'moeda', totalFixo) },
    {
      id: 'resultado', titulo: 'Resultado',
      linhas: [
        linha('lucro', 'Lucro (R$)', 'moeda', lucro),
        linha('lucro_pct', 'Lucro (%)', 'pct', (m) => pct(lucro(m), porMes[m].receita), () => pct(somaPeriodo(lucro), somaPeriodo((m) => porMes[m].receita))),
        linha('caixa', 'Caixa (R$)', 'moeda', (m) => caixa[m], () => caixa[meses.at(-1)]),
      ],
    },
  ];

  res.json({
    de,
    ate,
    hoje: h,
    meses: meses.map((m) => ({ mes: m, status: m < mesAtual.slice(0, 7) ? 'realizado' : m === mesAtual.slice(0, 7) ? 'atual' : 'projecao' })),
    blocos,
    sem_tipo: meses.reduce((s, m) => s + porMes[m].semTipo, 0),
  });
});

// Valores do Forecast informados à mão (hoje: número de clientes totais do mês). valor vazio volta ao calculado.
const CAMPOS_AJUSTE = ['clientes'];
forecastRouter.put('/relatorios/forecast/ajustes', async (req, res) => {
  const { mes, campo } = req.body;
  check(/^\d{4}-(0[1-9]|1[0-2])$/.test(mes ?? ''), 'Mês inválido.');
  check(CAMPOS_AJUSTE.includes(campo), 'Campo inválido.');
  const valor = req.body.valor === null || req.body.valor === '' ? null : Number(req.body.valor);
  check(valor === null || (Number.isInteger(valor) && valor >= 0), 'Informe um número inteiro (ou deixe vazio para usar o calculado).');
  if (valor === null) await all('DELETE FROM forecast_ajustes WHERE empresa_id = :eid AND mes = :mes AND campo = :campo', { eid: req.eid, mes, campo });
  else await all(
    `INSERT INTO forecast_ajustes (empresa_id, mes, campo, valor) VALUES (:eid, :mes, :campo, :valor)
     ON CONFLICT (empresa_id, mes, campo) DO UPDATE SET valor = excluded.valor`,
    { eid: req.eid, mes, campo, valor },
  );
  res.json({ ok: true });
});
