import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (string de conexão do Postgres/Supabase) no arquivo .env ou nas variáveis da Vercel.');

export const sql = postgres(url, {
  prepare: false, // obrigatório no pooler do Supabase (modo transação, porta 6543)
  max: Number(process.env.DB_POOL ?? 3),
  idle_timeout: 20,
  connect_timeout: 15,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
  onnotice: () => {},
  types: {
    // Centavos e ids chegam como number (bigint viraria string); `date` fica como 'YYYY-MM-DD'.
    int8: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) },
    date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x },
  },
});

const txAtual = new AsyncLocalStorage();

/** Converte parâmetros nomeados (:nome) para $1, $2... — mantém o SQL legível. `::tipo` não é afetado. */
function compilar(texto, params) {
  const valores = [];
  const posicao = new Map();
  const sqlFinal = texto.replace(/(?<![:\w]):([a-zA-Z_]\w*)/g, (_, nome) => {
    if (!(nome in params)) throw new Error(`Parâmetro SQL :${nome} não informado`);
    if (!posicao.has(nome)) {
      valores.push(params[nome] ?? null);
      posicao.set(nome, valores.length);
    }
    return '$' + posicao.get(nome);
  });
  return [sqlFinal, valores];
}

/** Executa e devolve todas as linhas. Dentro de `transaction`, usa a transação automaticamente. */
export async function all(texto, params = {}) {
  const [s, v] = compilar(texto, params);
  return [...(await (txAtual.getStore() ?? sql).unsafe(s, v))];
}

export async function get(texto, params = {}) {
  return (await all(texto, params))[0];
}

export function transaction(fn) {
  return sql.begin((tx) => txAtual.run(tx, fn));
}

/** Data de hoje no fuso de Brasília (o servidor na nuvem roda em UTC). */
export function hoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_APP ?? 'America/Sao_Paulo' }).format(new Date());
}

// Status calculado: nunca armazenado, para não ficar desatualizado com a virada do dia.
export const STATUS_SQL = `CASE
  WHEN l.data_pagamento IS NOT NULL THEN 'pago'
  WHEN l.vencimento < :hoje THEN 'vencido'
  ELSE 'aberto' END`;
