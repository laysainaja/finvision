import express from 'express';
import { all, get, transaction, hoje } from './db.js';
import { check, optText, idParam } from './util.js';
import { criarEmpresa, SEGMENTOS } from './api.js';

// Gestão do escritório (BPO): lista as empresas clientes, define o segmento de cada uma e cria/vincula empresas.
export const gestaoRouter = express.Router();

async function meuEscritorio(userId) {
  return get(
    `SELECT es.*, em.papel FROM escritorios es JOIN escritorio_membros em ON em.escritorio_id = es.id
     WHERE em.user_id = :uid ORDER BY es.id LIMIT 1`,
    { uid: userId },
  );
}

async function exigirEscritorio(req) {
  const esc = await meuEscritorio(req.userId);
  check(esc, 'Você ainda não tem um escritório. Crie um na tela de Gestão.', 404);
  return esc;
}

gestaoRouter.get('/', async (req, res) => {
  res.json({ escritorio: (await meuEscritorio(req.userId)) ?? null });
});

gestaoRouter.post('/escritorio', async (req, res) => {
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome do escritório.');
  check(!(await meuEscritorio(req.userId)), 'Você já faz parte de um escritório.', 409);
  const esc = await transaction(async () => {
    const e = await get('INSERT INTO escritorios (nome) VALUES (:nome) RETURNING *', { nome });
    await all("INSERT INTO escritorio_membros (escritorio_id, user_id, papel) VALUES (:id, :uid, 'admin')", { id: e.id, uid: req.userId });
    return e;
  });
  res.status(201).json({ ...esc, papel: 'admin' });
});

gestaoRouter.put('/escritorio', async (req, res) => {
  const esc = await exigirEscritorio(req);
  check(esc.papel === 'admin', 'Só o administrador do escritório pode renomeá-lo.', 403);
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome do escritório.');
  res.json(await get('UPDATE escritorios SET nome = :nome WHERE id = :id RETURNING *', { nome, id: esc.id }));
});

// Visão geral das empresas clientes, com os números que importam para a rotina do BPO.
gestaoRouter.get('/empresas', async (req, res) => {
  const esc = await exigirEscritorio(req);
  const empresas = await all(
    `SELECT e.id, e.nome, e.documento, e.segmento, e.criado_em,
       COALESCE((SELECT SUM(cb.saldo_inicial + COALESCE((
           SELECT SUM(CASE WHEN l.tipo = 'receber' THEN l.valor_pago ELSE -l.valor_pago END) FROM lancamentos l
           WHERE l.conta_bancaria_id = cb.id AND l.data_pagamento IS NOT NULL AND l.data_pagamento >= cb.data_saldo_inicial), 0))
         FROM contas_bancarias cb WHERE cb.empresa_id = e.id AND cb.ativa = 1), 0)::bigint AS saldo,
       COALESCE((SELECT SUM(valor) FROM lancamentos WHERE empresa_id = e.id AND tipo = 'receber' AND data_pagamento IS NULL AND vencimento < :hoje), 0)::bigint AS receber_vencido,
       COALESCE((SELECT SUM(valor) FROM lancamentos WHERE empresa_id = e.id AND tipo = 'pagar' AND data_pagamento IS NULL AND vencimento < :hoje), 0)::bigint AS pagar_vencido,
       (SELECT COUNT(*) FROM lancamentos WHERE empresa_id = e.id AND tipo = 'pagar' AND data_pagamento IS NULL AND vencimento = :hoje) AS pagar_hoje,
       (SELECT COUNT(*) FROM extrato_itens WHERE empresa_id = e.id AND lancamento_id IS NULL AND ignorado = 0) AS pendentes_conciliacao,
       (SELECT COUNT(*) FROM membros WHERE empresa_id = e.id) AS usuarios
     FROM empresas e WHERE e.escritorio_id = :esc ORDER BY e.nome`,
    { esc: esc.id, hoje: hoje() },
  );
  // Empresas das quais a pessoa é dona e que ainda não estão em nenhum escritório: podem ser vinculadas.
  const vinculaveis = await all(
    `SELECT e.id, e.nome, e.segmento FROM empresas e JOIN membros m ON m.empresa_id = e.id
     WHERE m.user_id = :uid AND m.papel = 'dono' AND e.escritorio_id IS NULL ORDER BY e.nome`,
    { uid: req.userId },
  );
  res.json({ escritorio: esc, empresas, vinculaveis });
});

gestaoRouter.post('/empresas', async (req, res) => {
  const esc = await exigirEscritorio(req);
  const nome = optText(req.body.nome);
  check(nome, 'Informe o nome da empresa.');
  const empresa = await transaction(() =>
    criarEmpresa({ nome, documento: optText(req.body.documento), segmento: req.body.segmento ?? 'servico', escritorioId: esc.id }),
  );
  res.status(201).json(empresa);
});

async function empresaDoEscritorio(id, esc) {
  const e = await get('SELECT * FROM empresas WHERE id = :id AND escritorio_id = :esc', { id: idParam(id), esc: esc.id });
  check(e, 'Empresa não encontrada no seu escritório.', 404);
  return e;
}

gestaoRouter.put('/empresas/:id', async (req, res) => {
  const esc = await exigirEscritorio(req);
  const emp = await empresaDoEscritorio(req.params.id, esc);
  const segmento = req.body.segmento ?? emp.segmento;
  check(SEGMENTOS.includes(segmento), 'Segmento inválido.');
  const nome = optText(req.body.nome) ?? emp.nome;
  res.json(await get('UPDATE empresas SET segmento = :seg, nome = :nome WHERE id = :id RETURNING *', { seg: segmento, nome, id: emp.id }));
});

// Traz para o escritório uma empresa que a pessoa já tinha como dona.
gestaoRouter.post('/vincular', async (req, res) => {
  const esc = await exigirEscritorio(req);
  const id = idParam(req.body.empresa_id);
  const emp = await get(
    `SELECT e.* FROM empresas e JOIN membros m ON m.empresa_id = e.id
     WHERE e.id = :id AND m.user_id = :uid AND m.papel = 'dono'`,
    { id, uid: req.userId },
  );
  check(emp, 'Só é possível vincular empresas das quais você é dona.', 404);
  check(!emp.escritorio_id, 'Esta empresa já está em um escritório.', 409);
  res.json(await get('UPDATE empresas SET escritorio_id = :esc WHERE id = :id RETURNING *', { esc: esc.id, id }));
});

// Desvincula: a empresa continua existindo para os membros dela, mas sai da gestão do escritório.
gestaoRouter.post('/desvincular', async (req, res) => {
  const esc = await exigirEscritorio(req);
  check(esc.papel === 'admin', 'Só o administrador do escritório pode desvincular empresas.', 403);
  const emp = await empresaDoEscritorio(req.body.empresa_id, esc);
  const donos = await get("SELECT COUNT(*) AS n FROM membros WHERE empresa_id = :id AND papel = 'dono'", { id: emp.id });
  check(donos.n > 0, 'Convide um dono para a empresa antes de desvinculá-la; senão ninguém mais teria acesso.', 409);
  await all('UPDATE empresas SET escritorio_id = NULL WHERE id = :id', { id: emp.id });
  res.json({ ok: true });
});
