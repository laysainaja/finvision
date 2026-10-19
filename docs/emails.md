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

Os modelos com arte ficam em `design/emails/`. Abra o arquivo, copie **todo** o conteúdo e cole no campo **Message body** (modo *Source*/HTML) do modelo correspondente:

| Modelo no Supabase | Assunto (Subject) | Arquivo |
|---|---|---|
| **Confirm signup** | `Bem-vindo(a) ao FinVision! Confirme seu e-mail` | `design/emails/modelo-primeiro-acesso.html` |
| **Reset password** | `Crie uma nova senha no FinVision` | `design/emails/modelo-nova-senha.html` |

As artes são servidas pelo próprio site (`/emails/primeiro-acesso.jpg` e `/emails/nova-senha.jpg`, pasta `public/emails/`).
Para mudar textos ou cores da arte, edite `design/emails/arte.html` e rode `powershell -File scripts/gerar-artes-email.ps1`.
Prévias renderizadas: `design/emails/previa-*.png`.