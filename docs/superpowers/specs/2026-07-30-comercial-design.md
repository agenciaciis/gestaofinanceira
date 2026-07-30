# Subprojeto C — Comercial (serviços, orçamentos→OS, clientes, produtos) — Design

**Data:** 2026-07-30 · **Status:** Aprovado (usuário ausente — executar autônomo)
**Decisões:** Orçamento aprovado **é** a Ordem de Serviço; auto-receita entra **a receber
(pendente)**; produtos = **catálogo simples** (negócio é prestação de serviços de criação/dev +
produtos digitais).

## Objetivo

Fazer o comercial "conversar" de ponta a ponta: cadastrar serviços/produtos, montar orçamento,
aprovar/converter → e o orçamento convertido **gera a receita** (única, parcelada ou recorrente)
já vinculada ao cliente, sem cadastro em dobro e sem pontas soltas.

## Peças

### C1 — Motor de conversão (`src/lib/orders.ts`, puro, testado)
`quoteToRevenueTransactions(quote, entity, ref)` → `Transaction[]` de **receita pendente**
(`type:'income'`, `status:'pending'`, `clientId`, `categoryId:'venda'`, `sourceQuoteId`):
- **Único** (`installments<=1`, sem recorrência): 1 lançamento na data do orçamento.
- **Parcelado** (`installments>1`): N lançamentos com `installmentGroupId`, valores por
  `splitInstallments(total, N)`, um por mês a partir da data.
- **Recorrente** (`recurrenceConfig.enabled`): 1 lançamento com `recurringGroupId` +
  `recurringPeriod`, que o `recurring.ts` renova sozinho.
Cada lançamento carrega `sourceQuoteId = quote.id` para **idempotência** (reconverter não duplica)
e para o histórico do cliente.

### C2 — Converter orçamento (Quotes.tsx)
Botão **"Converter em OS / Receita"** no menu de status:
1. Se o cliente era novo (sem `clientId`), cria o cliente com nome/e-mail do orçamento.
2. Gera as receitas via C1 num `writeBatch`.
3. Marca o orçamento `status:'converted'`.
4. **Idempotente:** se já existem transações com aquele `sourceQuoteId`, avisa e não regenera.

### C3 — Catálogo de produtos
Novo tipo `Product` + subcoleção `entities/{id}/products` (nome, descrição, preço, custo).
Nova aba **Produtos** na tela de Serviços (mesmo padrão de Serviços/Planos). No orçamento, botão
**"+ Produto"** puxa produtos cadastrados (item `type:'product'`).

### C — Histórico do cliente (Clients.tsx)
Painel/aba **Histórico** por cliente: recebido / a receber (`partyTotals`, já existe), **lista de
lançamentos** do cliente e as **OS ativas** (orçamentos convertidos dele). Vínculo serviço↔cliente
é derivado das OS — sem cadastro manual duplicado.

### C4 — Simulação de 1 ano
Estender o seed: ~12 meses de uso. Serviços reais da agência (site, social media, tráfego pago,
logo, identidade visual, projeto), alguns produtos digitais, clientes, orçamentos em vários status
e OS convertidas gerando receita recorrente/parcelada — tudo vinculado. Papel timbrado: instruído a
subir pela UI (não dá pra embutir a imagem do chat).

## Mudanças de tipo
- `Transaction.sourceQuoteId?: string` (idempotência + histórico).
- Novo `Product { id, name, description?, price, costPrice?, entityId, createdAt, active? }`.
- Regra Firestore para `entities/{id}/products` (espelha `services`).

## Testes
`orders.test.ts`: único/parcelado/recorrente geram o esperado; soma das parcelas fecha o total;
idempotência (mesma `sourceQuoteId` detectada); nada de NaN; recorrente marca os campos certos.
Estender `simulacao*.test.ts` para incluir receita de OS convertida cruzando com finance/partyTotals.

## Fora de escopo
Estoque/PDV; assinatura de contrato digital; cobrança automática (gateway). Ficam para depois.

## Critério de conclusão
`orders.ts` testado; converter funciona e é idempotente; produtos no orçamento; histórico do
cliente; seed de 1 ano; `tsc`, `npm test`, `vite build` verdes; merge na `main`.
