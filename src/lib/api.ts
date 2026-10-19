import { useCallback, useEffect, useState } from 'react';
import { supabase, tokenAtual } from './auth';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await tokenAtual();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  // Sessão expirada ou inválida: volta para a tela de login.
  if (r.status === 401) await supabase.auth.signOut();
  if (!r.ok) throw new Error(data.erro ?? `Erro ${r.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = unknown>(path: string) => request<T>('DELETE', path),
};

export function qs(params: Record<string, string | number | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? '?' + str : '';
}

/** Carrega `path` e recarrega sempre que ele mudar; `null` não carrega nada. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!path) return;
    let ativo = true;
    setCarregando(true);
    api
      .get<T>(path)
      .then((d) => ativo && (setData(d), setErro(null)))
      .catch((e: Error) => ativo && setErro(e.message))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [path, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { data, erro, carregando, recarregar };
}
