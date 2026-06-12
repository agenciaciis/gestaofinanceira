# Guia de Implantação - FinanFlow

Este documento descreve como implantar o sistema FinanFlow em produção utilizando Google Cloud Run (para o App) e uma VPS (para a Evolution API).

## 1. Requisitos Prévios
- Uma conta no [Google Cloud Console](https://console.cloud.google.com/).
- Um projeto Firebase configurado (você já tem este).
- Uma VPS simples (1 vCPU, 2GB RAM) com Ubuntu 22.04+.
- Docker e Docker Compose instalados na VPS.

---

## 2. Implantando o App (Google Cloud Run)

O Cloud Run é ideal para o frontend e o backend Express do FinanFlow.

### Passo 1: Instalar o Google Cloud SDK
Siga as instruções oficiais para instalar o `gcloud` CLI no seu computador.

### Passo 2: Preparar o Ambiente
Certifique-se de que o arquivo `firebase-applet-config.json` está na raiz do projeto. Ele será empacotado junto com o código.

### Passo 3: Deploy
Execute o comando abaixo na raiz do projeto:
```bash
gcloud run deploy finanflow --source . --region us-east1 --allow-unauthenticated
```
*O Google Cloud irá detectar o `package.json`, buildar a imagem Docker automaticamente e te dar uma URL (ex: `https://finanflow-xyz.a.run.app`).*

---

## 3. Implantando a Evolution API (Na VPS)

A Evolution API gerencia a conexão com o WhatsApp.

### Passo 1: Criar o arquivo `docker-compose.yml` na VPS
Crie uma pasta chamada `evolution` e dentro dela o arquivo `docker-compose.yml`:

```yaml
version: '3.3'
services:
  evolution-api:
    image: atendare/evolution-api:latest
    container_name: evolution-api
    restart: always
    ports:
      - "8080:8080"
    environment:
      - SERVER_URL=http://IP_DA_SUA_VPS:8080
      - API_KEY=SUA_CHAVE_MESTRA_AQUI
      - AUTH_TYPE=apikey
      - STORE_MESSAGES=true
      - STORE_MESSAGE_UP_SERS=true
    volumes:
      - evolution_instances:/evolution/instances

volumes:
  evolution_instances:
```

### Passo 2: Rodar a API
```bash
docker-compose up -d
```

---

## 4. Conectando Tudo

1.  **No App FinanFlow:**
    - Vá em **Configurações > Integração WhatsApp**.
    - URL da API: `http://IP_DA_SUA_VPS:8080`
    - API Key: A chave que você definiu no `docker-compose.yml`.
    - Nome da Instância: Crie um nome (ex: `finanflow_main`).

2.  **Configurar o Webhook na Evolution API:**
    - Você deve configurar o Webhook da instância para apontar para a URL do seu app no Cloud Run:
    - URL do Webhook: `https://SUA-URL-DO-CLOUD-RUN.a.run.app/api/whatsapp/webhook`
    - Eventos: `MESSAGES_UPSERT`

---

## 5. Dicas de Segurança
- Use um domínio com SSL (HTTPS) para a sua VPS usando Nginx + Certbot.
- Nunca compartilhe sua `API_KEY` da Evolution API.
- No Firebase, certifique-se de que as `firestore.rules` estão ativas para proteger seus dados.
