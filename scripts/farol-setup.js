// Integração FinVision → Farol (ThunderLab). Veja server/integracoes/farol.sql.
// Uso (sempre com --env-file=.env):
//   node scripts/farol-setup.js                 instala/atualiza (extensões, tabelas, gatilho) e põe na fila a carga inicial; NÃO envia nada
//   node scripts/farol-setup.js --gerar-chave   gera a chave de integração, guarda no Vault e mostra UMA vez
//   node scripts/farol-setup.js --testar        manda 1 lançamento direto ao Farol e mostra a resposta
//   node scripts/farol-setup.js --ativar        liga o envio automático (pg_cron, a cada minuto)
//   node scripts/farol-setup.js --desativar     desliga o envio automático (a fila continua sendo montada)
//   node scripts/farol-setup.js --status        mostra a fila e os últimos envios
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { sql, all, get } from '../server/db.js';

const CNPJ = '41735336000180';
const URL_FAROL = 'https://ooozqlhkivbiycgvytlo.supabase.co/rest/v1/rpc/farol_finvision_receber';
const APIKEY_FAROL = 'sb_publishable_AvgDVtjtleFOHMNze4yaPw_3b47DoPj'; // chave pública do Supabase do Farol
const CARGA_DESDE = '2026-10-01';
const modo = process.argv[2] ?? '--instalar';

try {
  if (modo === '--instalar') {
    await sql.unsafe('create extension if not exists pg_net with schema extensions');
    await sql.unsafe('create extension if not exists pg_cron');
    await sql.unsafe(readFileSync(new URL('../server/integracoes/farol.sql', import.meta.url), 'utf8'));
    const emp = await get(`SELECT id, nome FROM empresas WHERE regexp_replace(COALESCE(documento, ''), '\\D', '', 'g') = :cnpj`, { cnpj: CNPJ });
    if (!emp) throw new Error(`Empresa com CNPJ ${CNPJ} não encontrada.`);
    await all(
      `INSERT INTO farol_config (id, empresa_id, url, apikey) VALUES (1, :eid, :url, :apikey)
       ON CONFLICT (id) DO UPDATE SET empresa_id = excluded.empresa_id, url = excluded.url, apikey = excluded.apikey`,
      { eid: emp.id, url: URL_FAROL, apikey: APIKEY_FAROL },
    );
    const carga = await all(
      `INSERT INTO farol_fila (lancamento_id, atualizado_em)
       SELECT id, clock_timestamp() FROM lancamentos
       WHERE empresa_id = :eid AND (vencimento >= :desde OR data_pagamento >= :desde)
       ON CONFLICT (lancamento_id) DO NOTHING RETURNING lancamento_id`,
      { eid: emp.id, desde: CARGA_DESDE },
    );
    console.log(`Instalado para ${emp.nome} (empresa ${emp.id}). Carga inicial na fila: ${carga.length} lançamentos (desde ${CARGA_DESDE}). Envio automático: desligado.`);
  } else if (modo === '--gerar-chave') {
    const chave = randomBytes(48).toString('base64url'); // 64 caracteres
    const atual = await get(`SELECT id FROM vault.secrets WHERE name = 'farol_chave'`);
    if (atual) await all('SELECT vault.update_secret(:id::uuid, :chave)', { id: atual.id, chave });
    else await all(`SELECT vault.create_secret(:chave, 'farol_chave', 'Chave da integração FinVision → Farol (ThunderLab)')`, { chave });
    console.log(`Chave de integração (guarde agora; ela não será mostrada de novo):\n\n${chave}\n`);
  } else if (modo === '--testar') {
    const cfg = await get('SELECT * FROM farol_config WHERE id = 1');
    const { decrypted_secret: chave } = await get(`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'farol_chave'`);
    const l = await get(
      `SELECT l.id, l.tipo, l.descricao, COALESCE(ct.nome, l.contato) AS contato, c.nome AS categoria, cb.nome AS conta, l.valor, l.vencimento,
         l.data_pagamento, CASE WHEN l.data_pagamento IS NULL THEN NULL ELSE l.valor_pago END AS valor_pago,
         CASE WHEN l.tipo = 'receber' THEN l.tipo_receita END AS tipo_receita, l.transferencia_id, false AS excluido
       FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id LEFT JOIN contas_bancarias cb ON cb.id = l.conta_bancaria_id
       LEFT JOIN contatos ct ON ct.id = l.contato_id
       WHERE l.empresa_id = :eid AND l.data_pagamento >= :desde ORDER BY l.data_pagamento DESC, l.id DESC LIMIT 1`,
      { eid: cfg.empresa_id, desde: CARGA_DESDE },
    );
    console.log('Enviando 1 lançamento:', JSON.stringify(l));
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { apikey: cfg.apikey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_chave: chave, p_lancamentos: [l] }),
    });
    console.log(`Resposta do Farol: HTTP ${r.status}\n${await r.text()}`);
  } else if (modo === '--ativar') {
    await all('UPDATE farol_config SET ativo = true WHERE id = 1');
    await all(`SELECT cron.schedule('farol-enviar', '* * * * *', 'select public.farol_enviar()')`);
    console.log('Envio automático ligado: a cada minuto o banco manda ao Farol o que estiver pendente.');
  } else if (modo === '--desativar') {
    await all('UPDATE farol_config SET ativo = false WHERE id = 1');
    await all(`SELECT cron.unschedule('farol-enviar') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'farol-enviar')`);
    console.log('Envio automático desligado.');
  } else if (modo === '--status') {
    console.log(await get(`SELECT ativo FROM farol_config WHERE id = 1`));
    console.log(await get(
      `SELECT COUNT(*)::int AS na_fila, COUNT(*) FILTER (WHERE enviado_em IS NULL OR enviado_em < atualizado_em)::int AS pendentes,
         COUNT(*) FILTER (WHERE ultimo_erro IS NOT NULL)::int AS com_erro, MAX(ultimo_erro) AS exemplo_erro FROM farol_fila`,
    ));
    console.log(await all(`SELECT id, criado_em, jsonb_array_length(itens) AS itens, status, left(resposta, 200) AS resposta FROM farol_envios ORDER BY id DESC LIMIT 5`));
  } else {
    throw new Error(`Opção desconhecida: ${modo}`);
  }
} finally {
  await sql.end();
}
