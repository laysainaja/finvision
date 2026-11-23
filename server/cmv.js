// CMV semanal (empresas de produto). A loja continua preenchendo a aba de CMV da planilha; o arquivo é lido no
// navegador e as semanas chegam aqui já separadas por insumo. CMV = estoque inicial + compras − estoque final.
// O relatório cruza com o FinVision: faturamento da semana (vendas pela data da venda, como no Markup) e as compras
// lançadas (categorias de custo, sem motoboy), além de alertas de preço, estoque parado e contagem errada.
import express from 'express';
import { all, get, transaction } from './db.js';
import { check, isDate, isCents, optText, idParam, addDays, diffDays } from './util.js';
import { DENTRO_DO_RESULTADO, SEM_TRANSFERENCIA } from './relatorios.js';
import { dataDaVenda } from './markup.js';

export const cmvRouter = express.Router({ mergeParams: true });

const META_PADRAO = 40;
const reais = (c) => (c / 100).toFixed(2).replace('.', ',');
const qtd = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ---------- Importação ----------

function lerSemana(s) {
  const inicio = s?.inicio, fim = s?.fim;
  check(isDate(inicio) && isDate(fim) && fim >= inicio && diffDays(fim, inicio) <= 31, 'Semana com datas inválidas.');
  check(Array.isArray(s.itens) && s.itens.length > 0 && s.itens.length <= 500, `A semana de ${inicio.split('-').reverse().join('/')} não tem itens.`);
  const itens = s.itens.map((i) => {
    const it = {
      unidade: optText(i.unidade), item: optText(i.item),
      valor_unit: i.valor_unit ?? null, est_ini_qtd: qtd(i.est_ini_qtd), est_ini_valor: i.est_ini_valor ?? 0,
      compras: i.compras ?? 0, est_fin_qtd: qtd(i.est_fin_qtd), est_fin_valor: i.est_fin_valor ?? 0,
    };
    check(it.item, 'Item sem nome.');
    for (const k of ['est_ini_valor', 'compras', 'est_fin_valor']) check(isCents(it[k]) && it[k] >= 0, `Valor inválido em "${it.item}".`);
    check(it.valor_unit === null || (isCents(it.valor_unit) && it.valor_unit >= 0), `Preço inválido em "${it.item}".`);
    for (const k of ['est_ini_qtd', 'est_fin_qtd']) check(it[k] === null || (Number.isFinite(it[k]) && it[k] >= 0), `Quantidade inválida em "${it.item}".`);
    return it;
  });
  return { inicio, fim, itens };
}

// Sobe uma ou mais semanas; a semana que já existe (mesmo início) é substituída pela nova.
cmvRouter.post('/cmv/semanas', async (req, res) => {
  const semanas = (Array.isArray(req.body.semanas) ? req.body.semanas : []).map(lerSemana);
  check(semanas.length > 0 && semanas.length <= 10, 'Nenhuma semana para importar.');
  const resultado = await transaction(async () => {
    const r = [];
    // A meta vem da última semana já importada (a pessoa define no relatório); sem nenhuma, fica a padrão.
    const ultima = await get('SELECT meta_pct FROM cmv_semanas WHERE empresa_id = :eid AND meta_pct IS NOT NULL ORDER BY inicio DESC LIMIT 1', { eid: req.eid });
    for (const s of semanas) {
      const antiga = await get('DELETE FROM cmv_semanas WHERE empresa_id = :eid AND inicio = :inicio RETURNING id', { eid: req.eid, inicio: s.inicio });
      const nova = await get(
        'INSERT INTO cmv_semanas (empresa_id, inicio, fim, meta_pct) VALUES (:eid, :inicio, :fim, :meta) RETURNING id',
        { eid: req.eid, inicio: s.inicio, fim: s.fim, meta: ultima?.meta_pct ?? null },
      );
      for (const i of s.itens) {
        await all(
          `INSERT INTO cmv_itens (semana_id, unidade, item, valor_unit, est_ini_qtd, est_ini_valor, compras, est_fin_qtd, est_fin_valor)
           VALUES (:sid, :unidade, :item, :valor_unit, :est_ini_qtd, :est_ini_valor, :compras, :est_fin_qtd, :est_fin_valor)`,
          { ...i, sid: nova.id },
        );
      }
      r.push({ id: nova.id, inicio: s.inicio, substituida: !!antiga });
    }
    return r;
  });
  res.status(201).json({ semanas: resultado });
});

// Meta de CMV (% do faturamento): vale para todas as semanas da empresa e para as próximas importadas.
cmvRouter.put('/cmv/meta', async (req, res) => {
  const meta = Number(req.body.meta_pct);
  check(Number.isFinite(meta) && meta > 0 && meta < 100, 'Meta de CMV inválida: use um número entre 1 e 99.');
  await all('UPDATE cmv_semanas SET meta_pct = :meta WHERE empresa_id = :eid', { meta: Math.round(meta * 100) / 100, eid: req.eid });
  res.json({ ok: true });
});

cmvRouter.delete('/cmv/semanas/:id', async (req, res) => {
  const r = await get('DELETE FROM cmv_semanas WHERE id = :id AND empresa_id = :eid RETURNING id', { id: idParam(req.params.id), eid: req.eid });
  check(r, 'Semana não encontrada.', 404);
  res.json({ ok: true });
});

// ---------- Relatório ----------

async function faturamentoDaSemana(eid, inicio, fim) {
  const vendas = await all(
    `SELECT COALESCE(l.data_pagamento, l.vencimento) AS data, l.descricao, COALESCE(l.valor_pago, l.valor) AS valor
     FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
     WHERE l.empresa_id = :eid AND l.tipo = 'receber' AND COALESCE(c.dre, '') IN ('', 'receita_bruta') AND ${DENTRO_DO_RESULTADO} AND ${SEM_TRANSFERENCIA}
       AND COALESCE(l.data_pagamento, l.vencimento) BETWEEN :inicio AND :limite`,
    { eid, inicio, limite: addDays(fim, 15) },
  );
  return vendas.reduce((s, v) => {
    const d = dataDaVenda(v.descricao, v.data);
    return d >= inicio && d <= fim ? s + Number(v.valor) : s;
  }, 0);
}

// Compras de mercadoria lançadas no FinVision na semana: categorias de custo pagas, sem motoboy (que é custo, mas não compra).
async function comprasLancadas(eid, inicio, fim) {
  const r = await get(
    `SELECT COALESCE(SUM(l.valor_pago), 0)::bigint AS v FROM lancamentos l JOIN categorias c ON c.id = l.categoria_id
     WHERE l.empresa_id = :eid AND l.tipo = 'pagar' AND c.dre = 'custo' AND c.nome !~* 'motoboy' AND ${SEM_TRANSFERENCIA}
       AND l.data_pagamento BETWEEN :inicio AND :fim`,
    { eid, inicio, fim },
  );
  return Number(r.v);
}

const chave = (nome) => nome.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

function alertasDaSemana(itens, anteriores, semana) {
  const alertas = [];
  const antes = new Map((anteriores ?? []).map((i) => [chave(i.item), i]));
  for (const i of itens) {
    const a = antes.get(chave(i.item));
    if (a?.valor_unit && i.valor_unit && Math.abs(i.valor_unit - a.valor_unit) / a.valor_unit >= 0.05) {
      const subiu = i.valor_unit > a.valor_unit;
      alertas.push({ tipo: 'preco', nivel: subiu ? 'alto' : 'info', item: i.item,
        texto: `${i.item}: preço ${subiu ? 'subiu' : 'caiu'} de R$ ${reais(a.valor_unit)} para R$ ${reais(i.valor_unit)}${i.unidade ? ` por ${i.unidade}` : ''} (${subiu ? '+' : ''}${Math.round(((i.valor_unit - a.valor_unit) / a.valor_unit) * 100)}%).` });
    }
    if (i.cmv < 0) {
      alertas.push({ tipo: 'contagem', nivel: 'alto', item: i.item,
        texto: `${i.item}: o estoque final (R$ ${reais(i.est_fin_valor)}) é maior que o inicial + compras (R$ ${reais(i.est_ini_valor + i.compras)}). Confira a contagem ou se faltou lançar uma compra.` });
    } else if (i.est_fin_valor >= 10_000 && (i.cmv === 0 || i.est_fin_valor / i.cmv >= 4)) {
      alertas.push({ tipo: 'parado', nivel: 'info', item: i.item,
        texto: i.cmv === 0
          ? `${i.item}: R$ ${reais(i.est_fin_valor)} em estoque e nada consumido na semana.`
          : `${i.item}: R$ ${reais(i.est_fin_valor)} em estoque, o suficiente para ${Math.floor(i.est_fin_valor / i.cmv)} semanas no ritmo atual.` });
    }
    if (!i.valor_unit && ((i.est_ini_qtd ?? 0) > 0 || (i.est_fin_qtd ?? 0) > 0)) {
      alertas.push({ tipo: 'sem_preco', nivel: 'info', item: i.item, texto: `${i.item}: tem estoque contado, mas está sem preço; o valor dele não entra no CMV.` });
    }
  }
  const dif = semana.compras - semana.compras_lancadas;
  if (Math.abs(dif) >= 5_000 && Math.abs(dif) >= semana.compras * 0.05) {
    alertas.push({ tipo: 'compras', nivel: 'alto', item: null,
      texto: `Compras: a planilha soma R$ ${reais(semana.compras)} e o FinVision tem R$ ${reais(semana.compras_lancadas)} lançados em custo nesta semana (${dif > 0 ? 'faltam' : 'sobram'} R$ ${reais(Math.abs(dif))} no FinVision). Pode ser compra sem lançar, ou paga em outro dia.` });
  }
  const ordem = { alto: 0, info: 1 };
  return alertas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
}

cmvRouter.get('/relatorios/cmv-semanal', async (req, res) => {
  const semanas = await all('SELECT * FROM cmv_semanas WHERE empresa_id = :eid ORDER BY inicio DESC LIMIT 26', { eid: req.eid });
  semanas.reverse();
  const ids = semanas.map((s) => s.id);
  const itens = ids.length
    ? await all(`SELECT * FROM cmv_itens WHERE semana_id = ANY(:ids::bigint[]) ORDER BY id`, { ids: `{${ids.join(',')}}` })
    : [];
  const porSemana = new Map(ids.map((id) => [id, []]));
  for (const i of itens) {
    const it = { ...i, valor_unit: i.valor_unit === null ? null : Number(i.valor_unit), est_ini_valor: Number(i.est_ini_valor), compras: Number(i.compras),
      est_fin_valor: Number(i.est_fin_valor), est_ini_qtd: i.est_ini_qtd === null ? null : Number(i.est_ini_qtd), est_fin_qtd: i.est_fin_qtd === null ? null : Number(i.est_fin_qtd) };
    it.cmv = it.est_ini_valor + it.compras - it.est_fin_valor;
    porSemana.get(i.semana_id).push(it);
  }
  const saida = [];
  let anteriores = null;
  for (const s of semanas) {
    const its = porSemana.get(s.id);
    const soma = (k) => its.reduce((t, i) => t + i[k], 0);
    const inicio = s.inicio, fim = s.fim;
    const semana = {
      id: s.id, inicio, fim, meta_pct: s.meta_pct === null ? META_PADRAO : Number(s.meta_pct),
      estoque_inicial: soma('est_ini_valor'), compras: soma('compras'), estoque_final: soma('est_fin_valor'), cmv: soma('cmv'),
      faturamento: await faturamentoDaSemana(req.eid, inicio, fim), compras_lancadas: await comprasLancadas(req.eid, inicio, fim),
    };
    semana.cmv_pct = semana.faturamento ? Math.round((semana.cmv / semana.faturamento) * 10_000) / 100 : null;
    semana.markup = semana.cmv ? Math.round((semana.faturamento / semana.cmv) * 100) / 100 : null;
    semana.itens = [...its].sort((a, b) => b.cmv - a.cmv).map((i) => ({ ...i, participacao: semana.cmv ? Math.round((i.cmv / semana.cmv) * 1000) / 10 : null }));
    semana.alertas = alertasDaSemana(its, anteriores, semana);
    saida.push(semana);
    anteriores = its;
  }
  res.json({ semanas: saida, meta_padrao: META_PADRAO });
});
