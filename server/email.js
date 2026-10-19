// Envio de e-mails transacionais pelo Resend (https://resend.com).
// Sem RESEND_API_KEY o sistema funciona normalmente: só não envia, e a tela oferece o link para copiar.

const API_KEY = process.env.RESEND_API_KEY;
// Sem domínio verificado, o Resend só aceita o remetente de teste e só entrega para o e-mail dono da conta Resend.
const REMETENTE = process.env.EMAIL_FROM || 'FinVision <onboarding@resend.dev>';

export const emailConfigurado = !!API_KEY;

/** @returns {Promise<{ enviado: boolean, motivo?: 'nao_configurado' | 'modo_teste' | 'erro' }>} */
export async function enviarEmail({ para, assunto, html, texto }) {
  if (!API_KEY) return { enviado: false, motivo: 'nao_configurado' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: REMETENTE, to: [para], subject: assunto, html, text: texto }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return { enviado: true };
    const corpo = await r.json().catch(() => ({}));
    console.error('Resend recusou o envio:', r.status, corpo.message);
    // 403 = domínio não verificado (modo de teste: só entrega para o dono da conta Resend).
    return { enviado: false, motivo: r.status === 403 ? 'modo_teste' : 'erro' };
  } catch (e) {
    console.error('Falha ao chamar o Resend:', e.message);
    return { enviado: false, motivo: 'erro' };
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function emailConvite({ empresa, convidadoPor, papel, link, validoAte }) {
  const funcao = papel === 'dono' ? 'como dono(a)' : 'como membro da equipe';
  const assunto = `Convite para acessar o financeiro de ${empresa}`;
  const texto = [
    `Olá!`,
    ``,
    `${convidadoPor} convidou você para acessar o financeiro de ${empresa} no FinVision, ${funcao}.`,
    ``,
    `Para aceitar, abra o link abaixo e entre (ou crie sua conta) com este mesmo e-mail:`,
    link,
    ``,
    `O convite vale até ${validoAte}. Se você não esperava este e-mail, pode ignorá-lo.`,
  ].join('\n');
  const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f5f6f8;font-family:Segoe UI,Arial,sans-serif;color:#17202e">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e3e7ed">
        <tr><td style="padding:28px 32px 8px;font-size:18px;font-weight:700;color:#0f766e">FinVision</td></tr>
        <tr><td style="padding:8px 32px 0;font-size:20px;font-weight:600">Você foi convidado(a) para ${esc(empresa)}</td></tr>
        <tr><td style="padding:12px 32px 0;font-size:15px;line-height:1.55;color:#3b4554">
          <b>${esc(convidadoPor)}</b> convidou você para acessar o financeiro de <b>${esc(empresa)}</b> ${funcao}.
          Para aceitar, entre ou crie sua conta <b>com este mesmo e-mail</b>.
        </td></tr>
        <tr><td style="padding:24px 32px">
          <a href="${esc(link)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">Aceitar convite</a>
        </td></tr>
        <tr><td style="padding:0 32px 28px;font-size:12px;line-height:1.5;color:#5b6576">
          O convite vale até ${esc(validoAte)}. Se o botão não funcionar, copie este endereço no navegador:<br>
          <a href="${esc(link)}" style="color:#0f766e;word-break:break-all">${esc(link)}</a><br><br>
          Se você não esperava este e-mail, pode ignorá-lo.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { assunto, html, texto };
}
