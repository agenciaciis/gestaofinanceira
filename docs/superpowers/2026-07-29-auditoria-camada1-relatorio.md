# Relatório de Auditoria — Camada 1 (código)

**Data:** 2026-07-29 · **Branch:** `auditoria-hardening`
**Cobertura:** 17 páginas + 8 componentes + módulos `lib/`, auditados por 4 revisores em paralelo.
**Eixos:** botão morto · cálculo divergente do `lib` · diagramação · robustez.

> Camada 2 (visual ao vivo, com app rodando + login) ainda pendente — vai confirmar/complementar
> os itens de diagramação com prints reais.

## Placar

| Sev | Qtde | Significado |
|-----|------|-------------|
| **P0** | 1 | Expõe segredo / bloqueia deploy |
| **P1** | 4 | Cálculo errado ou entrega/documento errado ao cliente |
| **P2** | 18 | Funcionalidade incompleta, dado errado/não persistido, código órfão |
| **P3** | 20 | Cosmético / diagramação menor / manutenção |

---

## P0 — Bloqueia deploy

### P0.1 — Senha e e-mail reais no código-fonte
- **Arquivo:** `src/pages/Login.tsx:8-9`, `scripts/seed.ts`
- E-mail `lucas@agenciaciis.com.br` e senha `136479` são o estado inicial do formulário → **vão no bundle JS** servido ao cliente. Qualquer um que abrir o app logga como dono.
- **Ação:** remover os defaults (deixar campos vazios), **trocar a senha** (já comprometida), tirar os defaults do seed (usar env). Bloqueia o deploy na VPS pública.

---

## P1 — Cálculo/entrega errada

### P1.1 — PDF de orçamento com papel timbrado sai SEM itens, total e pagamento
- **Arquivo:** `src/pages/Quotes.tsx:342-360`, `388-389`
- `buildPDF` no caminho "com timbrado" desenha só logo + nº + cliente + data e faz `return doc` antes da tabela de itens/totais. Baixar/Imprimir/Compartilhar geram um PDF vazio de valores.
- **Impacto:** o documento que vai assinado ao cliente não tem preço. **Feature estimulada pela própria UI.**

### P1.2 — Totais do orçamento calculados inline divergem de `quoteTotals` (e são gravados)
- **Arquivo:** `src/pages/Quotes.tsx:114-116` (persistido em `215-217`, impresso em `449-462`)
- Reimplementa subtotal/desconto/total sem `round2`, sem `Math.max(0,…)`; **total pode ficar negativo** se desconto > subtotal (o `lib` zera). Valores errados vão pro Firestore e pro PDF.

### P1.3 — Campo de desconto não existe na UI (feature morta)
- **Arquivo:** `src/pages/Quotes.tsx:876-931` vs `115`, `451-456`
- Modelo, cálculo e PDF suportam desconto, mas **não há input** para digitá-lo → `discountTotal` sempre 0. Impossível dar desconto num orçamento.

### P1.4 — Credenciais de clientes (Instagram/Facebook/Google Ads/WordPress) em texto puro
- **Arquivo:** `src/pages/Clients.tsx:75-84`, `168-176`, `732-738`
- Logins/senhas gravados como string crua no Firestore, input `type="text"`, sem cifra. Colaborador/backup/vazamento expõe tudo. (Limítrofe P0.)

---

## P2 — Incompleto / dado errado / órfão

### P2.1 — `budgets.ts` órfão + comparação orçado×realizado divergente em 3 lugares
- **Arquivo:** `src/lib/budgets.ts` (0 imports de produção) · `Budgets.tsx:39-67` · `Dashboard.tsx:286-301` · `Notifications.tsx:130-147`
- A lib testada não é usada. `Budgets.tsx` só grava limites e **nunca mostra o realizado**. A comparação é reimplementada 3× com regras diferentes: Dashboard **não filtra `type`**; Notifications usa `isRealized` em vez de `status==='completed'`. Números discordam entre sino e painel.

### P2.2 — Dashboard: orçamentos não resetam e se mesclam entre entidades
- **Arquivo:** `src/pages/Dashboard.tsx:119`, `190-195`
- `setBudgets(prev => ({...prev, ...}))` sem reset; ao trocar entidade fica o valor antigo, e no modo consolidado os limites de várias entidades se sobrescrevem (não somam). Reports faz certo (`setBudgets({})`).

### P2.3 — Reports: projeção "Saldo Acumulado" mistura líquido mensal com acumulado
- **Arquivo:** `src/pages/Reports.tsx:230-254`, `811-819`
- Histórico plota líquido de cada mês; futuro acumula, partindo do líquido de um único mês (não do saldo real). A curva muda de sentido no "hoje" e induz leitura errada do caixa futuro.

### P2.4 — Cartões: fatura por mês-calendário diverge de `computeCardInvoice`
- **Arquivo:** `src/pages/CreditCards.tsx:183-213`, `450-473`
- Comparativo e Histórico agrupam por mês-calendário (`new Date`, UTC) ignorando `closingDay` e somando canceladas/receitas. "Fatura de Julho" ≠ ciclo real.

### P2.5 — Cartões: divisão por zero (limite 0 → `NaN%`) no grid
- **Arquivo:** `src/pages/CreditCards.tsx:294` (a visão em lista tem guarda, o grid não).

### P2.6 — Cartões: listeners de transações vazando/duplicados
- **Arquivo:** `src/pages/CreditCards.tsx:67-96` — um `onSnapshot` da coleção inteira por cartão, recriado a cada mudança, sem cancelar os anteriores. Custo de leitura e degradação.

### P2.7 — Dívidas: filtro "Todos" idêntico a "Pendentes"; estado `paid` inalcançável
- **Arquivo:** `src/pages/Debts.tsx:82`, `135-142` — só carrega `status==='pending'`; "Todos" não mostra nada a mais.

### P2.8 — Lançamentos: datas exportadas saem 1 dia antes (UTC) no Excel/CSV
- **Arquivo:** `src/pages/Transactions.tsx:289`, `307` — export usa `new Date(t.date)` em vez de `parseLocalDate` (que a tela usa).

### P2.9 — Settings: botão "Excluir Todos os Meus Dados" é morto
- **Arquivo:** `src/pages/Settings.tsx:103-112` (botão em `399-404`) — após confirmar ação irreversível, só mostra toast "em desenvolvimento".

### P2.10 — Settings: toggles de Notificação decorativos (sem handler)
- **Arquivo:** `src/pages/Settings.tsx:208-222` — 3 switches `<div>` sem `onClick`/estado/persistência.

### P2.11 — Caixinhas: editar trocando a entidade duplica o registro
- **Arquivo:** `src/pages/Goals.tsx:124-159` — grava na entidade nova sem remover da antiga; totais somam as duas cópias.

### P2.12 — Clientes: grid usa cálculo inline divergente de `partyTotals`
- **Arquivo:** `src/pages/Clients.tsx:151-160` vs `320-329` — "A receber" difere entre grid e lista.

### P2.13 — Clientes: aba "Acessos" perde campos ao editar cliente antigo
- **Arquivo:** `src/pages/Clients.tsx:212`, `727-740` — renderiza `Object.keys(credentials)`; cliente com credenciais parciais some os demais campos e salva reduzido.

### P2.14 — Serviços: crashes por campo undefined
- **Arquivo:** `src/pages/Services.tsx:158`, `174`, `453` — `basePrice.toString()`, `plan.services.map` sem guarda; plano/serviço legado derruba o card/edição.

### P2.15 — Orçamentos: data off-by-one (UTC) no grid e no PDF
- **Arquivo:** `src/pages/Quotes.tsx:355`, `420`, `425`, `671`, `675` — grid/PDF usam `new Date`; lista usa `parseLocalDate`. Data/validade 1 dia adiantadas no PDF do cliente.

### P2.16 — Orçamentos: `items` sem guarda no edit/card
- **Arquivo:** `src/pages/Quotes.tsx:271`, `679` — orçamento legado sem `items` trava lista/edição.

### P2.17 — Equipe: `addedAt` pode renderizar "Invalid Date"
- **Arquivo:** `src/pages/Team.tsx:181` — `new Date(member.addedAt)` sem tratar `Timestamp`/undefined.

### P2.18 — Notificações: estouro de orçamento usa base diferente do Dashboard
- **Arquivo:** `src/components/Notifications.tsx:134-138` — `isRealized(t)` vs `status==='completed'`. (Some junto com P2.1.)

---

## P3 — Cosmético / diagramação / manutenção

- **P3.1** Dashboard: botão Receber/Pagar navega junto (falta `stopPropagation`) — `Dashboard.tsx:1181,1202`.
- **P3.2** Reports: cards (realizado) vs gráficos (inclui pendente) não batem no mês corrente — `Reports.tsx:127-131,188-189`.
- **P3.3** FinancialHealth: progresso da dívida `/(totalAmount)` sem guarda → "NaN%" — `FinancialHealth.tsx:822`.
- **P3.4** FinancialHealth: modal "Nova Dívida" sem `max-h`/scroll — `1272-1276`.
- **P3.5** Reimplementação inline de `totalBalance`/`budgetProgress` (regra de ouro) — `Dashboard.tsx:220,286`, `FinancialHealth.tsx:168`, `Reports.tsx:202`.
- **P3.6** CreditScorePanel: "Atualizado há null dias" em data corrompida — `68-69,174`.
- **P3.7** ImportTransactionsModal: classes Tailwind inválidas `border-bottom`/`border-top` (divisórias não aparecem) — `248,264,533`.
- **P3.8** ImportTransactionsModal: tipo inferido só pelo sinal do valor (despesa vira receita) — `87-94`.
- **P3.9** Dívidas: "Total Pendente" compensa a pagar × a receber e usa `abs` — `Debts.tsx:144,171`.
- **P3.10** Lançamentos: preview de parcela usa divisão bruta, pode mostrar "R$ NaN" — `Transactions.tsx:1422`.
- **P3.11** Cartões/Clientes/Fornecedores: `loading` declarado e nunca usado (flash de tela vazia).
- **P3.12** Fornecedores: `copyToClipboard` sem `catch` (feedback falso-positivo) — `Suppliers.tsx:176-180`.
- **P3.13** Serviços: margem reimplementada inline em vez de `serviceMargin` — `603-618`.
- **P3.14** Orçamentos: `quoteNumber` sem checagem de unicidade + `getDocs` importado sem uso — `201-206`.
- **P3.15** Cores `gray-50` hardcoded quebram dark mode; card de timbrado sob blobs decorativos (leve "cavalado") — Clients/Suppliers/Quotes.
- **P3.16** Settings/Team: código morto e imports não usados; `isOwner` calculado e nunca aplicado.
- **P3.17** Caixinhas: modal "Guardar/Resgatar" sem `max-h`/scroll — `Goals.tsx:603-606`.
- **P3.18** EntitySelector: `handleCreate` sem try/catch nem loading.
- **P3.19** Layout: dropdown de filtro não fecha por clique-fora e fica ilegível com sidebar recolhida — `Layout.tsx:158-215`.
- **P3.20** Import morto/estados `loading` síncronos em várias telas (padrão repetido).

---

## Confirmações positivas (não são bugs)

- **Nenhum botão puramente morto** por handler vazio nas telas de dinheiro/CRM — o histórico dos "12 botões" não reincidiu (as exceções são Settings P2.9/P2.10 e o "Todos" enganoso em Dívidas).
- `BankAccounts`, `CrossEntityTransferModal`, `DREPanel`, `PeriodComparePanel`, `ViewToggle` — **limpos**.
- `goals.ts`, `finance.ts`, `debts.ts`, `creditScore.ts` — sólidos, sem divisão por zero nos caminhos testados.
- z-index/sobreposição do `Layout` (header/sidebar/backdrops) coerentes.

## Sugestão de ordem de correção

1. **P0.1** (senha) — imediato, isolado.
2. **Lote Orçamentos** (P1.1, P1.2, P1.3, P2.15, P2.16, P3.14) — a tela mais quebrada; alto impacto no cliente.
3. **Lote Cartões** (P2.4, P2.5, P2.6).
4. **Lote Orçado×Realizado** (P2.1, P2.2, P2.18) — liga `budgets.ts` e unifica a regra.
5. **P1.4** (cifrar credenciais de cliente) — decisão de design (como cifrar) antes.
6. Restante P2, depois P3 (muitos resolvidos junto com a Camada 2 visual).
