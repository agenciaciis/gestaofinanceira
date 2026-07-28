# Plano de Quitação — fonte única de verdade da dívida

**Data:** 2026-07-28
**Objetivo do sistema:** ajudar a sair das dívidas com controle financeiro PF e PJ separados.

## Problema

O sistema hoje não sabe quanto o usuário deve, e o número que mostra está errado por três motivos:

1. **Saldo devedor não se atualiza.** `remainingAmount` só é escrito pelo formulário manual em
   `FinancialHealth.tsx:236`. Nenhum pagamento o decrementa. Pagar a parcela em Lançamentos deixa
   a tela de Dívidas mostrando o valor antigo indefinidamente.
2. **Parcelamentos ficam de fora.** O usuário registra dívida como lançamento parcelado
   (`installmentGroupId`, N parcelas `pending`). Essas parcelas em aberto são dívida real e não
   entram em `totalDebt`.
3. **Fatura de cartão fica de fora.** `computeCardInvoice` existe e funciona, mas nem `totalDebt`
   nem o health score a consideram.

Além disso, não há resposta para as duas perguntas que importam: **qual dívida atacar primeiro** e
**quando eu fico livre**.

## Decisão de arquitetura

**Dívida é derivada, não declarada.** O saldo devedor de um parcelamento passa a ser calculado a
partir das parcelas em aberto, não digitado. Isso elimina a manutenção manual e a classe inteira de
bugs de "número desatualizado".

A coleção `debts` continua existindo, mas com escopo reduzido: apenas dívida que **rende juros sobre
o saldo** (empréstimo com taxa, rotativo, cheque especial, acordo renegociado) — o que não pode ser
derivado de parcelas fechadas.

Alternativas descartadas:

- **Vínculo explícito (`debtId` na transação):** exige o usuário marcar cada lançamento; volta a
  quebrar quando ele esquecer.
- **Só melhorar o cálculo da coleção `debts`:** barato, mas mantém parcelamentos e cartão fora da
  conta — o total continua mentindo.

## Componentes

### `src/lib/debts.ts` — motor puro (novo)

Sem dependência de Firebase ou React, no mesmo padrão de `src/lib/finance.ts`. Reusa
`round2`, `parseLocalDate` e `computeCardInvoice` de lá.

#### Tipo normalizado

```ts
export type DebtSource = 'installments' | 'loan' | 'card';

export interface DebtView {
  id: string;              // installmentGroupId | debt.id | `card:${cardId}`
  source: DebtSource;
  name: string;            // sem o sufixo "(3/12)"
  balance: number;         // saldo devedor hoje
  monthlyPayment: number;  // parcela/pagamento mensal
  interestRate: number | null;  // % ao mês; null = desconhecida
  dueDay: number;          // dia do mês do vencimento
  installmentsLeft: number | null;  // parcelas restantes (null se não parcelado)
  overdue: boolean;        // tem parcela vencida em aberto
}
```

`interestRate: null` é significativo, não é "zero". Representa "taxa não informada" e a UI cobra
essa informação do usuário.

#### `collectDebts(transactions, debts, cards, reference?): DebtView[]`

Une as três fontes:

**Parcelamentos.** Agrupa transações por `installmentGroupId` onde `type === 'expense'` e
`status === 'pending'`. Ignora `cancelled` e ignora grupos com `recurringGroupId` (despesa fixa
recorrente não é dívida — `Transactions.tsx:541` cria 12 ocorrências que não têm fim previsto).

- `balance` = soma das parcelas pendentes
- `monthlyPayment` = valor da próxima parcela a vencer
- `name` = descrição com o sufixo `" (i/N)"` removido via regex `/\s*\(\d+\/\d+\)\s*$/`
- `dueDay` = dia do mês da próxima parcela
- `installmentsLeft` = quantidade de parcelas pendentes
- `interestRate` = `null` (juros já embutidos na parcela; taxa efetiva desconhecida)
- Grupo sem nenhuma parcela pendente não gera `DebtView` — a dívida acabou sozinha

**Dívidas com juros.** Um `DebtView` por documento da coleção `debts`, mapeamento direto.
`interestRate` vem de `debt.interestRate`; `0` informado explicitamente continua sendo `0`, não
`null`.

**Cartão.** Um `DebtView` por cartão com fatura aberta, via `computeCardInvoice(cardId,
closingDay, transactions, reference)`. Fatura zerada não gera entrada. `monthlyPayment` = a própria
fatura (premissa: paga integral). `interestRate` = `null`.

#### `rankByCost(views): RankedDebt[]`

Ordena por **custo real em R$/mês** = `balance × (interestRate / 100)`, decrescente. Responde "qual
ataco primeiro" em dinheiro, não em tamanho.

`interestRate === null` → custo desconhecido. Vai para o fim da lista, marcado com
`unknownRate: true`, para a UI exibir o aviso e pedir a taxa.

#### `payoffSchedule(views, extraMonthly, strategy, reference?): PayoffResult`

Simulação mês a mês de todas as dívidas em conjunto.

```ts
export interface PayoffResult {
  months: number;              // até zerar tudo
  freedomDate: Date;           // mês em que fica livre
  totalInterest: number;       // juros pagos no caminho
  totalPaid: number;
  neverEnds: DebtView[];       // dívidas cuja parcela não cobre os juros
  timeline: { month: number; totalBalance: number; interestPaid: number }[];
}
```

Regras da simulação:

- `strategy: 'avalanche'` → prioriza maior `interestRate`; `null` tratada como `0` para ordenação
- `strategy: 'snowball'` → prioriza menor `balance`
- A cada mês: acumula juros sobre o saldo de cada dívida, paga o `monthlyPayment` de todas, e joga
  `extraMonthly` **inteiro na dívida prioritária**. Quando ela zera, o `monthlyPayment` dela é
  liberado e somado ao extra (efeito bola de neve real).
- Parcelamento (`interestRate === null`) não acumula juros — o saldo só decresce pelo pagamento.
- Pagamento não pode exceder o saldo restante da dívida; a sobra vai para a próxima da fila.
- **Dívida que nunca acaba:** se `balance × taxa >= monthlyPayment`, entra em `neverEnds` e é
  **excluída** da simulação, que continua normalmente com as demais. Não trava, não retorna
  `Infinity` para tudo — hoje `calculatePayoff` (`FinancialHealth.tsx:150`) contamina o total inteiro
  com `Infinity` quando uma única dívida é impagável.
- Teto de 600 meses (50 anos) como trava de segurança.

#### `compareExtraPayment(views, extraMonthly, strategy, reference?): ExtraComparison`

Roda `payoffSchedule` com e sem o extra e devolve a diferença:

```ts
export interface ExtraComparison {
  monthsSaved: number;
  interestSaved: number;
  baseline: PayoffResult;
  withExtra: PayoffResult;
}
```

É o número que motiva: *"com +R$300/mês você sai em jul/2027 em vez de mar/2029 e economiza
R$ 4.180 de juros."*

### `src/pages/FinancialHealth.tsx` — Plano de Quitação

Reescreve o miolo de cálculo para consumir `debts.ts`. A página já tem 53 mil caracteres; a lógica
que sair dela vai para o módulo puro, o que reduz o arquivo em vez de aumentá-lo.

Muda:

- **Total devido** passa a ser a soma dos três `DebtView`s, com quebra por fonte
  (parcelamentos / juros / cartão). Hoje omite duas das três.
- **Ranking de ataque** — nova seção com a lista ordenada por custo, cada linha mostrando o custo
  mensal em R$. Linhas com `unknownRate` exibem "⚠️ taxa não informada" e um campo inline para
  informar a taxa. Onde a taxa é gravada depende da fonte: `source: 'loan'` grava em
  `debts/{id}.interestRate`; `source: 'installments'` e `source: 'card'` gravam em `debt_meta`
  (ver *Persistência da taxa informada*), com chave `installmentGroupId` ou `card:${cardId}`.
- **Data de libertação** — `freedomDate` e juros totais, com o seletor avalanche × bola de neve
  lado a lado mostrando os dois resultados.
- **Controle de pagamento extra** — input de valor mensal extra, resultado de `compareExtraPayment`
  atualizado ao vivo.
- **`calculatePayoff` local é removida** — substituída pelo motor testado.
- **Alertas de dívida** (`activeAlerts`, WhatsApp) permanecem como estão.

### Persistência da taxa informada

Parcelamento e cartão não têm documento próprio onde gravar a taxa. Nova subcoleção
`entities/{id}/debt_meta/{viewId}` com `{ interestRate: number, updatedAt }`, onde `viewId` é o
`DebtView.id` (`installmentGroupId` para parcelamentos, `card:${cardId}` para cartões).
`collectDebts` recebe esses metadados como parâmetro opcional e os aplica ao `DebtView`
correspondente. Documento ausente = `interestRate: null`, o comportamento padrão.

`firestore.rules` precisa de uma regra para `debt_meta` no mesmo molde das demais subcoleções
(`isEntityWriter` para escrita, colaborador para leitura), senão a gravação da taxa falha em
produção.

## Testes

`src/lib/debts.test.ts`, mesmo formato dos 47 testes existentes (Vitest, dados literais, sem mocks
de Firebase).

Cobertura obrigatória:

- Parcelamento: saldo = soma das pendentes; parcelas `completed` e `cancelled` ignoradas
- Nome do parcelamento com o sufixo `(3/12)` removido
- Grupo `recurringGroupId` não vira dívida
- Grupo totalmente pago não gera `DebtView`
- Fatura de cartão zerada não gera `DebtView`
- Três fontes juntas: total confere
- `rankByCost`: ordem por custo em R$, não por saldo; `null` no fim com `unknownRate`
- `payoffSchedule` avalanche vs. bola de neve produzem ordens diferentes e o mesmo saldo final zero
- Liberação de parcela: ao quitar uma dívida, o pagamento dela passa para a próxima
- Dívida impagável entra em `neverEnds` **sem** contaminar o resultado das demais
- `compareExtraPayment`: extra maior ⇒ `monthsSaved` maior e `interestSaved` maior
- Arredondamento: soma das parcelas de `splitInstallments` fecha o total sem drift de centavos

## Fora de escopo desta entrega

Dependem desta base estar correta e vêm na sequência:

- "Posso gastar?" — quanto sobra com segurança hoje
- Consolidação PF × PJ e pró-labore vinculado
- Health score refeito (comprometimento da renda, meses de reserva)
- Chave do Gemini exposta no bundle (`dist/assets/index-NN2pCSeX.js`) — falha de segurança real,
  tratada em entrega própria

## Critério de aceite

- `npm test` verde com os novos casos
- `npm run lint` sem erros
- `npm run build` exit 0
- O total devido na tela reflete as três fontes
- Pagar uma parcela reduz o saldo devedor sem nenhuma edição manual
