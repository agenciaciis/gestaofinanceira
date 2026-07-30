# Subprojeto B — Alertas & Comandos no Telegram — Design

**Data:** 2026-07-30 · **Status:** Aprovado
**Depende de:** subprojeto A (mergeado). **Bloqueia deploy real:** token do bot + VPS (subprojeto D).

## Objetivo

Um bot de Telegram que (1) **avisa** você no celular sobre eventos financeiros e (2) aceita
**comandos** para consultar e lançar — num **único chat consolidado** (PF+PJ), cada linha marcada
`[PF]`/`[PJ]`. Reaproveita o cérebro do WhatsApp (parser + IA + escrita).

## Decisões (aprovadas)

- **Alertas:** conta a vencer, saldo no vermelho, orçamento estourado, resumo periódico (semanal).
- **Comandos:** consultar **e** lançar (texto + foto).
- **Um chat só**, consolidado.

## Arquitetura

```
Telegram  ──update──▶  POST /api/telegram/webhook ──▶ chatCommands.handleChatCommand()
                                                          │ (mesmo cérebro do WhatsApp)
                                                          ▼
                                                   Firestore (Admin)
scheduler (diário) ──▶ /api/telegram/run-alerts ──▶ telegramAlerts.selectAlerts() ──▶ sendMessage()
```

### Peças

1. **`src/lib/telegramAlerts.ts` (puro, testado)** — dado um retrato financeiro (contas+saldos,
   transações, orçamentos, dívidas, hoje, config, entidades) devolve a lista de alertas a disparar,
   já com o texto pronto e uma **chave de anti-spam** por alerta. Também monta o **resumo semanal**.
   Não toca em rede nem Firestore. É onde mora a correção → tem testes Vitest.
2. **`chatCommands.ts` (servidor, compartilhado)** — extrai a lógica hoje embutida no webhook do
   WhatsApp (`server.ts` 143-260): saldo/extrato/dívidas/ajuda, criar transação (texto/foto/IA),
   apagar/corrigir último. Recebe `{ db, admin, entity, text, hasImage, getImageBase64, senderKey }`
   e devolve `responseText`. WhatsApp e Telegram passam a chamar o mesmo handler.
3. **`telegram.ts` (servidor)** — `sendMessage(chatId, text)`, `setWebhook()`, verificação do
   secret token, parsing do update (texto/foto/`/start <code>`).
4. **`server.ts`** — monta `POST /api/telegram/webhook`, `POST /api/telegram/run-alerts` (protegido
   por token) e um **scheduler in-process** (setInterval horário; dispara o job diário às 08:00
   America/Sao_Paulo e o resumo semanal na segunda; guarda "última execução" para não repetir).
5. **Settings → aba Telegram (cliente)** — mostra o link `t.me/<bot>?start=<code>`, o status da
   conexão e as preferências (dias de antecedência, piso do saldo), reusando `finanflow:notif-prefs`.

### Vínculo chat ↔ usuário

- Token do bot: **global**, em `TELEGRAM_BOT_TOKEN` (env do servidor). Um bot para o app todo.
- `/start <code>`: o `<code>` identifica o usuário Firebase (uid). O servidor grava o vínculo em
  `telegram_links/{chatId} = { uid, linkedAt }` e/ou `user_prefs/{uid}.telegramChatId`.
- Alertas: para cada usuário com chat vinculado, iteramos **as entidades dele** (ownerUid), montamos
  os alertas por entidade e mandamos tudo no mesmo chat, marcado `[PF]`/`[PJ]`.
- Lançar por chat consolidado exige saber PF ou PJ: usa uma **entidade padrão** (config do usuário);
  dá para redirecionar dizendo "…na pj". Consultas de saldo somam o consolidado.

## Alertas — regras

- **Conta a vencer:** despesa `pending` com vencimento em ≤ N dias (padrão N=2). Chave `due:<txId>`.
- **Saldo no vermelho:** conta com saldo < piso (padrão 0). Chave `red:<accountId>:<yyyy-mm-dd>` (1x/dia).
- **Orçamento estourado:** categoria passando de 80% e de 100% (via `budgetProgress`). Chave
  `budget:<cat>:<yyyy-mm>:<faixa>` (1x por faixa/mês).
- **Resumo semanal:** segunda 08:00 — entradas, saídas, saldo e o que vence na semana.
- **Anti-spam:** as chaves já enviadas ficam em `telegram_links/{chatId}.sentKeys` (ou coleção). O
  módulo puro só decide *o que* disparar; o servidor filtra pelas chaves já enviadas e persiste.

## Fora de escopo (agora)

- Enviar de verdade (precisa do token + deploy — subprojeto D).
- Botões inline/menus ricos do Telegram (v2).
- Multi-usuário além do dono (o modelo suporta, mas o foco é o Lucas).

## Testes

- `telegramAlerts.test.ts`: cada tipo de alerta dispara na condição certa e **não** dispara fora
  dela; chaves de anti-spam estáveis; resumo semanal com números coerentes; nada de NaN.
- `chatCommands` ganha os primeiros testes das partes puras (montagem de resposta) que o webhook do
  WhatsApp nunca teve; a orquestração com Firestore Admin continua verificada só no deploy.

## Critério de conclusão

`telegramAlerts.ts` testado; `chatCommands.ts` extraído e WhatsApp seguindo verde; webhook +
scheduler + aba de Settings implementados; `tsc`, `npm test` e `vite build` verdes. Ativação real
(token + `setWebhook` + VPS) fica documentada para o subprojeto D.
