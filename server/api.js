import express from 'express';
import { randomUUID } from 'node:crypto';
import { sql, all, get, transaction, hoje, STATUS_SQL } from './db.js';
import { HttpError, check, isDate, isCents, optText, optId, idParam, pgArray, addMonths, addDays, diffDays } from './util.js';
import { autenticar, authConfigurado } from './auth.js';
import { fluxoRouter } from './fluxo.js';
import { conciliacaoRouter } from './conciliacao.js';
import { equipeRouter, conviteRouter, infoConvite } from './equipe.js';
import { provedorEmail } from './email.js';
import { gestaoRouter } from './gestao.js';
import { extratoRouter } from './extrato.js';
import { relatoriosRouter } from './relatorios.js';
import { contatosRouter, resolverContato } from './contatos.js';
import { forecastRouter } from './forecast.js';

export const api = express.Router();

// Diagnóstico de implantação: diz só se cada variável existe e se o banco responde, nunca os valores.
api.get('/saude', async (req, res) => {
  const config = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    VITE_SUPABASE_URL: !!(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL),
    VITE_SUPABASE_ANON_KEY: !!(process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY),
  };
  let banco = 'não configurado';
  if (sql) {
    try {
      await sql`select 1 from membros limit 1`;
      banco = 'ok';
    } catch (e) {
      banco = `erro ${e.code ?? ''}: ${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[url]').slice(0, 120)}`;
    }
  }
  const ok = banco === 'ok' && authConfigurado;
  // E-mail é opcional: sem ele o sistema funciona, só não envia convites automaticamente.
  res.status(ok ? 200 : 503).json({ ok, config, banco, email: provedorEmail ?? 'desligado' });
});
// Pública: a tela de login mostra de qual empresa é o convite antes de a pessoa entrar.
api.get('/convites/:token', infoConvite);

api.use(autenticar);
api.use('/convites', conviteRouter);
api.use('/gestao', gestaoRouter);

// ---------- Empresas ----------
// Acesso a uma empresa: ser membro dela (cliente/equipe) OU ser membro do escritório que a gerencia.
// Quem entra pelo escritório tem poderes de dono.

export const ACESSO_SQL = `
  SELECT e.*,
    CASE WHEN em.user_id IS NOT NULL THEN 'dono' ELSE m.papel END AS papel,
    (em.user_id IS NOT NULL) AS via_escritorio,
    es.nome AS escritorio_nome
  FROM empresas e
  LEFT JOIN membros m ON m.empresa_id = e.id AND m.user_id = :uid
  LEFT JOIN escritorio_membros em ON em.escritorio_id = e.escritorio_id AND em.user_id = :uid
  LEFT JOIN escritorios es ON es.id = e.escritorio_id
  WHERE (m.user_id IS NOT NULL OR em.user_id IS NOT NULL)`;

api.get('/empresas', async (req, res) => {
  res.json(await all(`${ACESSO_SQL} ORDER BY e.nome`, { uid: req.userId }));
});

export const SEGMENTOS = ['servico', 'produto'];

export async function criarEmpresa({ nome, documento, segmento = 'servico', escritorioId = null, donoId = null }) {
  check(SEGMENTOS.includes(segmento), 'Segmento inválido.');
  const e = await get('INSERT INTO empresas (nome, documento, segmento, escritorio_id) VALUES (:nome, :doc, :seg, :esc) RETURNING *', {
    nome, doc: documento, seg: segmento, esc: escritorioId,
  });
  if (donoId) await all("INSERT INTO membros (empresa_id, user_id, papel) VALUES (:eid, :uid, 'dono')", { eid: e.id, uid: donoId });
  await criarCategoriasPadrao(e.id, segmento);
  return e;
}

// Criar empresa: só a gestão (quem é do escritório) ou quem ainda não tem nenhuma empresa (primeiro cadastro).
// Membro convidado de uma empresa não cria outras.
api.post('/empresas', async (req, res) => {
  const pode = await get(
    `SELECT EXISTS (SELECT 1 FROM escritorio_membros WHERE user_id = :uid)
        OR NOT EXISTS (SELECT 1 FROM membros WHERE user_id = :uid) AS ok`,
    { uid: req.userId },
  );
  check(pode.ok, 'Só a gestão do escritório pode criar empresas.', 403);
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome da empresa.');
  const segmento = req.body.segmento ?? 'servico';
  const empresa = await transaction(() => criarEmpresa({ nome, documento: optText(req.body.documento), segmento, donoId: req.userId }));
  res.status(201).json(empresa);
});

export async function exigirMembro(eid, userId) {
  const m = await get(`${ACESSO_SQL} AND e.id = :eid`, { eid, uid: userId });
  // 404 (e não 403) para não revelar que a empresa existe.
  check(m, 'Empresa não encontrada.', 404);
  return m;
}

api.put('/empresas/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const m = await exigirMembro(id, req.userId);
  check(m.papel === 'dono', 'Só o dono pode alterar os dados da empresa.', 403);
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome da empresa.');
  let segmento = m.segmento;
  if (req.body.segmento !== undefined && req.body.segmento !== m.segmento) {
    check(SEGMENTOS.includes(req.body.segmento), 'Segmento inválido.');
    // Empresa gerenciada por escritório: o segmento é definido pela gestão, não pelo cliente.
    check(!m.escritorio_id || m.via_escritorio, 'O segmento desta empresa é definido pelo escritório que a gerencia.', 403);
    segmento = req.body.segmento;
  }
  await all('UPDATE empresas SET nome = :nome, documento = :doc, segmento = :seg WHERE id = :id', { nome, doc: optText(req.body.documento), seg: segmento, id });
  res.json(await exigirMembro(id, req.userId));
});

// Dinheiro que entra ou sai sem ser receita nem despesa: mexe no caixa, mas fica fora da DRE e do lucro.
const MOVIMENTOS_DE_CAIXA = {
  receitas: [['Aporte de sócios', 'fora_resultado'], ['Resgate de reserva', 'fora_resultado'], ['Empréstimo recebido', 'fora_resultado']],
  despesas: [['Aplicação em reserva', 'fora_resultado', 'fixo'], ['Devolução de aporte a sócios', 'fora_resultado', 'fixo'], ['Pagamento de empréstimo', 'fora_resultado', 'fixo'], ['Distribuição de lucros', 'fora_resultado', 'fixo']],
};

// Receitas: [nome, linha da DRE]. Despesas: [nome, linha da DRE, grupo do Forecast].
// As despesas de serviço seguem a planilha de Forecast usada pelo escritório.
const CATEGORIAS_PADRAO = {
  servico: {
    receitas: [['Prestação de serviços', 'receita_bruta'], ['Mensalidades e contratos', 'receita_bruta'], ['Receitas financeiras', 'receita_financeira'], ['Outras receitas', 'outra_receita'], ...MOVIMENTOS_DE_CAIXA.receitas],
    despesas: [
      ['Investimento em anúncios', 'despesa_operacional', 'investimento'], ['Imposto sobre anúncios', 'despesa_operacional', 'imposto_anuncio'],
      ['Imposto', 'deducao', 'variavel'], ['Taxas bancárias', 'despesa_financeira', 'variavel'], ['Comissão', 'custo', 'variavel'],
      ['Pró-labore', 'despesa_operacional', 'fixo'], ['Remuneração de autônomo (colaborador)', 'custo', 'fixo'], ['Salários', 'despesa_operacional', 'fixo'],
      ['Cursos e treinamentos', 'despesa_operacional', 'fixo'], ['Móveis, utensílios e instalações administrativas', 'despesa_operacional', 'fixo'],
      ['Plataformas', 'despesa_operacional', 'fixo'], ['Software e licença de uso', 'despesa_operacional', 'fixo'],
      ['Materiais aplicados na prestação de serviço', 'custo', 'fixo'], ['Honorários contábeis', 'despesa_operacional', 'fixo'],
      ['Energia elétrica', 'despesa_operacional', 'fixo'], ['Lanches e refeições', 'despesa_operacional', 'fixo'], ['Simples atrasado', 'deducao', 'fixo'],
      ['PLR - Participação nos lucros e resultados', 'despesa_operacional', 'fixo'], ['Despesas a identificar', 'outra_despesa', 'fixo'],
      ['Vales', 'despesa_operacional', 'fixo'], ['Exames médicos', 'despesa_operacional', 'fixo'], ['Telefonia e internet', 'despesa_operacional', 'fixo'],
      ['Água e saneamento', 'despesa_operacional', 'fixo'], ['FGTS', 'despesa_operacional', 'fixo'], ['INSS', 'despesa_operacional', 'fixo'],
      ['Condomínio', 'despesa_operacional', 'fixo'], ['Materiais de limpeza e de higiene', 'despesa_operacional', 'fixo'],
      ['Materiais de escritório', 'despesa_operacional', 'fixo'], ['Gratificações', 'despesa_operacional', 'fixo'], ['Honorários advocatícios', 'despesa_operacional', 'fixo'],
      ...MOVIMENTOS_DE_CAIXA.despesas,
    ],
  },
  produto: {
    receitas: [['Venda de mercadorias', 'receita_bruta'], ['Fretes recebidos', 'receita_bruta'], ['Receitas financeiras', 'receita_financeira'], ['Outras receitas', 'outra_receita'], ...MOVIMENTOS_DE_CAIXA.receitas],
    despesas: [
      ['Investimento em anúncios', 'despesa_operacional', 'investimento'], ['Imposto sobre anúncios', 'despesa_operacional', 'imposto_anuncio'],
      ['Impostos sobre vendas', 'deducao', 'variavel'], ['Devoluções de vendas', 'deducao', 'variavel'], ['Compra de mercadorias', 'custo', 'variavel'],
      ['Fretes e entregas', 'custo', 'variavel'], ['Embalagens', 'custo', 'variavel'], ['Comissão', 'custo', 'variavel'], ['Taxas bancárias', 'despesa_financeira', 'variavel'],
      ['Salários e encargos', 'despesa_operacional', 'fixo'], ['Pró-labore', 'despesa_operacional', 'fixo'], ['Aluguel', 'despesa_operacional', 'fixo'],
      ['Energia elétrica', 'despesa_operacional', 'fixo'], ['Telefonia e internet', 'despesa_operacional', 'fixo'], ['Software e licença de uso', 'despesa_operacional', 'fixo'],
      ['Honorários contábeis', 'despesa_operacional', 'fixo'], ['Outras despesas', 'outra_despesa', 'fixo'],
      ...MOVIMENTOS_DE_CAIXA.despesas,
    ],
  },
};

export const LINHAS_DRE = ['receita_bruta', 'deducao', 'custo', 'despesa_operacional', 'receita_financeira', 'despesa_financeira', 'outra_receita', 'outra_despesa', 'fora_resultado'];
export const GRUPOS_FORECAST = ['investimento', 'imposto_anuncio', 'variavel', 'fixo'];
const DRE_PADRAO = { receita: 'receita_bruta', despesa: 'despesa_operacional' };
const forecastPadrao = (dre) => (['deducao', 'custo', 'despesa_financeira'].includes(dre) ? 'variavel' : 'fixo');

export async function criarCategoriasPadrao(empresaId, segmento = 'servico') {
  const { receitas, despesas } = CATEGORIAS_PADRAO[segmento] ?? CATEGORIAS_PADRAO.servico;
  const todas = [...receitas.map(([n, d]) => [n, 'receita', d, '']), ...despesas.map(([n, d, f]) => [n, 'despesa', d, f])];
  await all(
    `INSERT INTO categorias (empresa_id, nome, tipo, dre, grupo_forecast)
     SELECT :eid::bigint, n, t, d, NULLIF(f, '') FROM unnest(:nomes::text[], :tipos::text[], :dres::text[], :fcs::text[]) AS u(n, t, d, f)`,
    {
      eid: empresaId,
      nomes: pgArray(todas.map((c) => c[0])), tipos: pgArray(todas.map((c) => c[1])),
      dres: pgArray(todas.map((c) => c[2])), fcs: pgArray(todas.map((c) => c[3])),
    },
  );
}

// Tudo abaixo de /empresas/:eid é isolado por empresa: o usuário precisa ser membro, e toda consulta filtra por empresa_id.
const e = express.Router({ mergeParams: true });
api.use(
  '/empresas/:eid',
  async (req, res, next) => {
    req.eid = idParam(req.params.eid);
    const acesso = await exigirMembro(req.eid, req.userId);
    req.papel = acesso.papel;
    req.segmento = acesso.segmento;
    next();
  },
  e,
);

const TABELAS_EMPRESA = new Set(['categorias', 'contas_bancarias']);
export async function pertence(tabela, id, eid) {
  if (id === null) return;
  check(TABELAS_EMPRESA.has(tabela) && Number.isInteger(id), `Registro inválido em ${tabela}.`);
  check(await get(`SELECT 1 FROM ${tabela} WHERE id = :id AND empresa_id = :eid`, { id, eid }), `Registro inválido em ${tabela}.`);
}

// ---------- Contas bancárias ----------

const SALDO_SQL = `cb.saldo_inicial + COALESCE((
  SELECT SUM(CASE WHEN l.tipo = 'receber' THEN l.valor_pago ELSE -l.valor_pago END)
  FROM lancamentos l
  WHERE l.conta_bancaria_id = cb.id AND l.data_pagamento IS NOT NULL AND l.data_pagamento >= cb.data_saldo_inicial
), 0)`;

export function listarContas(eid) {
  return all(
    `SELECT cb.*, (${SALDO_SQL})::bigint AS saldo_atual,
       (SELECT COUNT(*) FROM extrato_itens x WHERE x.conta_bancaria_id = cb.id AND x.lancamento_id IS NULL AND x.ignorado = 0) AS pendentes_conciliacao
     FROM contas_bancarias cb WHERE cb.empresa_id = :eid ORDER BY cb.ativa DESC, cb.nome`,
    { eid },
  );
}

e.get('/contas-bancarias', async (req, res) => res.json(await listarContas(req.eid)));

function lerConta(body) {
  const c = {
    nome: optText(body.nome),
    banco: optText(body.banco),
    saldo_inicial: body.saldo_inicial ?? 0,
    data_saldo_inicial: body.data_saldo_inicial || hoje(),
    ativa: body.ativa === false ? 0 : 1,
  };
  check(c.nome, 'Informe o nome da conta.');
  check(isCents(c.saldo_inicial), 'Saldo inicial inválido.');
  check(isDate(c.data_saldo_inicial), 'Data do saldo inicial inválida.');
  return c;
}

e.post('/contas-bancarias', async (req, res) => {
  const c = lerConta(req.body);
  const r = await get(
    `INSERT INTO contas_bancarias (empresa_id, nome, banco, saldo_inicial, data_saldo_inicial, ativa)
     VALUES (:eid, :nome, :banco, :saldo_inicial, :data_saldo_inicial, :ativa) RETURNING id`,
    { ...c, eid: req.eid },
  );
  res.status(201).json(r);
});

e.put('/contas-bancarias/:id', async (req, res) => {
  const c = lerConta(req.body);
  const r = await get(
    `UPDATE contas_bancarias SET nome = :nome, banco = :banco, saldo_inicial = :saldo_inicial, data_saldo_inicial = :data_saldo_inicial, ativa = :ativa
     WHERE id = :id AND empresa_id = :eid RETURNING id`,
    { ...c, id: idParam(req.params.id), eid: req.eid },
  );
  check(r, 'Conta não encontrada.', 404);
  res.json({ ok: true });
});

e.delete('/contas-bancarias/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const usada = await get('SELECT COUNT(*) AS n FROM lancamentos WHERE conta_bancaria_id = :id AND data_pagamento IS NOT NULL', { id });
  check(!usada.n, 'Esta conta tem lançamentos pagos. Desative-a em vez de excluir.', 409);
  const r = await get('DELETE FROM contas_bancarias WHERE id = :id AND empresa_id = :eid RETURNING id', { id, eid: req.eid });
  check(r, 'Conta não encontrada.', 404);
  res.json({ ok: true });
});

// ---------- Categorias ----------

e.get('/categorias', async (req, res) => {
  res.json(await all('SELECT * FROM categorias WHERE empresa_id = :eid ORDER BY tipo, nome', { eid: req.eid }));
});

e.post('/categorias', async (req, res) => {
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome da categoria.');
  check(['receita', 'despesa'].includes(req.body.tipo), 'Tipo de categoria inválido.');
  const dre = req.body.dre ?? DRE_PADRAO[req.body.tipo];
  check(LINHAS_DRE.includes(dre), 'Linha da DRE inválida.');
  const grupo = req.body.tipo === 'despesa' ? (req.body.grupo_forecast ?? forecastPadrao(dre)) : null;
  check(grupo === null || GRUPOS_FORECAST.includes(grupo), 'Grupo do Forecast inválido.');
  res.status(201).json(
    await get('INSERT INTO categorias (empresa_id, nome, tipo, dre, grupo_forecast) VALUES (:eid, :nome, :tipo, :dre, :grupo) RETURNING id', {
      eid: req.eid, nome, tipo: req.body.tipo, dre, grupo,
    }),
  );
});

e.put('/categorias/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const atual = await get('SELECT * FROM categorias WHERE id = :id AND empresa_id = :eid', { id, eid: req.eid });
  check(atual, 'Categoria não encontrada.', 404);
  const nome = optText(req.body.nome) ?? atual.nome;
  const dre = req.body.dre ?? atual.dre ?? DRE_PADRAO[atual.tipo];
  check(LINHAS_DRE.includes(dre), 'Linha da DRE inválida.');
  const grupo = atual.tipo === 'despesa' ? (req.body.grupo_forecast ?? atual.grupo_forecast ?? forecastPadrao(dre)) : null;
  check(grupo === null || GRUPOS_FORECAST.includes(grupo), 'Grupo do Forecast inválido.');
  await all('UPDATE categorias SET nome = :nome, dre = :dre, grupo_forecast = :grupo WHERE id = :id', { nome, dre, grupo, id });
  res.json({ ok: true });
});

e.delete('/categorias/:id', async (req, res) => {
  const r = await get('DELETE FROM categorias WHERE id = :id AND empresa_id = :eid RETURNING id', { id: idParam(req.params.id), eid: req.eid });
  check(r, 'Categoria não encontrada.', 404);
  res.json({ ok: true });
});

// ---------- Lançamentos (contas a pagar e a receber) ----------

const LANC_SELECT = `
  SELECT l.*, ${STATUS_SQL} AS status, c.nome AS categoria_nome, cb.nome AS conta_nome,
    (SELECT x.id FROM extrato_itens x WHERE x.lancamento_id = l.id) AS extrato_id
  FROM lancamentos l
  LEFT JOIN categorias c ON c.id = l.categoria_id
  LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id`;

export async function buscarLancamento(id, eid) {
  const l = await get(`${LANC_SELECT} WHERE l.id = :id AND l.empresa_id = :eid`, { id: idParam(id), eid, hoje: hoje() });
  check(l, 'Lançamento não encontrado.', 404);
  return l;
}

e.get('/lancamentos', async (req, res) => {
  const { tipo, status, de, ate, q, conta_id, categoria_id } = req.query;
  const where = ['l.empresa_id = :eid'];
  const p = { eid: req.eid, hoje: hoje() };
  if (tipo) (where.push('l.tipo = :tipo'), (p.tipo = tipo));
  if (status === 'em_aberto') where.push('l.data_pagamento IS NULL');
  else if (status) (where.push(`${STATUS_SQL} = :status`), (p.status = status));
  // Pagos são filtrados pela data do pagamento; os demais, pelo vencimento.
  const dataRef = status === 'pago' ? 'l.data_pagamento' : 'l.vencimento';
  if (isDate(de)) (where.push(`${dataRef} >= :de`), (p.de = de));
  if (isDate(ate)) (where.push(`${dataRef} <= :ate`), (p.ate = ate));
  if (conta_id) (where.push('l.conta_bancaria_id = :conta'), (p.conta = idParam(conta_id)));
  if (categoria_id) (where.push('l.categoria_id = :cat'), (p.cat = idParam(categoria_id)));
  if (q) (where.push('(l.descricao ILIKE :q OR l.contato ILIKE :q OR l.documento ILIKE :q)'), (p.q = `%${q}%`));
  const ordem = status === 'pago' ? 'l.data_pagamento DESC' : 'l.vencimento';
  res.json(await all(`${LANC_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${ordem}, l.id LIMIT 2000`, p));
});

e.get('/lancamentos/:id', async (req, res) => res.json(await buscarLancamento(req.params.id, req.eid)));

async function lerLancamento(body, eid) {
  const l = {
    tipo: body.tipo,
    descricao: optText(body.descricao),
    contato: optText(body.contato),
    categoria_id: optId(body.categoria_id),
    conta_bancaria_id: optId(body.conta_bancaria_id),
    valor: body.valor,
    vencimento: body.vencimento,
    documento: optText(body.documento),
    observacao: optText(body.observacao),
    centro_custo: optText(body.centro_custo),
    forma_pagamento: optText(body.forma_pagamento),
    data_prevista: body.data_prevista || null,
  };
  check(l.forma_pagamento === null || FORMAS_PAGAMENTO.includes(l.forma_pagamento), 'Forma de pagamento inválida.');
  check(l.data_prevista === null || isDate(l.data_prevista), 'Data prevista inválida.');
  check(['pagar', 'receber'].includes(l.tipo), 'Tipo inválido.');
  check(l.descricao, 'Informe a descrição.');
  check(isCents(l.valor) && l.valor > 0, 'Informe um valor maior que zero.');
  check(isDate(l.vencimento), 'Informe a data de vencimento.');
  await pertence('categorias', l.categoria_id, eid);
  await pertence('contas_bancarias', l.conta_bancaria_id, eid);
  // O nome digitado vira um cadastro de cliente/fornecedor (acha o existente ou cria).
  const contato = await resolverContato(eid, l.contato, l.tipo);
  l.contato_id = contato?.id ?? null;
  l.contato = contato?.nome ?? null;
  // Tipo de receita: valor explícito; "auto" (ou vazio) deixa o sistema sugerir. Despesas não têm.
  l.tipo_receita = l.tipo === 'receber' && TIPOS_RECEITA.includes(body.tipo_receita) ? body.tipo_receita : null;
  return l;
}

export const TIPOS_RECEITA = ['recorrente', 'nova', 'avulsa'];
export const FORMAS_PAGAMENTO = ['Pix', 'Boleto bancário', 'Transferência bancária', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro', 'Débito automático', 'Cheque', 'Outro'];

/**
 * Sugestão do tipo de receita quando o usuário deixa em "Automático":
 * - só é "nova venda" quando a descrição diz "nova venda" (como no contrato); numa mensalidade repetida, só a 1ª;
 * - mensalidade repetida (repetir N meses): "recorrente";
 * - venda parcelada: "avulsa" (é uma venda só, dividida);
 * - lançamento único: "recorrente" se o cliente teve receita recorrente nos últimos 2 meses; senão "avulsa".
 */
async function sugerirTipoReceita(eid, contatoId, vencimento, n, modo, descricao = '') {
  const nova = /nova venda/i.test(descricao);
  const jaRecorrente = contatoId
    ? !!(await get(
        `SELECT 1 FROM lancamentos WHERE empresa_id = :eid AND contato_id = :c AND tipo = 'receber'
           AND tipo_receita IN ('recorrente', 'nova') AND vencimento < :venc AND vencimento >= (:venc::date - 62) LIMIT 1`,
        { eid, c: contatoId, venc: vencimento },
      ))
    : false;
  if (n > 1 && modo === 'repetir') return (i) => (i === 0 && nova ? 'nova' : 'recorrente');
  if (nova) return (i) => (i === 0 ? 'nova' : 'avulsa');
  if (n > 1) return () => 'avulsa';
  return () => (jaRecorrente ? 'recorrente' : 'avulsa');
}

const INSERT_LANC = `INSERT INTO lancamentos
  (empresa_id, tipo, descricao, contato, contato_id, tipo_receita, categoria_id, conta_bancaria_id, valor, vencimento, documento, observacao,
   data_pagamento, valor_pago, origem_baixa, grupo_parcelas, parcela, total_parcelas, restante_de, transferencia_id, centro_custo, forma_pagamento, data_prevista)
  VALUES (:empresa_id, :tipo, :descricao, :contato, :contato_id, :tipo_receita, :categoria_id, :conta_bancaria_id, :valor, :vencimento, :documento, :observacao,
   :data_pagamento, :valor_pago, :origem_baixa, :grupo_parcelas, :parcela, :total_parcelas, :restante_de, :transferencia_id, :centro_custo, :forma_pagamento, :data_prevista)
  RETURNING id`;

export async function inserirLancamento(l) {
  const r = await get(INSERT_LANC, {
    contato_id: null, tipo_receita: null, data_pagamento: null, valor_pago: null, origem_baixa: null, grupo_parcelas: null, parcela: null, total_parcelas: null, restante_de: null, transferencia_id: null, centro_custo: null, forma_pagamento: null, data_prevista: null,
    ...l,
  });
  return r.id;
}

e.post('/lancamentos', async (req, res) => {
  const base = await lerLancamento(req.body, req.eid);
  const n = Number(req.body.parcelas ?? 1);
  check(Number.isInteger(n) && n >= 1 && n <= 120, 'Número de parcelas deve ser entre 1 e 120.');
  // 'parcelar' divide o valor total entre as parcelas; 'repetir' lança o mesmo valor todo mês.
  const modo = req.body.repeticao === 'repetir' ? 'repetir' : 'parcelar';
  const pagamento = req.body.pagamento; // opcional: já lançar como pago
  if (pagamento) {
    check(n === 1, 'Lançamentos parcelados não podem ser criados como pagos.');
    check(isDate(pagamento.data_pagamento), 'Data de pagamento inválida.');
    check(base.conta_bancaria_id, 'Informe a conta bancária do pagamento.');
  }

  const ids = await transaction(async () => {
    const grupo = n > 1 ? randomUUID() : null;
    const valorParcela = modo === 'parcelar' ? Math.floor(base.valor / n) : base.valor;
    const resto = modo === 'parcelar' ? base.valor - valorParcela * n : 0;
    const tipoReceita =
      base.tipo !== 'receber' ? () => null
      : base.tipo_receita ? () => base.tipo_receita
      : await sugerirTipoReceita(req.eid, base.contato_id, base.vencimento, n, modo, base.descricao);
    const ids = [];
    for (let i = 0; i < n; i++) {
      ids.push(
        await inserirLancamento({
          ...base,
          tipo_receita: tipoReceita(i),
          empresa_id: req.eid,
          valor: valorParcela + (i === 0 ? resto : 0),
          vencimento: addMonths(base.vencimento, i),
          grupo_parcelas: grupo,
          parcela: n > 1 ? i + 1 : null,
          total_parcelas: n > 1 ? n : null,
          ...(pagamento && {
            data_pagamento: pagamento.data_pagamento,
            valor_pago: isCents(pagamento.valor_pago) && pagamento.valor_pago > 0 ? pagamento.valor_pago : base.valor,
            origem_baixa: 'manual',
          }),
        }),
      );
    }
    return ids;
  });
  res.status(201).json({ ids });
});

// ---------- Transferência entre contas ----------
// Sai de uma conta e entra na outra no mesmo dia: duas pernas já pagas, em categorias "fora do resultado"
// (mexe no saldo de cada conta, não entra na DRE nem no Forecast). Excluir uma perna exclui as duas.
async function categoriaTransferencia(eid, tipo) {
  const nome = tipo === 'receita' ? 'Transferência de Entrada' : 'Transferência de Saída';
  const existente = await get(`SELECT id FROM categorias WHERE empresa_id = :eid AND tipo = :tipo AND lower(nome) = lower(:nome)`, { eid, tipo, nome });
  if (existente) return existente.id;
  return (await get(
    `INSERT INTO categorias (empresa_id, nome, tipo, dre, grupo_forecast) VALUES (:eid, :nome, :tipo, 'fora_resultado', :grupo) RETURNING id`,
    { eid, nome, tipo, grupo: tipo === 'despesa' ? 'fixo' : null },
  )).id;
}

/** Cria as duas pernas (chame dentro de uma transação). Devolve o id da transferência e o de cada perna. */
export async function criarTransferencia(eid, { origem, destino, data, valor, descricao, observacao = null }) {
  check(origem && destino, 'Escolha a conta de origem e a de destino.');
  check(origem !== destino, 'A conta de origem e a de destino precisam ser diferentes.');
  await pertence('contas_bancarias', origem, eid);
  await pertence('contas_bancarias', destino, eid);
  check(isDate(data), 'Data inválida.');
  check(isCents(valor) && valor > 0, 'Valor inválido.');
  const id = randomUUID();
  const base = {
    empresa_id: eid, descricao: descricao ?? 'Transferência entre contas', valor, vencimento: data, data_pagamento: data, valor_pago: valor,
    origem_baixa: 'manual', documento: null, observacao, contato: null, transferencia_id: id,
  };
  const saida = await inserirLancamento({ ...base, tipo: 'pagar', conta_bancaria_id: origem, categoria_id: await categoriaTransferencia(eid, 'despesa') });
  const entrada = await inserirLancamento({ ...base, tipo: 'receber', conta_bancaria_id: destino, categoria_id: await categoriaTransferencia(eid, 'receita') });
  return { id, saida, entrada };
}

e.post('/transferencias', async (req, res) => {
  const t = await transaction(() => criarTransferencia(req.eid, {
    origem: optId(req.body.conta_origem_id), destino: optId(req.body.conta_destino_id), data: req.body.data, valor: req.body.valor,
    descricao: optText(req.body.descricao), observacao: optText(req.body.observacao),
  }));
  res.status(201).json({ transferencia_id: t.id });
});

e.put('/lancamentos/:id', async (req, res) => {
  const atual = await buscarLancamento(req.params.id, req.eid);
  check(!atual.transferencia_id, 'Transferência não se edita: exclua e lance de novo.');
  const { tipo, ...l } = await lerLancamento({ ...req.body, tipo: atual.tipo }, req.eid);
  if (atual.data_pagamento) check(l.conta_bancaria_id, 'Lançamento pago precisa de conta bancária.');
  // Sem escolha explícita, mantém o tipo de receita que já estava.
  if (atual.tipo === 'receber' && !l.tipo_receita) l.tipo_receita = atual.tipo_receita;
  await all(
    `UPDATE lancamentos SET descricao = :descricao, contato = :contato, contato_id = :contato_id, tipo_receita = :tipo_receita,
       categoria_id = :categoria_id, conta_bancaria_id = :conta_bancaria_id,
       valor = :valor, vencimento = :vencimento, documento = :documento, observacao = :observacao,
       centro_custo = :centro_custo, forma_pagamento = :forma_pagamento, data_prevista = :data_prevista
     WHERE id = :id AND empresa_id = :eid`,
    { ...l, id: atual.id, eid: req.eid },
  );

  // Parcelas/recorrência: "proximos" (esta e as seguintes) ou "todos" levam as mudanças para as outras do grupo.
  // Descrição, contato, categoria, documento e observação valem até para as já pagas; valor, conta e data
  // (deslocada pelos mesmos dias) só para as que ainda estão em aberto, para não mexer no que já foi pago.
  let outras = 0;
  const escopo = ['proximos', 'todos'].includes(req.body.escopo) ? req.body.escopo : 'este';
  if (escopo !== 'este' && atual.grupo_parcelas) {
    const dias = diffDays(l.vencimento, atual.vencimento); // quantos dias a data andou
    const p = { ...l, grupo: atual.grupo_parcelas, id: atual.id, eid: req.eid, dias, parcela: atual.parcela ?? 0, venc: atual.vencimento };
    const alvo = `empresa_id = :eid AND grupo_parcelas = :grupo AND id <> :id AND transferencia_id IS NULL
      ${escopo === 'proximos' ? 'AND (CASE WHEN parcela IS NOT NULL AND :parcela > 0 THEN parcela > :parcela ELSE vencimento > :venc::date END)' : ''}`;
    await transaction(async () => {
      const r = await all(
        `UPDATE lancamentos SET descricao = :descricao, contato = :contato, contato_id = :contato_id, categoria_id = :categoria_id,
           documento = :documento, observacao = :observacao, centro_custo = :centro_custo, forma_pagamento = :forma_pagamento ${atual.tipo === 'receber' && req.body.tipo_receita && req.body.tipo_receita !== 'auto' ? ', tipo_receita = :tipo_receita' : ''}
         WHERE ${alvo} RETURNING id`,
        p,
      );
      outras = r.length;
      await all(
        `UPDATE lancamentos SET valor = :valor, conta_bancaria_id = :conta_bancaria_id, vencimento = vencimento + (:dias)::int
         WHERE ${alvo} AND data_pagamento IS NULL`,
        p,
      );
    });
  }
  res.json({ ...(await buscarLancamento(atual.id, req.eid)), outras_atualizadas: outras });
});

e.delete('/lancamentos/:id', async (req, res) => {
  const atual = await buscarLancamento(req.params.id, req.eid);
  const escopo = req.query.escopo; // 'grupo' apaga também as parcelas em aberto do mesmo grupo
  await transaction(async () => {
    await all('DELETE FROM lancamentos WHERE id = :id', { id: atual.id });
    if (atual.transferencia_id) await all('DELETE FROM lancamentos WHERE transferencia_id = :t AND empresa_id = :eid', { t: atual.transferencia_id, eid: req.eid });
    if (escopo === 'grupo' && atual.grupo_parcelas) {
      await all('DELETE FROM lancamentos WHERE grupo_parcelas = :g AND empresa_id = :eid AND data_pagamento IS NULL', { g: atual.grupo_parcelas, eid: req.eid });
    }
  });
  res.json({ ok: true });
});

/**
 * Baixa (pagamento/recebimento). Juros, multa e desconto ficam registrados; sem valor pago informado,
 * paga-se o valor + juros + multa − desconto. Pagamento parcial: o que foi quitado do valor original
 * (pago − juros − multa + desconto) fica neste lançamento e o restante vira um novo lançamento em aberto.
 */
async function baixar(l, { data_pagamento, valor_pago, conta_bancaria_id, juros = 0, multa = 0, desconto = 0, parcial = false, vencimento_restante }, eid) {
  check(!l.data_pagamento, `"${l.descricao}" já está pago.`, 409);
  check(isDate(data_pagamento), 'Data de pagamento inválida.');
  const conta = optId(conta_bancaria_id) ?? l.conta_bancaria_id;
  check(conta, 'Informe a conta bancária.');
  await pertence('contas_bancarias', conta, eid);
  for (const [nome, v] of [['Juros', juros], ['Multa', multa], ['Desconto', desconto]]) check(isCents(v) && v >= 0, `${nome} inválido.`);
  const valor = valor_pago ?? l.valor + juros + multa - desconto;
  check(isCents(valor) && valor > 0, 'Valor pago inválido.');

  if (!parcial) {
    await all(
      "UPDATE lancamentos SET data_pagamento = :data, valor_pago = :valor, juros = :juros, multa = :multa, desconto = :desconto, conta_bancaria_id = :conta, origem_baixa = 'manual' WHERE id = :id",
      { data: data_pagamento, valor, juros, multa, desconto, conta, id: l.id },
    );
    return;
  }
  const quitado = valor - juros - multa + desconto;
  check(quitado > 0 && quitado < l.valor, `No pagamento parcial, o valor pago (sem juros e multa) precisa ser menor que ${(l.valor / 100).toFixed(2).replace('.', ',')}.`);
  const vencRestante = vencimento_restante ?? l.vencimento;
  check(isDate(vencRestante), 'Vencimento do restante inválido.');
  await transaction(async () => {
    await all(
      `UPDATE lancamentos SET valor = :quitado, data_pagamento = :data, valor_pago = :valor, juros = :juros, multa = :multa, desconto = :desconto,
         conta_bancaria_id = :conta, origem_baixa = 'manual' WHERE id = :id`,
      { quitado, data: data_pagamento, valor, juros, multa, desconto, conta, id: l.id },
    );
    await inserirLancamento({
      empresa_id: eid, tipo: l.tipo, descricao: l.descricao, contato: l.contato, contato_id: l.contato_id, tipo_receita: l.tipo_receita,
      categoria_id: l.categoria_id, conta_bancaria_id: l.conta_bancaria_id, valor: l.valor - quitado, vencimento: vencRestante,
      documento: l.documento, observacao: [`Restante do pagamento parcial de ${data_pagamento.split('-').reverse().join('/')}`, l.observacao].filter(Boolean).join(' — '),
      grupo_parcelas: l.grupo_parcelas, parcela: l.parcela, total_parcelas: l.total_parcelas, restante_de: l.id, centro_custo: l.centro_custo, forma_pagamento: l.forma_pagamento,
    });
  });
}

e.post('/lancamentos/baixa-lote', async (req, res) => {
  const { ids, data_pagamento, conta_bancaria_id } = req.body;
  check(Array.isArray(ids) && ids.length, 'Selecione ao menos um lançamento.');
  await transaction(async () => {
    for (const id of ids) await baixar(await buscarLancamento(id, req.eid), { data_pagamento, conta_bancaria_id }, req.eid);
  });
  res.json({ ok: true, quantidade: ids.length });
});

e.post('/lancamentos/:id/baixa', async (req, res) => {
  const l = await buscarLancamento(req.params.id, req.eid);
  await baixar(l, req.body, req.eid);
  res.json(await buscarLancamento(l.id, req.eid));
});

e.post('/lancamentos/:id/estorno', async (req, res) => {
  const l = await buscarLancamento(req.params.id, req.eid);
  check(l.data_pagamento, 'Este lançamento não está pago.', 409);
  check(!l.transferencia_id, 'Transferência não tem estorno: exclua e lance de novo.');
  await transaction(async () => {
    await all('UPDATE extrato_itens SET lancamento_id = NULL WHERE lancamento_id = :id', { id: l.id });
    // Pagamento parcial: o restante que ainda está em aberto volta para este lançamento.
    const restante = await get('DELETE FROM lancamentos WHERE restante_de = :id AND data_pagamento IS NULL RETURNING valor', { id: l.id });
    await all(
      'UPDATE lancamentos SET data_pagamento = NULL, valor_pago = NULL, juros = 0, multa = 0, desconto = 0, origem_baixa = NULL, valor = valor + :extra WHERE id = :id',
      { id: l.id, extra: restante?.valor ?? 0 },
    );
  });
  res.json(await buscarLancamento(l.id, req.eid));
});

// ---------- Painel ----------

e.get('/resumo', async (req, res) => {
  const h = hoje();
  const fimSemana = addDays(h, 7);
  const fimMes = addDays(addMonths(h.slice(0, 8) + '01', 1), -1);
  const totais = (tipo) =>
    get(
      `SELECT
         COALESCE(SUM(CASE WHEN vencimento < :h THEN valor END), 0)::bigint AS vencido,
         COUNT(CASE WHEN vencimento < :h THEN 1 END) AS qtd_vencido,
         COALESCE(SUM(CASE WHEN vencimento = :h THEN valor END), 0)::bigint AS hoje,
         COUNT(CASE WHEN vencimento = :h THEN 1 END) AS qtd_hoje,
         COALESCE(SUM(CASE WHEN vencimento > :h AND vencimento <= :semana THEN valor END), 0)::bigint AS semana,
         COALESCE(SUM(CASE WHEN vencimento >= :h AND vencimento <= :mes THEN valor END), 0)::bigint AS mes
       FROM lancamentos WHERE empresa_id = :eid AND tipo = :tipo AND data_pagamento IS NULL`,
      { eid: req.eid, tipo, h, semana: fimSemana, mes: fimMes },
    );

  const [contas, pagar, receber, proximos] = await Promise.all([
    listarContas(req.eid),
    totais('pagar'),
    totais('receber'),
    all(`${LANC_SELECT} WHERE l.empresa_id = :eid AND l.data_pagamento IS NULL AND l.vencimento <= :ate ORDER BY l.vencimento, l.id LIMIT 12`, {
      eid: req.eid, hoje: h, ate: fimSemana,
    }),
  ]);

  res.json({
    hoje: h,
    saldo_total: contas.filter((c) => c.ativa).reduce((s, c) => s + c.saldo_atual, 0),
    contas,
    pagar,
    receber,
    proximos,
    pendentes_conciliacao: contas.reduce((s, c) => s + c.pendentes_conciliacao, 0),
  });
});

e.use(fluxoRouter);
e.use(conciliacaoRouter);
e.use(equipeRouter);
e.use(extratoRouter);
e.use(relatoriosRouter);
e.use(contatosRouter);
e.use(forecastRouter);

// ---------- Erros ----------

api.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
api.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno no servidor.' });
});
