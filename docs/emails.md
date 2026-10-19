# E-mails do FinVision

## Como está configurado hoje

| E-mail | Quem envia | Chega a qualquer pessoa? |
|---|---|---|
| Confirmar conta (primeiro acesso) | Supabase Auth → **SMTP do Gmail da Thunderlabs** | ✅ |
| Esqueci minha senha | Supabase Auth → **SMTP do Gmail da Thunderlabs** | ✅ |
| Convite para a equipe | API do FinVision → **SMTP do Gmail** (`SMTP_USER`/`SMTP_PASS`); sem eles, Resend | ✅ com SMTP do Gmail |

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

## Convites por e-mail

A API do FinVision escolhe o envio nesta ordem: **SMTP** (se `SMTP_USER` e `SMTP_PASS` existirem) → **Resend** (se `RESEND_API_KEY` existir) → só o link na tela.
O diagnóstico `/api/saude` mostra qual está ativo (`"email": "smtp" | "resend" | "desligado"`).

Variáveis no `.env` e na Vercel:

| Variável | Valor |
|---|---|
| `SMTP_USER` | e-mail da conta Google Workspace (o mesmo do SMTP do Supabase) |
| `SMTP_PASS` | uma **senha de app** do Google (pode ser a mesma do Supabase ou outra só para o FinVision) |
| `APP_URL` | `https://finvision-focus-ebd6.vercel.app` |
| `EMAIL_FROM` | opcional; padrão `FinVision <SMTP_USER>` |

O Resend continua como alternativa. Sem domínio verificado ele só entrega para o dono da conta Resend; com domínio
(ex.: `mail.thunderlabs.com.br` verificado em Resend → Domains), cadastre `EMAIL_FROM` com um endereço desse domínio.