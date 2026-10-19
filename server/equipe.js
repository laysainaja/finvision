import express from 'express';
import { all, get, transaction } from './db.js';
import { check } from './util.js';
import { enviarEmail, emailConvite } from './email.js';

// ---------- Rotas da empresa atual (montadas em /empresas/:eid, já com req.eid e req.papel) ----------

export const equipeRouter = express.Router({ mergeParams: true });

const exigirDono = (req) => check(req.papel === 'dono', 'Só o dono da empresa pode gerenciar a equipe.', 403);
const emailValido = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.length <= 254;
const uuidValido = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

equipeRouter.get('/membros', async (req, res) => {
  const membros = await all(
    `SELECT m.user_id, u.email, m.papel, m.criado_em, (m.user_id = :uid) AS voce
     FROM membros m JOIN auth.users u ON u.id = m.user_id
     WHERE m.empresa_id = :eid ORDER BY m.papel = 'dono' DESC, u.email`,
    { eid: req.eid, uid: req.userId },
  );
  res.json({ membros, meu_papel: req.papel });
});

/** Garante que a empresa continue com ao menos um dono depois da mudança. */
async function exigirOutroDono(eid, userId) {
  const r = await get("SELECT COUNT(*) AS n FROM membros WHERE empresa_id = :eid AND papel = 'dono' AND user_id <> :uid", { eid, uid: userId });
  check(r.n > 0, 'A empresa precisa de pelo menos um dono. Promova outra pessoa a dono antes.', 409);
}

equipeRouter.put('/membros/:uid', async (req, res) => {
  exigirDono(req);
  const uid = req.params.uid;
  check(uuidValido(uid), 'Usuário inválido.');
  check(['dono', 'membro'].includes(req.body.papel), 'Papel inválido.');
  await transaction(async () => {
    const alvo = await get('SELECT papel FROM membros WHERE empresa_id = :eid AND user_id = :uid FOR UPDATE', { eid: req.eid, uid });
    check(alvo, 'Membro não encontrado.', 404);
    if (alvo.papel === 'dono' && req.body.papel !== 'dono') await exigirOutroDono(req.eid, uid);
    await all('UPDATE membros SET papel = :papel WHERE empresa_id = :eid AND user_id = :uid', { papel: req.body.papel, eid: req.eid, uid });
  });
  res.json({ ok: true });
});

// Dono remove qualquer pessoa; membro pode remover só a si mesmo (sair da empresa).
equipeRouter.delete('/membros/:uid', async (req, res) => {
  const uid = req.params.uid;
  check(uuidValido(uid), 'Usuário inválido.');
  if (uid !== req.userId) exigirDono(req);
  await transaction(async () => {
    const alvo = await get('SELECT papel FROM membros WHERE empresa_id = :eid AND user_id = :uid FOR UPDATE', { eid: req.eid, uid });
    check(alvo, 'Membro não encontrado.', 404);
    if (alvo.papel === 'dono') await exigirOutroDono(req.eid, uid);
    await all('DELETE FROM membros WHERE empresa_id = :eid AND user_id = :uid', { eid: req.eid, uid });
  });
  res.json({ ok: true });
});

equipeRouter.get('/convites', async (req, res) => {
  exigirDono(req);
  res.json(
    await all(
      `SELECT id, email, papel, token, criado_em, expira_em, (expira_em < now()) AS expirado
       FROM convites WHERE empresa_id = :eid AND aceito_em IS NULL ORDER BY criado_em DESC`,
      { eid: req.eid },
    ),
  );
});

equipeRouter.post('/convites', async (req, res) => {
  exigirDono(req);
  check(emailValido(req.body.email), 'Informe um e-mail válido.');
  const email = req.body.email.trim().toLowerCase();
  const papel = req.body.papel === 'dono' ? 'dono' : 'membro';
  const jaMembro = await get(
    'SELECT 1 FROM membros m JOIN auth.users u ON u.id = m.user_id WHERE m.empresa_id = :eid AND lower(u.email) = :email',
    { eid: req.eid, email },
  );
  check(!jaMembro, 'Essa pessoa já faz parte da empresa.', 409);
  // Reconvidar o mesmo e-mail substitui o convite pendente (novo link, novo prazo).
  const convite = await transaction(async () => {
    await all('DELETE FROM convites WHERE empresa_id = :eid AND lower(email) = :email AND aceito_em IS NULL', { eid: req.eid, email });
    return get(
      `INSERT INTO convites (empresa_id, email, papel, criado_por) VALUES (:eid, :email, :papel, :uid)
       RETURNING id, email, papel, token, criado_em, expira_em, false AS expirado`,
      { eid: req.eid, email, papel, uid: req.userId },
    );
  });

  // O convite já está salvo; o e-mail é um extra. Se falhar, a tela oferece o link para copiar/WhatsApp.
  const [empresa, autor] = await Promise.all([
    get('SELECT nome FROM empresas WHERE id = :eid', { eid: req.eid }),
    get('SELECT email FROM auth.users WHERE id = :uid', { uid: req.userId }),
  ]);
  const { assunto, html, texto } = emailConvite({
    empresa: empresa.nome,
    convidadoPor: autor?.email ?? 'Um membro da equipe',
    papel,
    link: `${urlDoSite(req)}/#/convite/${convite.token}`,
    validoAte: new Date(convite.expira_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  });
  const envio = await enviarEmail({ para: email, assunto, html, texto });
  res.status(201).json({ ...convite, email_enviado: envio.enviado, email_motivo: envio.motivo ?? null });
});

/** Endereço público do site para montar o link: APP_URL, se definido; senão o próprio host da requisição. */
function urlDoSite(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto')?.split(',')[0] ?? req.protocol;
  return `${proto}://${req.get('x-forwarded-host') ?? req.get('host')}`;
}

equipeRouter.delete('/convites/:id', async (req, res) => {
  exigirDono(req);
  const id = Number(req.params.id);
  check(Number.isSafeInteger(id) && id > 0, 'Convite inválido.');
  const r = await get('DELETE FROM convites WHERE id = :id AND empresa_id = :eid AND aceito_em IS NULL RETURNING id', { id, eid: req.eid });
  check(r, 'Convite não encontrado.', 404);
  res.json({ ok: true });
});

// ---------- Rotas do convite em si (montadas em /convites) ----------

export const conviteRouter = express.Router();

async function buscarConvite(token) {
  check(uuidValido(token), 'Convite inválido.', 404);
  const c = await get(
    `SELECT c.*, e.nome AS empresa_nome, (c.expira_em < now()) AS expirado
     FROM convites c JOIN empresas e ON e.id = c.empresa_id WHERE c.token = :token`,
    { token },
  );
  check(c, 'Convite não encontrado. Ele pode ter sido cancelado.', 404);
  return c;
}

// Público (antes do login): mostra para qual empresa e e-mail é o convite, para a tela de login orientar a pessoa.
export async function infoConvite(req, res) {
  const c = await buscarConvite(req.params.token);
  res.json({ empresa_nome: c.empresa_nome, email: c.email, papel: c.papel, expirado: c.expirado, aceito: !!c.aceito_em });
}

conviteRouter.post('/:token/aceitar', async (req, res) => {
  const resultado = await transaction(async () => {
    const c = await buscarConvite(req.params.token);
    // Lido do próprio Supabase Auth (não do token do navegador): e-mail real e confirmado do usuário logado.
    const usuario = await get('SELECT email, email_confirmed_at FROM auth.users WHERE id = :uid', { uid: req.userId });
    check(usuario?.email_confirmed_at, 'Confirme seu e-mail antes de aceitar o convite.', 403);
    const jaMembro = await get('SELECT 1 FROM membros WHERE empresa_id = :eid AND user_id = :uid', { eid: c.empresa_id, uid: req.userId });
    if (jaMembro) return { empresa_id: c.empresa_id, empresa_nome: c.empresa_nome, ja_era_membro: true };
    check(!c.aceito_em, 'Este convite já foi usado.', 409);
    check(!c.expirado, 'Este convite expirou. Peça um novo ao dono da empresa.', 410);
    check(
      usuario.email.toLowerCase() === c.email.toLowerCase(),
      `Este convite é para ${c.email}. Saia e entre (ou crie a conta) com esse e-mail.`,
      403,
    );
    await all("INSERT INTO membros (empresa_id, user_id, papel) VALUES (:eid, :uid, :papel)", { eid: c.empresa_id, uid: req.userId, papel: c.papel });
    await all('UPDATE convites SET aceito_em = now(), aceito_por = :uid WHERE id = :id', { uid: req.userId, id: c.id });
    return { empresa_id: c.empresa_id, empresa_nome: c.empresa_nome, ja_era_membro: false };
  });
  res.json(resultado);
});
