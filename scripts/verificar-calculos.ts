/**
 * Auditoria de cálculos (SOMENTE LEITURA).
 * Puxa os dados reais do Firestore e recalcula os números principais, com
 * conferências independentes (soma crua × função do sistema).
 *
 * Uso no servidor:
 *   OWNER_EMAIL='lucas@agenciaciis.com.br' npx tsx scripts/verificar-calculos.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json';
import { Transaction, BankAccount, CreditCard, Debt } from '../src/types';
import {
  computeBalances, computeCardInvoice, round2, parseLocalDate, isCardExpense, isNotCancelled,
} from '../src/lib/finance';
import { computeSpendable } from '../src/lib/spendable';
import { collectDebts } from '../src/lib/debts';
import { consolidate } from '../src/lib/crossEntity';

const OWNER_EMAIL = process.env.OWNER_EMAIL ?? 'lucas@agenciaciis.com.br';
const PROJECT_ID = (firebaseConfig as any).projectId as string;
const DB_ID = (firebaseConfig as any).firestoreDatabaseId as string;
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n || 0);

function initCredential() {
  const local = path.join(process.cwd(), 'serviceAccount.json');
  if (fs.existsSync(local)) return cert(JSON.parse(fs.readFileSync(local, 'utf8')));
  return applicationDefault();
}

async function main() {
  const app = initializeApp({ credential: initCredential(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB_ID);
  const uid = (await getAuth(app).getUserByEmail(OWNER_EMAIL)).uid;

  const entSnap = await db.collection('entities').where('ownerUid', '==', uid).get();
  const entities = entSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const accounts: BankAccount[] = [];
  const cards: CreditCard[] = [];
  const debts: Debt[] = [];
  let txs: Transaction[] = [];
  for (const e of entities) {
    const [a, c, t, d] = await Promise.all([
      db.collection(`entities/${e.id}/bank_accounts`).get(),
      db.collection(`entities/${e.id}/credit_cards`).get(),
      db.collection(`entities/${e.id}/transactions`).get(),
      db.collection(`entities/${e.id}/debts`).get(),
    ]);
    a.docs.forEach(x => accounts.push({ id: x.id, ...(x.data() as any) }));
    c.docs.forEach(x => cards.push({ id: x.id, ...(x.data() as any) }));
    d.docs.forEach(x => debts.push({ id: x.id, ...(x.data() as any) }));
    t.docs.forEach(x => txs.push({ id: x.id, ...(x.data() as any) }));
  }

  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  const noMes = (d: Date) => d >= inicioMes && d < fimMes;

  console.log(`\n==================== AUDITORIA DE CÁLCULOS ====================`);
  console.log(`Dono: ${OWNER_EMAIL} | Entidades: ${entities.map(e => e.name).join(', ')}`);
  console.log(`Transações: ${txs.length} | Contas: ${accounts.length} | Cartões: ${cards.length} | Dívidas: ${debts.length}`);

  // 1) SALDO — função do sistema × soma manual, por conta
  console.log(`\n--- 1) SALDO POR CONTA (função × soma manual) ---`);
  const balances = computeBalances(accounts, txs);
  let saldoTotalLib = 0, saldoTotalManual = 0, divergencias = 0;
  for (const acc of accounts) {
    let manual = Number(acc.initialBalance) || 0;
    for (const t of txs) {
      if (t.status !== 'completed') continue;
      const amt = Number(t.amount) || 0;
      if (t.type === 'transfer') {
        if (t.accountId === acc.id) manual -= amt;
        if (t.toAccountId === acc.id) manual += amt;
      } else if (t.accountId === acc.id) {
        manual += t.type === 'income' ? amt : -amt;
      }
    }
    manual = round2(manual);
    const lib = round2(balances[acc.id] ?? 0);
    const bate = Math.abs(lib - manual) < 0.005;
    if (!bate) divergencias++;
    saldoTotalLib = round2(saldoTotalLib + lib);
    saldoTotalManual = round2(saldoTotalManual + manual);
    console.log(`  ${bate ? 'OK ' : '!! '} ${(acc.bankName || acc.id).padEnd(16)} lib=${brl(lib).padStart(14)}  manual=${brl(manual).padStart(14)}`);
  }
  console.log(`  SALDO TOTAL: lib=${brl(saldoTotalLib)}  manual=${brl(saldoTotalManual)}  ${Math.abs(saldoTotalLib - saldoTotalManual) < 0.005 ? '(bate)' : '(!!DIVERGE)'}`);

  // 2) A RECEBER / A PAGAR / VENCIDAS (pendentes)
  console.log(`\n--- 2) PENDENTES (a receber / a pagar / vencidas) ---`);
  const aReceber = round2(txs.filter(t => t.type === 'income' && t.status === 'pending' && isNotCancelled(t) && !t.crossEntityGroupId).reduce((a, t) => a + (Number(t.amount) || 0), 0));
  const aPagarContas = round2(txs.filter(t => t.type === 'expense' && t.status === 'pending' && !isCardExpense(t) && !t.crossEntityGroupId).reduce((a, t) => a + (Number(t.amount) || 0), 0));
  const faturasAberto = round2(cards.reduce((a, c) => a + computeCardInvoice(c.id, c.closingDay, txs, hoje), 0));
  const vencidas = round2(txs.filter(t => t.status === 'pending' && !isCardExpense(t) && !t.crossEntityGroupId && parseLocalDate(t.date) < inicioHoje).reduce((a, t) => a + (Number(t.amount) || 0), 0));
  console.log(`  A receber (receitas pendentes):      ${brl(aReceber)}`);
  console.log(`  A pagar (contas pendentes não-cartão): ${brl(aPagarContas)}`);
  console.log(`  Faturas de cartão em aberto:          ${brl(faturasAberto)}`);
  console.log(`  A pagar TOTAL (contas + fatura):      ${brl(round2(aPagarContas + faturasAberto))}`);
  console.log(`  VENCIDAS (pendentes com data < hoje): ${brl(vencidas)}`);

  // 3) REALIZADO NO MÊS
  console.log(`\n--- 3) REALIZADO NO MÊS (${hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}) ---`);
  const recebidoMes = round2(txs.filter(t => t.type === 'income' && t.status === 'completed' && !t.crossEntityGroupId && noMes(parseLocalDate(t.date))).reduce((a, t) => a + (Number(t.amount) || 0), 0));
  const pagoMes = round2(txs.filter(t => t.type === 'expense' && t.status === 'completed' && !isCardExpense(t) && !t.crossEntityGroupId && noMes(parseLocalDate(t.date))).reduce((a, t) => a + (Number(t.amount) || 0), 0));
  console.log(`  Já recebido no mês: ${brl(recebidoMes)}`);
  console.log(`  Já pago no mês:     ${brl(pagoMes)}`);
  console.log(`  Resultado do mês:   ${brl(round2(recebidoMes - pagoMes))}`);
  console.log(`  Resultado previsto (se tudo confirmar): ${brl(round2(recebidoMes + aReceber - pagoMes - aPagarContas - faturasAberto))}`);

  // 4) POSSO GASTAR (sobra) — reserva informada é por dispositivo; aqui uso 0.
  console.log(`\n--- 4) POSSO GASTAR / SOBRA (reserva protegida = 0 nesta conferência) ---`);
  const loans = debts.map(d => ({ id: d.id, name: d.name, monthlyPayment: Number(d.monthlyPayment) || 0 }));
  const sp = computeSpendable({ accounts, transactions: txs, cards, loans, reserve: 0, reference: hoje });
  console.log(`  Saldo:                 ${brl(sp.balance)}`);
  console.log(`  − Contas a pagar mês:  ${brl(-sp.billsDueThisMonth)}`);
  console.log(`  − Faturas de cartão:   ${brl(-sp.cardInvoices)}`);
  console.log(`  − Parcelas empréstimo: ${brl(-sp.loanPayments)}`);
  console.log(`  − Gasto variável prev: ${brl(-sp.expectedVariable)}`);
  console.log(`  = POSSO GASTAR:        ${brl(sp.spendable)}  (dias restantes: ${sp.daysLeft})`);

  // 5) DÍVIDAS
  console.log(`\n--- 5) DÍVIDAS (parcelamentos + empréstimos + fatura) ---`);
  const dv = collectDebts(txs, debts, cards, {}, hoje);
  const totalDiv = round2(dv.reduce((a, v) => a + v.balance, 0));
  dv.forEach(v => console.log(`  ${v.source.padEnd(12)} ${v.name.slice(0, 24).padEnd(24)} ${brl(v.balance).padStart(14)}`));
  console.log(`  TOTAL DÍVIDAS: ${brl(totalDiv)}`);

  // 6) CONSOLIDADO PF×PJ (mês)
  console.log(`\n--- 6) CONSOLIDADO DO MÊS (entre entidades) ---`);
  const cons = consolidate(txs, entities as any, hoje);
  console.log(`  Receita consolidada: ${brl(cons.consolidated.income)}`);
  console.log(`  Despesa consolidada: ${brl(cons.consolidated.expense)}`);
  console.log(`  Resultado:           ${brl(cons.consolidated.net)}`);
  console.log(`  Movimento interno:   ${brl(cons.internalFlow)}`);

  console.log(`\n==================== RESUMO ====================`);
  console.log(`  Saldos conferem conta a conta: ${divergencias === 0 ? 'SIM ✓' : `NÃO — ${divergencias} conta(s) divergindo !!`}`);
  console.log(`  Saldo total: ${brl(saldoTotalLib)} | A receber: ${brl(aReceber)} | A pagar: ${brl(round2(aPagarContas + faturasAberto))}`);
  console.log(`  Vencidas: ${brl(vencidas)} | Posso gastar (reserva 0): ${brl(sp.spendable)} | Dívidas: ${brl(totalDiv)}`);
  console.log(`================================================\n`);
  process.exit(0);
}

main().catch(err => { console.error('Erro na auditoria:', err); process.exit(1); });
