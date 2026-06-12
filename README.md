# Agência CIIS - Gestão & Orçamentos

Este é o sistema de gestão financeira e geração de orçamentos da Agência CIIS.

## Requisitos

- Node.js 22 ou superior
- NPM ou Yarn
- Uma instância do Firebase (Firestore e Auth)
- (Opcional) Evolution API para integração com WhatsApp

## Como Rodar Localmente

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Configure as variáveis de ambiente:
   - Crie um arquivo `.env` baseado no `.env.example`.
   - Certifique-se de ter o arquivo `firebase-applet-config.json` na raiz do projeto.

3. Inicie o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```

## Como Implantar em uma VPS

1. Clone o repositório na sua VPS.

2. Instale as dependências de produção:
   ```bash
   npm install --production
   ```
   *Nota: Se você for rodar o build na VPS, instale todas as dependências primeiro.*

3. Gere o build do frontend:
   ```bash
   npm run build
   ```

4. Configure as variáveis de ambiente no seu gerenciador de processos (ex: PM2) ou no arquivo `.env`.

5. Inicie o sistema com PM2 (recomendado):
   ```bash
   pm2 start npm --name "agencia-ciis" -- start
   ```

## Estrutura do Projeto

- `src/`: Código fonte do frontend (React + Vite).
- `server.ts`: Servidor Express que gerencia a API e serve o frontend.
- `firestore.rules`: Regras de segurança do Firestore.
- `firebase-blueprint.json`: Estrutura de dados do Firebase.

## Integração WhatsApp

O sistema está preparado para integrar com a **Evolution API**. Configure a URL da API, a Chave de API e o nome da instância nas configurações do sistema dentro do app.
