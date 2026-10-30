// Provisão de folha: quanto separar todo mês para 13º, férias + 1/3 e o FGTS sobre eles, e quanto já está acumulado.
// - CLT: 13º = base ÷ 12; férias = base ÷ 12; 1/3 = base ÷ 36; FGTS = 8% dos três; multa de 40% do FGTS opcional.
// - Estágio: só o recesso remunerado (30 dias por ano) = base ÷ 12, sem 13º nem FGTS.
// - PJ e sócio (pró-labore): não geram provisão (aparecem na lista para conferência).
// Base = média mensal do que foi pago à pessoa nos últimos 12 meses (salário + comissões, como manda a lei para 13º e
// férias), pelo cadastro de cliente/fornecedor ligado; sem pagamentos, vale o salário base informado. O primeiro salário
// (proporcional aos dias do mês da admissão, pago até o dia 10 do mês seguinte) fica fora da média.
// Mês conta para 13º e férias quando a pessoa trabalhou 15 dias ou mais nele. INSS patronal não entra: no Simples
// Nacional (anexos III e V) ele já está dentro do DAS.
import express from 'express';
import { all, get, hoje } from './db.js';
import { check, isDate, isCents, optText, optId, idParam, addMonths, addDays } from './util.js';

export const folhaRouter = express.Router({ mergeParams: true });

const VINCULOS = ['clt', 'estagio', 'pj', 'socio'];
const CATEGORIAS_SALARIO = '(sal[aá]rio|comiss|gratifica|bonifica|pr[eê]mio|hora.?extra|estagi|bolsa)';

// ---------- Cadastro ----------

folhaRouter.get('/colaboradores', async (req, res) => {
  res.json(await all(
    `SELECT co.*, ct.nome AS contato_nome FROM colaboradores co LEFT JOIN contatos ct ON ct.id = co.contato_id
     WHERE co.empresa_id = :eid ORDER BY co.demissao NULLS FIRST, co.nome`,
    { eid: req.eid },
  ));
});

async function lerColaborador(body, eid) {
  const c = {
    nome: optText(body.nome)?.replace(/\s+/g, ' '),
    vinculo: body.vinculo,
    contato_id: optId(body.contato_id),
    salario_base: body.salario_base === null || body.salario_base === '' || body.salario_base === undefined ? null : body.salario_base,
    admissao: body.admissao || null,
    demissao: body.demissao || null,
    ferias_desde: body.ferias_desde || null,
    observacao: optText(body.observacao),
  };
  check(c.nome, 'Informe o nome.');
  check(VINCULOS.includes(c.vinculo), 'Escolha o vínculo.');
  check(c.salario_base === null || (isCents(c.salario_base) && c.salario_base >= 0), 'Salário base inválido.');
  for (const k of ['admissao', 'demissao', 'ferias_desde']) check(c[k] === null || isDate(c[k]), 'Data inválida.');
  if (c.vinculo === 'clt' || c.vinculo === 'estagio') check(c.admissao, 'Informe a data de admissão.');
  check(!c.demissao || !c.admissao || c.demissao >= c.admissao, 'A demissão não pode ser antes da admissão.');
  if (c.contato_id) check(await get('SELECT 1 FROM contatos WHERE id = :id AND empresa_id = :eid', { id: c.contato_id, eid }), 'Cadastro inválido.');
  return c;
}

const CAMPOS = ['nome', 'vinculo', 'contato_id', 'salario_base', 'admissao', 'demissao', 'ferias_desde', 'observacao'];

folhaRouter.post('/colaboradores', async (req, res) => {
  const c = await lerColaborador(req.body, req.eid);
  res.status(201).json(await get(
    `INSERT INTO colaboradores (empresa_id, ${CAMPOS.join(', ')}) VALUES (:eid, ${CAMPOS.map((k) => ':' + k).join(', ')}) RETURNING *`,
    { ...c, eid: req.eid },
  ));
});

folhaRouter.put('/colaboradores/:id', async (req, res) => {
  const c = await lerColaborador(req.body, req.eid);
  const r = await get(
    `UPDATE colaboradores SET ${CAMPOS.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id AND empresa_id = :eid RETURNING *`,
    { ...c, id: idParam(req.params.id), eid: req.eid },
  );
  check(r, 'Colaborador não encontrado.', 404);
  res.json(r);
});

folhaRouter.delete('/colaboradores/:id', async (req, res) => {
  const r = await get('DELETE FROM colaboradores WHERE id = :id AND empresa_id = :eid RETURNING id', { id: idParam(req.params.id), eid: req.eid });
  check(r, 'Colaborador não encontrado.', 404);
  res.json({ ok: true });
});

// ---------- Cálculo ----------

const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes 1–12

/** Meses com 15 dias ou mais trabalhados entre duas datas (inclusive). */
export function mesesTrabalhados(inicio, fim) {
  if (!inicio || !fim || fim < inicio) return 0;
  let n = 0;
  let [a, m] = inicio.split('-').map(Number);
  const [af, mf] = fim.split('-').map(Number);
  while (a < af || (a === af && m <= mf)) {
    const mm = String(m).padStart(2, '0');
    const de = `${a}-${mm}-01` < inicio ? inicio : `${a}-${mm}-01`;
    const fimMes = `${a}-${mm}-${String(ultimoDia(a, m)).padStart(2, '0')}`;
    const ate = fimMes > fim ? fim : fimMes;
    const dias = Number(ate.slice(8)) - Number(de.slice(8)) + 1;
    if (dias >= 15) n++;
    if (++m > 12) (m = 1), a++;
  }
  return n;
}

const r2 = (v) => Math.round(v);

folhaRouter.get('/relatorios/provisao-folha', async (req, res) => {
  const ref = isDate(req.query.ref) ? req.query.ref : hoje();
  const multa = req.query.multa === '1';
  const lista = await all(
    `SELECT co.* FROM colaboradores co WHERE co.empresa_id = :eid AND (co.admissao IS NULL OR co.admissao <= :ref)
       AND (co.demissao IS NULL OR co.demissao >= :ref) ORDER BY co.vinculo, co.nome`,
    { eid: req.eid, ref },
  );
  const desde = addMonths(ref, -12);
  const colaboradores = [];
  for (const c of lista) {
    // Média do que foi pago (salário + comissões) nos últimos 12 meses, pelos meses em que houve pagamento.
    const primeiro = c.admissao ? addDays(addMonths(c.admissao.slice(0, 8) + '01', 1), 9) : null; // dia 10 do mês seguinte
    const inicioMedia = primeiro && primeiro > desde ? primeiro : desde;
    const pago = c.contato_id ? await get(
      `SELECT COALESCE(SUM(l.valor_pago), 0)::bigint AS total, COUNT(DISTINCT to_char(l.data_pagamento, 'YYYY-MM'))::int AS meses
       FROM lancamentos l LEFT JOIN categorias cat ON cat.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.tipo = 'pagar' AND l.contato_id = :ct AND l.data_pagamento > :desde AND l.data_pagamento <= :ref
         AND COALESCE(cat.nome, '') ~* :cats`,
      { eid: req.eid, ct: c.contato_id, desde: inicioMedia, ref, cats: CATEGORIAS_SALARIO },
    ) : { total: 0, meses: 0 };
    const media = pago.meses ? Math.round(pago.total / pago.meses) : null;
    const base = media ?? c.salario_base ?? 0;
    const item = {
      id: c.id, nome: c.nome, vinculo: c.vinculo, admissao: c.admissao, ferias_desde: c.ferias_desde, salario_base: c.salario_base,
      media, meses_media: pago.meses, base, base_origem: media !== null ? 'media' : c.salario_base !== null ? 'salario' : null,
      mensal: { decimo: 0, ferias: 0, terco: 0, recesso: 0, fgts: 0, multa: 0, total: 0 },
      acumulado: { decimo: 0, meses_decimo: 0, ferias: 0, terco: 0, recesso: 0, meses_ferias: 0, ferias_vencidas: false, fgts: 0, multa: 0, total: 0 },
    };
    const inicioFerias = c.ferias_desde ?? c.admissao;
    if (c.vinculo === 'clt') {
      const m = item.mensal;
      m.decimo = r2(base / 12); m.ferias = r2(base / 12); m.terco = r2(base / 36);
      m.fgts = r2((m.decimo + m.ferias + m.terco) * 0.08);
      m.multa = multa ? r2(base * 0.08 * 0.4) : 0;
      m.total = m.decimo + m.ferias + m.terco + m.fgts + m.multa;
      const a = item.acumulado;
      const inicioAno = `${ref.slice(0, 4)}-01-01`;
      a.meses_decimo = mesesTrabalhados(c.admissao > inicioAno ? c.admissao : inicioAno, ref);
      a.meses_ferias = mesesTrabalhados(inicioFerias, ref);
      a.ferias_vencidas = a.meses_ferias >= 12;
      a.decimo = r2((base / 12) * a.meses_decimo);
      a.ferias = r2((base / 12) * a.meses_ferias);
      a.terco = r2(a.ferias / 3);
      a.fgts = r2((a.decimo + a.ferias + a.terco) * 0.08);
      a.multa = multa ? r2(base * 0.08 * 0.4 * mesesTrabalhados(c.admissao, ref)) : 0;
      a.total = a.decimo + a.ferias + a.terco + a.fgts + a.multa;
    } else if (c.vinculo === 'estagio') {
      item.mensal.recesso = r2(base / 12);
      item.mensal.total = item.mensal.recesso;
      const a = item.acumulado;
      a.meses_ferias = mesesTrabalhados(inicioFerias, ref);
      a.ferias_vencidas = a.meses_ferias >= 12;
      a.recesso = r2((base / 12) * a.meses_ferias);
      a.total = a.recesso;
    }
    colaboradores.push(item);
  }
  const soma = (k, campo) => colaboradores.reduce((s, c) => s + c[k][campo], 0);
  res.json({
    ref, multa, colaboradores,
    totais: {
      mensal: soma('mensal', 'total'),
      decimo: soma('acumulado', 'decimo'), ferias: soma('acumulado', 'ferias') + soma('acumulado', 'terco'), recesso: soma('acumulado', 'recesso'),
      fgts: soma('acumulado', 'fgts') + soma('acumulado', 'multa'), acumulado: soma('acumulado', 'total'),
    },
  });
});
