# Auditoria & Hardening pré-VPS — Design

**Data:** 2026-07-29
**Autor:** Lucas + Claude
**Status:** Aprovado (aguardando execução)

## Contexto e visão do produto

"Agência CIIS — Gestão & Orçamentos" (FinanFlow) é a central financeira única do usuário:
controla a vida financeira **PF** dele (separada da esposa) **e** a **PJ** da empresa, no mesmo
sistema, com saúde financeira, metas, quitação de dívidas, orçamento, vendas, cadastros
(clientes, bancos, produtos), inadimplência, e avisos no celular. O destino de deploy é uma
**VPS Hostinger**.

O pedido do usuário foi decomposto em quatro subprojetos independentes, cada um com seu
próprio ciclo spec → plano → execução:

| # | Subprojeto | Descrição |
|---|---|---|
| **A** | **Auditoria & Hardening** | Rodar o app, testar cada botão/cálculo, conferir diagramação, listar e corrigir bugs. **← este spec** |
| B | Alertas & Chat (Telegram) | Bot Telegram com avisos proativos (vencimento, saldo vermelho) + comandos de consulta/lançamento. |
| C | Features de gestão | Inadimplência; orçamento→venda/receita **e** catálogo de produtos + PDV; painel de saúde melhorado; PF x esposa x PJ. |
| D | Deploy VPS Hostinger | Subir, chave Gemini no servidor, deploy das regras Firestore, domínio, HTTPS. |

Este spec cobre **apenas o subprojeto A**. B, C e D serão brainstormados depois.

## Objetivo do subprojeto A

Verificar e endurecer todo o sistema **antes** do deploy, com evidências, cobrindo três eixos:

1. **Cálculos** — cada número exibido bate com o módulo `lib/` testado (sem cópia inline divergente).
2. **Botões/ações** — cada controle dispara um handler real (nenhum botão morto).
3. **Diagramação** — nenhum elemento sobreposto/"cavalado", overflow, ou quebra em mobile/tablet.

Entregável: **relatório priorizado P0→P3**, cada achado com `arquivo:linha` e/ou print, seguido de
correção em lotes (com testes) aprovada pelo usuário.

## Método — 2 camadas

### Camada 1 — Auditoria de código (sem login, feita primeiro)

Para cada uma das 17 páginas (`src/pages/*`) + componentes (`src/components/*`) + libs (`src/lib/*`):

- **Botões:** rastrear cada `onClick`/`type="submit"` até um handler que faz algo real. Marcar
  handlers vazios, `TODO`, ou que só fecham modal sem persistir. (Histórico: commit `11e45fb`
  corrigiu 12 botões mortos — reincidência é o risco.)
- **Cálculos:** confirmar que a UI consome o módulo `lib/` testado e não uma cópia inline. Já
  detectado: `src/lib/budgets.ts` está órfão (0 imports); `Budgets.tsx` só salva config e nunca
  compara com o realizado.
- **Diagramação:** varrer classes Tailwind por riscos de layout — `absolute`/`fixed` sem
  contêiner posicionado, z-index conflitante, larguras fixas que estouram, ausência de
  `min-w-0`/`truncate` em flex, grids sem breakpoint, modais sem `max-h`/scroll.
- **Robustez:** estados vazios, loading, e tratamento de erro do Firestore.

### Camada 2 — Auditoria visual ao vivo (precisa de app + login)

1. Subir dev server em porta livre (`PORT=<livre> npm run dev`; portas ocupadas conhecidas na
   memória do projeto; 4321 funcionou antes).
2. Rodar `npm run seed` para popular ~4 meses de dados de simulação (marcados `seed:true`,
   removíveis com `npm run seed:clean`). **Grava no Firestore real** — autorizado pelo usuário.
3. Abrir no browser interno. **O usuário faz o clique de login** (credenciais pré-preenchidas);
   por regra de segurança o assistente não digita senha.
4. Navegar cada tela: print, clicar botões, conferir layout real em **desktop / tablet / mobile**.

## Achados já conhecidos (entram no relatório)

- **P0 — senha real no código-fonte:** `136479` hardcoded em `src/pages/Login.tsx:9` e
  `scripts/seed.ts`; vai no bundle. Precisa sair antes de VPS pública.
- **P2 — `src/lib/budgets.ts` órfão:** lógica testada (9 testes) nunca ligada à UI.
- **P2 — credenciais de cliente em texto puro:** `Clients.tsx` grava Instagram/Facebook/Google
  Ads/WordPress sem criptografia no Firestore.
- Pendências de infra (viram subprojeto D): `GEMINI_API_KEY` placeholder → IA responde 503; sem
  `git remote` (backup só no SSD); `firebase deploy --only firestore:rules` pendente.

## Priorização

- **P0** — bloqueia deploy ou expõe segredo/dado (ex.: senha no fonte).
- **P1** — cálculo errado ou botão crítico morto (usuário toma decisão errada).
- **P2** — funcionalidade incompleta / dado não persistido / código órfão.
- **P3** — cosmético / diagramação menor.

## Fora de escopo (deste subprojeto)

Novas features (inadimplência, PDV, Telegram, deploy). Refatoração não relacionada a um achado.

## Critério de conclusão

Relatório entregue e revisado; correções P0/P1 aplicadas com `npm test`, `tsc --noEmit` e
`vite build` verdes; usuário validou visualmente as telas corrigidas.
