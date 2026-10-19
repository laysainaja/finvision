// Cria/atualiza as tabelas no banco apontado por DATABASE_URL.  Uso: npm run db:setup
import { readFileSync } from 'node:fs';
import { sql } from '../server/db.js';

const schema = readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
try {
  await sql.unsafe(schema);
  const tabelas = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  console.log('Banco pronto. Tabelas:', tabelas.map((t) => t.table_name).join(', '));
} catch (e) {
  console.error('Falha ao criar as tabelas:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
