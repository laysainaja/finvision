# FinVision

Sistema financeiro multiempresa: contas a pagar e a receber, fluxo de caixa e conciliação bancária (OFX/CSV), com login.

**Stack:** React + Vite (frontend) · Express (API serverless na Vercel) · Postgres + Auth do Supabase.

## Publicar (GitHub → Supabase → Vercel)

### 1. Supabase
1. Em [supabase.com](https://supabase.com) → **New project**. Região: **South America (São Paulo)**. Guarde a senha do banco.
2. Copie `.env.example` para `.env` e preencha:
   - `DATABASE_URL`: botão **Connect** → **Transaction pooler** (porta **6543**), trocando `[YOUR-PASSWORD]` pela senha.
   - `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`: **Project Settings → API** (chave *anon*/*publishable*, nunca a *service_role*/*secret*).
3. Crie as tabelas: `npm run db:setup`.

### 2. GitHub
```bash
gh auth login
gh repo create finvision --private --source . --push
```

### 3. Vercel
1. Em [vercel.com/new](https://vercel.com/new), importe o repositório `finvision` (o framework Vite é detectado sozinho).
2. Em **Environment Variables**, cadastre `DATABASE_URL`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os mesmos valores do `.env`.
3. **Deploy**. Cada `git push` na branch `main` publica de novo automaticamente.

### 4. De volta ao Supabase
**Authentication → URL Configuration**: em **Site URL** coloque o endereço da Vercel (ex.: `https://finvision.vercel.app`) e
adicione o mesmo endereço em **Redirect URLs**. Sem isso, os links de confirmação de e-mail e de "esqueci minha senha" apontam para `localhost`.

## Rodar localmente

```bash
npm install
npm run dev        # http://localhost:5180 (usa o banco do .env)
```

Dados de exemplo para um usuário já cadastrado: `npm run db:seed -- voce@email.com`
(cria a "Empresa Demo Ltda" e o arquivo `exemplos/extrato-demo.ofx` para testar a conciliação).

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `server/schema.sql` | Tabelas (valores em centavos, datas `date`) e RLS |
| `server/db.js` | Conexão Postgres, parâmetros `:nome`, transações |
| `server/auth.js` | Valida o token do Supabase em cada requisição |
| `server/api.js` | Empresas/membros, contas, categorias, lançamentos, painel |
| `server/fluxo.js` | Fluxo de caixa realizado + previsto |
| `server/conciliacao.js` | Importação de extrato, sugestões, conciliação automática |
| `api/index.js` | Entrada da função serverless da Vercel |
| `src/` | Frontend React (login, telas, leitura de OFX/CSV) |

## Segurança

- Toda rota da API exige login; cada usuário só acessa empresas das quais é membro (tabela `membros`).
- O RLS fica **ligado** em todas as tabelas, sem policies: a chave pública do Supabase, que fica visível no navegador, não consegue ler nada direto pela API REST do Supabase. Todo acesso passa pela API do FinVision.
- O `.env` não vai para o GitHub (`.gitignore`).

## Regras principais

- **Status** (aberto/vencido/pago) é calculado na consulta, com a data de hoje no fuso de Brasília.
- **Saldo da conta** = saldo inicial + pagamentos a partir da data do saldo inicial.
- **Fluxo previsto**: contas em aberto pelo vencimento; as vencidas entram como "hoje".
- **Conciliação**: conciliar uma conta em aberto dá baixa com data e valor do banco; desfazer só reverte baixas feitas pela conciliação.
  A automática só concilia quando o valor é exato, a data difere em até 5 dias e não há empate.
