import express from 'express';
import { all, get, transaction } from './db.js';
import { check, optText, idParam, chaveNome } from './util.js';

export const contatosRouter = express.Router({ mergeParams: true });

const TIPOS = ['cliente', 'fornecedor', 'ambos'];

/**
 * Acha o contato pelo nome (ignorando maiúsculas, acentos e espaços) ou cadastra um novo.
 * Usado ao salvar lançamentos: o campo continua sendo um texto livre na tela, mas sempre aponta para um cadastro.
 * Devolve { id, nome } ou null se o nome estiver vazio.
 */
export async function resolverContato(eid, nome, tipoLancamento) {
  const limpo = optText(nome);
  if (!limpo) return null;
  const chave = chaveNome(limpo);
  const papel = tipoLancamento === 'pagar' ? 'fornecedor' : 'cliente';
  let c = await get('SELECT id, nome, tipo FROM contatos WHERE empresa_id = :eid AND chave = :chave', { eid, chave });
  if (!c) {
    c = await get(
      `INSERT INTO contatos (empresa_id, nome, chave, tipo) VALUES (:eid, :nome, :chave, :tipo)
       ON CONFLICT (empresa_id, chave) DO UPDATE SET nome = contatos.nome RETURNING id, nome, tipo`,
      { eid, nome: limpo.replace(/\s+/g, ' '), chave, tipo: papel },
    );
  } else if (c.tipo !== papel && c.tipo !== 'ambos') {
    await all("UPDATE contatos SET tipo = 'ambos' WHERE id = :id", { id: c.id });
  }
  return { id: c.id, nome: c.nome };
}

contatosRouter.get('/contatos', async (req, res) => {
  const tipo = TIPOS.includes(req.query.tipo) ? req.query.tipo : null;
  res.json(
    await all(
      `SELECT c.*,
         COALESCE((SELECT SUM(COALESCE(valor_pago, valor)) FROM lancamentos WHERE contato_id = c.id AND tipo = 'receber'), 0)::bigint AS total_receber,
         COALESCE((SELECT SUM(COALESCE(valor_pago, valor)) FROM lancamentos WHERE contato_id = c.id AND tipo = 'pagar'), 0)::bigint AS total_pagar,
         (SELECT COUNT(*) FROM lancamentos WHERE contato_id = c.id) AS lancamentos,
         (SELECT MAX(COALESCE(data_pagamento, vencimento)) FROM lancamentos WHERE contato_id = c.id) AS ultimo_movimento
       FROM contatos c WHERE c.empresa_id = :eid ${tipo ? "AND (c.tipo = :tipo OR c.tipo = 'ambos')" : ''}
       ORDER BY c.nome`,
      { eid: req.eid, ...(tipo && { tipo }) },
    ),
  );
});

function lerContato(body) {
  const c = {
    nome: optText(body.nome)?.replace(/\s+/g, ' '),
    tipo: TIPOS.includes(body.tipo) ? body.tipo : 'cliente',
    documento: optText(body.documento),
    email: optText(body.email),
    telefone: optText(body.telefone),
    observacao: optText(body.observacao),
  };
  check(c.nome, 'Informe o nome.');
  return c;
}

contatosRouter.post('/contatos', async (req, res) => {
  const c = lerContato(req.body);
  const chave = chaveNome(c.nome);
  check(!(await get('SELECT 1 FROM contatos WHERE empresa_id = :eid AND chave = :chave', { eid: req.eid, chave })), `Já existe um cadastro chamado "${c.nome}".`, 409);
  res.status(201).json(
    await get(
      `INSERT INTO contatos (empresa_id, nome, chave, tipo, documento, email, telefone, observacao)
       VALUES (:eid, :nome, :chave, :tipo, :documento, :email, :telefone, :observacao) RETURNING *`,
      { ...c, chave, eid: req.eid },
    ),
  );
});

contatosRouter.put('/contatos/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const c = lerContato(req.body);
  const chave = chaveNome(c.nome);
  const outro = await get('SELECT id FROM contatos WHERE empresa_id = :eid AND chave = :chave AND id <> :id', { eid: req.eid, chave, id });
  check(!outro, `Já existe outro cadastro chamado "${c.nome}". Use "Juntar" para unificar os dois.`, 409);
  const r = await transaction(async () => {
    const atualizado = await get(
      `UPDATE contatos SET nome = :nome, chave = :chave, tipo = :tipo, documento = :documento, email = :email, telefone = :telefone, observacao = :observacao
       WHERE id = :id AND empresa_id = :eid RETURNING *`,
      { ...c, chave, id, eid: req.eid },
    );
    // O nome também fica gravado no lançamento (para exibição rápida): mantém sincronizado.
    if (atualizado) await all('UPDATE lancamentos SET contato = :nome WHERE contato_id = :id', { nome: c.nome, id });
    return atualizado;
  });
  check(r, 'Cadastro não encontrado.', 404);
  res.json(r);
});

// Junta dois cadastros que são a mesma pessoa/empresa: os lançamentos de "origem" passam para "destino".
contatosRouter.post('/contatos/:id/juntar', async (req, res) => {
  const origem = idParam(req.params.id);
  const destino = idParam(req.body.destino_id);
  check(origem !== destino, 'Escolha outro cadastro para juntar.');
  await transaction(async () => {
    const dst = await get('SELECT id, nome, tipo FROM contatos WHERE id = :id AND empresa_id = :eid', { id: destino, eid: req.eid });
    const org = await get('SELECT id, tipo FROM contatos WHERE id = :id AND empresa_id = :eid', { id: origem, eid: req.eid });
    check(dst && org, 'Cadastro não encontrado.', 404);
    await all('UPDATE lancamentos SET contato_id = :dst, contato = :nome WHERE contato_id = :org', { dst: dst.id, nome: dst.nome, org: org.id });
    if (org.tipo !== dst.tipo && dst.tipo !== 'ambos') await all("UPDATE contatos SET tipo = 'ambos' WHERE id = :id", { id: dst.id });
    await all('DELETE FROM contatos WHERE id = :id', { id: org.id });
  });
  res.json({ ok: true });
});

contatosRouter.delete('/contatos/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const usados = await get('SELECT COUNT(*) AS n FROM lancamentos WHERE contato_id = :id', { id });
  check(!usados.n, `Este cadastro tem ${usados.n} lançamento(s). Use "Juntar" com outro cadastro em vez de excluir.`, 409);
  const r = await get('DELETE FROM contatos WHERE id = :id AND empresa_id = :eid RETURNING id', { id, eid: req.eid });
  check(r, 'Cadastro não encontrado.', 404);
  res.json({ ok: true });
});
