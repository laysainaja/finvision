import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './util.js';

const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey) throw new Error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env ou nas variáveis da Vercel.');

// Projetos novos do Supabase assinam o token com chaves assimétricas publicadas neste JWKS.
const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));

// Projetos com a chave antiga (HS256) não verificam pelo JWKS: nesse caso perguntamos ao próprio Supabase
// e guardamos a resposta por alguns minutos para não repetir a chamada a cada requisição.
const cache = new Map();
async function validarNoSupabase(token) {
  const salvo = cache.get(token);
  if (salvo && salvo.expira > Date.now()) return salvo.userId;
  const r = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const { id } = await r.json();
  if (cache.size > 5000) cache.clear();
  cache.set(token, { userId: id, expira: Date.now() + 5 * 60_000 });
  return id;
}

/** Middleware: exige `Authorization: Bearer <token do Supabase>` e preenche req.userId. */
export async function autenticar(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Faça login para continuar.');
  let userId = null;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${supabaseUrl}/auth/v1`, audience: 'authenticated' });
    userId = payload.sub;
  } catch (e) {
    if (e?.code === 'ERR_JWT_EXPIRED') throw new HttpError(401, 'Sua sessão expirou. Entre novamente.');
    userId = await validarNoSupabase(token);
  }
  if (!userId) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  req.userId = userId;
  next();
}
