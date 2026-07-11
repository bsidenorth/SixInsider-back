# SixInsider — Backend

Node.js + Express. Dois endpoints:

- `POST /api/news/webhook` — recebe notícias do Apify (Twitter/Reddit).
- `POST /api/v1/webhooks/payment` — recebe eventos de pagamento da Cactos.

## 1. Rodar o SQL no Supabase
No SQL Editor do Supabase, rode `sql/users_schema.sql` (a tabela `news` já
deve existir do schema anterior).

## 2. Configurar variáveis de ambiente
Copie `.env.example` para `.env` e preencha com os valores reais
(`SUPABASE_SERVICE_ROLE_KEY` fica em Project Settings > API > service_role
— **não é a mesma chave do frontend**).

## 3. Deploy no Render (feito pra fazer pelo celular)
1. Suba esta pasta pra um repositório novo no GitHub (mesmo processo do
   frontend: extrai o zip, sobe os arquivos, "Add file > Upload files").
2. Em render.com → **New > Web Service** → conecte o repositório.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Em **Environment**, adicione as mesmas variáveis do `.env.example`.
6. Deploy. Você recebe uma URL tipo `sixinsider-backend.onrender.com`.

## 4. Testar os endpoints

### Notícias
```bash
curl -X POST https://SEU-BACKEND.onrender.com/api/news/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: SEU_NEWS_WEBHOOK_SECRET" \
  -d '{"title":"Novo trailer confirmado","link":"https://twitter.com/x/status/1","platform":"twitter","content":"..."}'
```

### Pagamento
```bash
curl -X POST https://SEU-BACKEND.onrender.com/api/v1/webhooks/payment \
  -H "Content-Type: application/json" \
  -H "x-cactos-signature: SEU_CACTOS_WEBHOOK_SECRET" \
  -d '{"type":"subscription.paid","customer_email":"user@example.com"}'
```

## 5. Configurar na Apify e na Cactos
- **Apify**: no seu actor de scraping, adicione um passo final (ou um
  Webhook do próprio Apify) que faça `POST` do resultado pra
  `https://SEU-BACKEND.onrender.com/api/news/webhook`, incluindo o header
  `x-webhook-secret`.
- **Cactos**: no painel de webhooks da Cactos, cadastre a URL
  `https://SEU-BACKEND.onrender.com/api/v1/webhooks/payment`. Confirme com
  eles qual header/formato de assinatura usam — o código em
  `paymentWebhook.js` está pronto pra ajustar isso rapidinho quando vocês
  tiverem a doc real deles em mãos.

## 6. Conectar no frontend
No Vercel do frontend, defina `VITE_API_URL` e `VITE_PAYMENTS_URL` como a
mesma URL do Render (os dois endpoints vivem no mesmo serviço).
