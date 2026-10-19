# E-mails do FinVision (Resend)

Existem dois tipos de e-mail:

| E-mail | Quem envia | Onde configurar |
|---|---|---|
| Convite para a equipe | API do FinVision → Resend | Variáveis `RESEND_API_KEY`, `EMAIL_FROM` e `APP_URL` (`.env` e Vercel) |
| Confirmar conta / Esqueci a senha | Supabase Auth → Resend (SMTP) | Painel do Supabase |

## Etapa 1: agora, sem domínio (modo de teste)

1. Em [resend.com/api-keys](https://resend.com/api-keys), clique em **Create API Key**, com permissão **Sending access**.
2. No `.env` e na Vercel (Settings → Environment Variables), cadastre:
   - `RESEND_API_KEY` = a chave `re_...`
   - `APP_URL` = `https://finvision-focus-ebd6.vercel.app`
   - deixe `EMAIL_FROM` **sem cadastrar** (usa o remetente de teste `onboarding@resend.dev`)
3. Faça o Redeploy na Vercel.

No modo de teste, o Resend **só entrega para o e-mail dono da conta Resend**. Convites para outras pessoas mostram um aviso
na tela, que oferece o link para enviar pelo WhatsApp. **Não ligue o SMTP do Supabase nesta etapa**: os clientes deixariam de receber o e-mail de confirmação de conta.

## Etapa 2: quando tiver um domínio

1. Resend → **Domains** → **Add Domain**, de preferência um subdomínio como `mail.seudominio.com.br`. Região: **São Paulo (sa-east-1)**, se houver.
2. Cadastre os registros DNS que o Resend mostrar (MX, TXT/SPF e DKIM) no lugar onde o domínio está registrado (Registro.br, Cloudflare...) e clique em **Verify**.
3. Na Vercel, cadastre `EMAIL_FROM` = `FinVision <nao-responda@mail.seudominio.com.br>` e faça o Redeploy.
4. No Supabase → **Authentication → Emails → SMTP Settings** → **Enable Custom SMTP**:

   | Campo | Valor |
   |---|---|
   | Sender email | `nao-responda@mail.seudominio.com.br` |
   | Sender name | `FinVision` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | a mesma chave `re_...` do Resend |

5. Ainda em **Authentication → Emails → Templates**, cole os modelos abaixo.
6. Em **Authentication → Rate Limits**, aumente o limite de e-mails por hora (o padrão é baixo).

## Modelos em português (Supabase → Authentication → Emails → Templates)

### Confirm signup

**Subject:** `Confirme sua conta no FinVision`

```html
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#17202e">
  <div style="font-size:18px;font-weight:700;color:#0f766e">FinVision</div>
  <h2 style="font-weight:600">Confirme seu e-mail</h2>
  <p style="color:#3b4554;line-height:1.55">Falta só um passo para ativar sua conta. Clique no botão abaixo para confirmar seu e-mail.</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">Confirmar e-mail</a></p>
  <p style="font-size:12px;color:#5b6576">Se você não criou uma conta no FinVision, ignore este e-mail.</p>
</div>
```

### Reset password

**Subject:** `Crie uma nova senha no FinVision`

```html
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#17202e">
  <div style="font-size:18px;font-weight:700;color:#0f766e">FinVision</div>
  <h2 style="font-weight:600">Redefinir senha</h2>
  <p style="color:#3b4554;line-height:1.55">Recebemos um pedido para criar uma nova senha para sua conta. Clique no botão abaixo para continuar.</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">Criar nova senha</a></p>
  <p style="font-size:12px;color:#5b6576">Se você não pediu isso, ignore este e-mail. Sua senha atual continua valendo.</p>
</div>
```

### Change email address

**Subject:** `Confirme seu novo e-mail no FinVision`

```html
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#17202e">
  <div style="font-size:18px;font-weight:700;color:#0f766e">FinVision</div>
  <h2 style="font-weight:600">Confirme a troca de e-mail</h2>
  <p style="color:#3b4554;line-height:1.55">Confirme a alteração de {{ .Email }} para {{ .NewEmail }}.</p>
  <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">Confirmar novo e-mail</a></p>
</div>
```
