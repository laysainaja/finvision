// Markup dia a dia (empresas de produto): faturamento ÷ CMV de cada dia e acumulado no mês, comparado com os mesmos dias de
// outro mês. Mesmo critério do Dashboard de produto (CMV = categorias de custo; sem aportes, reserva e transferências).
// Compras não acontecem todo dia, então o número que dá para comparar é o acumulado até aquele dia.
import express from 'express';
import { all, hoje } from './db.js';
import { check, addMonths, addDays } from './util.js';
import { DENTRO_DO_RESULTADO, SEM_TRANSFERENCIA } from './relatorios.js';

export const markupRouter = express.Router({ mergeParams: true });

const mesValido = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? '');
const ultimoDia = (mes) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
const fator = (fat, cmv) => (cmv ? Math.round((fat / cmv) * 100) / 100 : null);

// O iFood recebe na quarta, mas a venda é do dia escrito na descrição ("Vendas iFood 28/10").
function dataDaVenda(descricao, data) {
  const m = /^Vendas iFood (\d{2})\/(\d{2})$/.exec(descricao ?? '');
  if (!m) return data;
  const ano = Number(data.slice(0, 4));
  const d = `${ano}-${m[2]}-${m[1]}`;
  return d > data ? `${ano - 1}-${m[2]}-${m[1]}` : d;
}

async function dadosDoMes(eid, mes) {
  const ini = `${mes}-01`;
  const fim = `${mes}-${String(ultimoDia(mes)).padStart(2, '0')}`;
  const [vendas, custos] = await Promise.all([
    all(
      `SELECT COALESCE(l.data_pagamento, l.vencimento) AS data, l.descricao, COALESCE(l.valor_pago, l.valor) AS valor
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.tipo = 'receber' AND COALESCE(c.dre, '') IN ('', 'receita_bruta') AND ${DENTRO_DO_RESULTADO} AND ${SEM_TRANSFERENCIA}
         AND COALESCE(l.data_pagamento, l.vencimento) BETWEEN :ini AND :limite`,
      { eid, ini, limite: addDays(fim, 15) },
    ),
    all(
      `SELECT l.data_pagamento AS data, l.valor_pago AS valor
       FROM lancamentos l JOIN categorias c ON c.id = l.categoria_id
       WHERE l.empresa_id = :eid AND l.tipo = 'pagar' AND c.dre = 'custo' AND ${SEM_TRANSFERENCIA} AND l.data_pagamento BETWEEN :ini AND :fim`,
      { eid, ini, fim },
    ),
  ]);
  const fat = {}, cmv = {};
  for (const v of vendas) {
    const d = dataDaVenda(v.descricao, v.data);
    if (d >= ini && d <= fim) fat[Number(d.slice(8))] = (fat[Number(d.slice(8))] ?? 0) + Number(v.valor);
  }
  for (const c of custos) cmv[Number(c.data.slice(8))] = (cmv[Number(c.data.slice(8))] ?? 0) + Number(c.valor);
  return { fat, cmv, ultimo: ultimoDia(mes) };
}

markupRouter.get('/relatorios/markup-diario', async (req, res) => {
  const mesHoje = hoje().slice(0, 7);
  const mes = req.query.mes ?? mesHoje;
  check(mesValido(mes), 'Mês inválido.');
  check(mes <= mesHoje, 'Escolha um mês que já começou.');
  const comparar = req.query.comparar ?? addMonths(`${mes}-01`, -1).slice(0, 7);
  check(mesValido(comparar), 'Mês de comparação inválido.');
  const [atual, outro] = await Promise.all([dadosDoMes(req.eid, mes), dadosDoMes(req.eid, comparar)]);
  // No mês corrente, vai até hoje: comparar um mês fechado com um pela metade não diria nada.
  const ateDia = mes === mesHoje ? Number(hoje().slice(8)) : atual.ultimo;
  const dias = [];
  const a = { fat: 0, cmv: 0 }, b = { fat: 0, cmv: 0 };
  for (let d = 1; d <= ateDia; d++) {
    const faturamento = atual.fat[d] ?? 0, cmv = atual.cmv[d] ?? 0;
    a.fat += faturamento;
    a.cmv += cmv;
    const temOutro = d <= outro.ultimo;
    const fatOutro = temOutro ? outro.fat[d] ?? 0 : 0, cmvOutro = temOutro ? outro.cmv[d] ?? 0 : 0;
    b.fat += fatOutro;
    b.cmv += cmvOutro;
    dias.push({
      dia: d, data: `${mes}-${String(d).padStart(2, '0')}`, faturamento, cmv, markup: fator(faturamento, cmv),
      faturamento_acum: a.fat, cmv_acum: a.cmv, markup_acum: fator(a.fat, a.cmv),
      comparado: temOutro ? { faturamento: fatOutro, cmv: cmvOutro, faturamento_acum: b.fat, cmv_acum: b.cmv, markup_acum: fator(b.fat, b.cmv) } : null,
    });
  }
  res.json({
    mes, comparar, ate_dia: ateDia, dias,
    total: { faturamento: a.fat, cmv: a.cmv, markup: fator(a.fat, a.cmv), retorno: a.fat - a.cmv },
    total_comparado: { faturamento: b.fat, cmv: b.cmv, markup: fator(b.fat, b.cmv), retorno: b.fat - b.cmv },
  });
});
