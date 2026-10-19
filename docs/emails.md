# E-mails do FinVision

## Como está configurado hoje

| E-mail | Quem envia | Chega a qualquer pessoa? |
|---|---|---|
| Confirmar conta (primeiro acesso) | Supabase Auth → **SMTP do Gmail da Thunderlabs** | ✅ |
| Esqueci minha senha | Supabase Auth → **SMTP do Gmail da Thunderlabs** | ✅ |
| Convite para a equipe | API do FinVision → Resend (modo de teste, sem domínio) | ❌ só o dono da conta Resend; os demais recebem o link pelo WhatsApp |

### SMTP do Gmail (Supabase → Authentication → Emails → SMTP Settings)

| Campo | Valor |
|---|---|
| Sender email | e-mail da conta Google Workspace que envia (hoje: `laysainaja@thunderlabs.com.br`) |
| Sender name | `FinVision` |
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | o mesmo e-mail |
| Password | **senha de app** do Google (16 letras), em myaccount.google.com/apppasswords |

- A senha de app exige a **verificação em duas etapas** ligada na conta. O admin do Workspace precisa permitir isso em
  admin.google.com → Segurança → Autenticação → Verificação em duas etapas.
- Se a senha da conta Google for trocada ou a verificação em duas etapas for desligada, a senha de app para de valer: gere outra e troque no Supabase.
- Limite do Google Workspace: cerca de 2.000 e-mails por dia.
- Em **Authentication → Rate Limits**, deixe o limite de e-mails por hora compatível com o uso (o padrão é baixo).

## Modelos (Supabase → Authentication → Emails → Templates)

| Modelo no Supabase | Assunto (Subject) | Arquivo |
|---|---|---|
| **Confirm sign up** | `Bem-vindo(a) ao FinVision! Confirme seu e-mail` | `design/emails/modelo-primeiro-acesso.html` |
| **Reset password** | `Crie uma nova senha no FinVision` | `design/emails/modelo-nova-senha.html` |

> ⚠️ **O modelo precisa ser só um bloco de conteúdo, começando direto em `<div>`.** Se o código tiver a página completa
> (`<!doctype html>`, `<html>`, `<body>`), o painel salva normalmente, mas na hora do envio o Supabase **descarta o modelo
> e manda o padrão em inglês**, sem nenhum aviso.

- Os modelos só podem ser editados com um **SMTP próprio** configurado (sem ele, o painel bloqueia os campos).
- Depois de salvar, espere cerca de 1 minuto antes de testar.
- As artes são servidas pelo próprio site (`/emails/primeiro-acesso.jpg` e `/emails/nova-senha.jpg`, pasta `public/emails/`).
  Para mudar textos ou cores da arte, edite `design/emails/arte.html` e rode `powershell -File scripts/gerar-artes-email.ps1`.

## Convites por e-mail (Resend)

Variáveis no `.env` e na Vercel: `RESEND_API_KEY` (chave com permissão **Sending access**), `APP_URL`
(`https://finvision-focus-ebd6.vercel.app`) e, quando houver domínio, `EMAIL_FROM`.

Sem domínio verificado, o Resend só entrega para o e-mail dono da conta Resend. Para liberar para qualquer pessoa:

1. Resend → **Domains** → **Add Domain**, de preferência um subdomínio como `mail.thunderlabs.com.br`. Região **São Paulo**, se houver.
2. Cadastre os registros DNS que o Resend mostrar no painel onde o DNS do domínio é administrado e clique em **Verify**.
   Os registros ficam no subdomínio e não afetam o e-mail do Google.
3. Na Vercel, cadastre `EMAIL_FROM` = `FinVision <nao-responda@mail.thunderlabs.com.br>` e faça o Redeploy.

(Alternativa sem domínio: fazer os convites saírem pelo mesmo SMTP do Gmail. Exige uma pequena mudança no servidor.)
