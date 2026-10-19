// O link do convite é https://site/#/convite/<token>. Guardamos o token no navegador porque a pessoa
// pode precisar criar a conta e confirmar o e-mail antes (o link de confirmação volta para a página inicial).
const CHAVE = 'finvision:convite';

export function capturarConviteDaUrl() {
  const m = location.hash.match(/^#\/convite\/([0-9a-f-]{36})$/i);
  if (!m) return;
  try {
    localStorage.setItem(CHAVE, m[1]);
  } catch {
    /* sem armazenamento: o aceite ainda funciona se a pessoa já estiver logada nesta aba */
  }
  history.replaceState(null, '', location.pathname + location.search + '#/painel');
  conviteMemoria = m[1];
}

let conviteMemoria: string | null = null;

export function conviteSalvo(): string | null {
  try {
    return localStorage.getItem(CHAVE) ?? conviteMemoria;
  } catch {
    return conviteMemoria;
  }
}

export function limparConvite() {
  conviteMemoria = null;
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* nada a limpar */
  }
}

export const linkDoConvite = (token: string) => `${location.origin}/#/convite/${token}`;
