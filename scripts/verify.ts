/** Verificação read-only dos dados de simulação. Uso: npm run seed:verify */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { computeBalances } from '../src/lib/finance';

const EMAIL = process.env.SEED_EMAIL || 'lucas@agenciaciis.com.br';
const PASSWORD = process.env.SEED_PASSWORD || '136479';
const app = initializeApp(firebaseConfig as any);
const auth = getAuth(app);
const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const load = async (entId: string, sub: string) =>
  (await getDocs(collection(db, `entities/${entId}/${sub}`))).docs.map(d => ({ id: d.id, ...d.data() } as any));

async function main() {
  const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
  const ents = (await getDocs(query(collection(db, 'entities'), where('ownerUid', '==', cred.user.uid), where('seed', '==', true)))).docs;
  console.log(`\nEntidades de simulação: ${ents.length}\n`);

  for (const e of ents) {
    const id = e.id; const name = e.data().name;
    const [accounts, tx, cards, clients, debts, suppliers, services] = await Promise.all([
      load(id, 'bank_accounts'), load(id, 'transactions'), load(id, 'credit_cards'),
      load(id, 'clients'), load(id, 'debts'), load(id, 'suppliers'), load(id, 'services'),
    ]);
    const balances = computeBalances(accounts as any, tx as any);
    const total = Object.values(balances).reduce((a, v) => a + v, 0);
    const byStatus = tx.reduce((acc: any, t: any) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});
    const income = tx.filter((t: any) => t.type === 'income' && t.status === 'completed').reduce((a: number, t: any) => a + t.amount, 0);
    const expense = tx.filter((t: any) => t.type === 'expense' && t.status === 'completed').reduce((a: number, t: any) => a + t.amount, 0);
    const nanCount = tx.filter((t: any) => !Number.isFinite(t.amount)).length;

    console.log(`📦 ${name}`);
    console.log(`   contas: ${accounts.length} | cartões: ${cards.length} | clientes: ${clients.length} | fornecedores: ${suppliers.length} | serviços: ${services.length} | dívidas: ${debts.length}`);
    console.log(`   transações: ${tx.length}  (${JSON.stringify(byStatus)})`);
    console.log(`   receita realizada: ${brl(income)} | despesa realizada: ${brl(expense)}`);
    console.log(`   SALDO CALCULADO (todas as contas): ${brl(total)}`);
    console.log(`   valores NaN: ${nanCount} ${nanCount === 0 ? '✅' : '❌'}\n`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
