# Subir o FinanFlow numa VPS

Guia direto, escrito a partir do código como ele está hoje. O `server.ts` já
serve o front compilado e a API no mesmo processo, então **um único serviço**
resolve o sistema inteiro.

Substitua `SEUDOMINIO.com.br` e os caminhos pelos seus.

---

## 1. O que a VPS precisa ter

- Ubuntu 22.04+ (1 vCPU e 2 GB de RAM dão conta)
- Node.js 20 ou superior
- Um domínio (ou subdomínio) apontando para o IP da VPS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
node -v   # confirme 20+
```

---

## 2. Levar o código

```bash
sudo mkdir -p /opt/finanflow && sudo chown $USER:$USER /opt/finanflow
# do seu computador:
rsync -av --exclude node_modules --exclude dist --exclude .git \
  "/caminho/do/projeto/" usuario@IP_DA_VPS:/opt/finanflow/
```

> Enquanto o repositório não tiver remote, o `rsync` é o caminho. Depois de
> criar um repositório privado, troque por `git clone` + `git pull`.

---

## 3. Variáveis de ambiente

Crie `/opt/finanflow/.env`:

```bash
PORT=8080
NODE_ENV=production

# Chave real do Gemini. Fica SÓ aqui, nunca no build — os endpoints /api/ai/*
# rodam no servidor justamente para a chave não ir para o navegador.
GEMINI_API_KEY=coloque_a_chave_real

FIREBASE_PROJECT_ID=gen-lang-client-0795004040

# Segredo do webhook do WhatsApp. Com ele definido, o servidor recusa
# requisição sem o header x-webhook-token — impede qualquer um de criar
# lançamento na sua conta.
WHATSAPP_WEBHOOK_TOKEN=gere_um_segredo_longo_aleatorio
```

Proteja o arquivo:

```bash
chmod 600 /opt/finanflow/.env
```

---

## 4. Credencial do Firebase Admin (importante)

O webhook do WhatsApp **grava** no Firestore pelo servidor, e isso exige uma
conta de serviço. Sem ela, o webhook responde mas não salva nada.

1. Console do Firebase → Configurações do projeto → **Contas de serviço**
2. **Gerar nova chave privada** → baixa um JSON
3. Envie para a VPS e restrinja o acesso:

```bash
scp chave.json usuario@IP_DA_VPS:/opt/finanflow/service-account.json
ssh usuario@IP_DA_VPS 'chmod 600 /opt/finanflow/service-account.json'
```

4. Acrescente ao `.env`:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/opt/finanflow/service-account.json
```

> A verificação de login dos endpoints de IA (`verifyIdToken`) funciona só com
> o `FIREBASE_PROJECT_ID`, porque valida chave pública. A **gravação** do
> webhook é que precisa da conta de serviço.

---

## 5. Instalar e compilar

```bash
cd /opt/finanflow
npm ci
npm run lint     # tipos
npm test         # a matemática do dinheiro
npm run build    # gera dist/
```

Se algum dos três falhar, **não suba**. O `server.ts` em produção serve o
`dist/`; sem build não há front.

---

## 6. Serviço que sobe sozinho e reinicia se cair

`/etc/systemd/system/finanflow.service`:

```ini
[Unit]
Description=FinanFlow
After=network.target

[Service]
Type=simple
User=SEU_USUARIO
WorkingDirectory=/opt/finanflow
EnvironmentFile=/opt/finanflow/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now finanflow
sudo systemctl status finanflow
curl -s localhost:8080/api/health     # espera {"status":"ok"}
```

Logs: `journalctl -u finanflow -f`

---

## 7. Nginx e HTTPS

`/etc/nginx/sites-available/finanflow`:

```nginx
server {
    listen 80;
    server_name SEUDOMINIO.com.br;

    # Extrato em PDF e papel timbrado sobem em base64: o padrão de 1 MB corta.
    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # leitura de extrato pela IA demora
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/finanflow /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d SEUDOMINIO.com.br
```

---

## 8. Domínio autorizado no Firebase Auth

Sem este passo o login falha em produção.

Console do Firebase → **Authentication** → Settings → **Domínios autorizados**
→ adicionar `SEUDOMINIO.com.br`.

---

## 9. WhatsApp (opcional)

No app, em **Ajustes**, configure a Evolution API. O webhook a apontar na
Evolution é:

```
https://SEUDOMINIO.com.br/api/whatsapp/webhook?token=O_MESMO_WHATSAPP_WEBHOOK_TOKEN
```

Teste pelo próprio app (botão de testar conexão) e depois mande "saldo" pelo
WhatsApp.

---

## 10. Atualizar depois

```bash
cd /opt/finanflow
# rsync ou git pull
npm ci && npm run lint && npm test && npm run build
sudo systemctl restart finanflow
```

Voltar atrás: guarde o `dist/` anterior antes de compilar
(`cp -r dist dist.bak`) e, se preciso, `mv dist.bak dist` +
`systemctl restart finanflow`.

---

## Regras do Firestore

**Não é passo obrigatório do deploy.** Caixinhas, score de crédito e taxa de
juros informada guardam em `entities/{id}/config/...`, que já tem regra
publicada — foi uma decisão consciente, justamente para o deploy não depender
de mais um passo manual.

O arquivo `firestore.rules` do projeto tem melhorias de segurança (validação de
campos, papel de colaborador somente-leitura). Vale publicar quando der, mas o
sistema funciona sem isso:

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

---

## Conferir se subiu de verdade

```bash
curl -s https://SEUDOMINIO.com.br/api/health
# {"status":"ok"}

# IA sem login precisa recusar:
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  https://SEUDOMINIO.com.br/api/ai/suggest-categories
# 401

# Webhook sem o token precisa recusar:
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  https://SEUDOMINIO.com.br/api/whatsapp/webhook
# 401
```

Depois, logado no navegador: criar uma caixinha, registrar um depósito de R$ 10
e confirmar que o progresso mexeu.

---

## Telegram (subprojeto B) — ativação

Variáveis no `.env` do servidor:

```
TELEGRAM_BOT_TOKEN=...        # token do @BotFather (obrigatório)
TELEGRAM_WEBHOOK_SECRET=...   # string aleatória; valida o webhook
ALERTS_CRON_TOKEN=...         # protege /api/telegram/run-alerts
```

Passos:

1. Criar o bot no **@BotFather**, pegar o token, pôr em `TELEGRAM_BOT_TOKEN`.
2. Registrar o webhook (uma vez), passando o mesmo secret:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://SEUDOMINIO.com.br/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

3. No app: **Configurações → Telegram Bot → Conectar**, abrir o link e enviar `/start`.
4. Alertas: o agendador in-process dispara às **08:00 (America/Sao_Paulo)** e o resumo na
   segunda. Para forçar/testar (ou usar cron externo):

```bash
curl -s -X POST "https://SEUDOMINIO.com.br/api/telegram/run-alerts?weekly=1" \
  -H "x-alerts-token: $ALERTS_CRON_TOKEN"
```

5. Regras do Firestore: publicar as novas coleções `telegram_links` e `telegram_codes`
   (restritas ao dono) junto do `firebase deploy --only firestore:rules`.
