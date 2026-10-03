/**
 * Reset de MOVIMENTAÇÕES mantendo cadastros, contas e cartões (zerados).
 *
 * Apaga, nas entidades do usuário dono (OWNER_EMAIL):
 *   - transactions, debts, quotes   (coleções)
 *   - config/goals, config/budgets, config/sales_goal  (docs de metas/caixinhas)
 * E zera cada bank_accounts (initialBalance=0, currentBalance=0).
 *
 * MANTÉM: credit_cards, bank_accounts (zerados), clients, suppliers, services,
 * plans, products e a própria entidade.
 *
 * SEGURANÇA:
 *   - SEMPRE grava um backup JSON completo das entidades afetadas ANTES de tocar
 *     em qualquer coisa (pasta ./backups).
 *   - Só APAGA se rodar com CONFIRM=1. Sem isso, é dry-run (backup + inventário).
 *
 * Uso no servidor (/var/www/finanflow):
 *   # 1) Ver inventário + gerar backup (NÃO apaga):
 *   OWNER_EMAIL='lucas@agenciaciis.com.br' npx tsx scripts/reset-movimentacoes.ts
 *   # 2) Executar de fato (apaga):
 *   OWNER_EMAIL='lucas@agenciaciis.com.br' CONFIRM=1 npx tsx scripts/reset-movimentacoes.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json';

const OWNER_EMAIL = process.env.OWNER_EMAIL ?? '';
const EXECUTE = process.env.CONFIRM === '1';
const PROJECT_ID = (firebaseConfig as any).projectId as string;
const DB_ID = (firebaseConfig as any).firestoreDatabaseId as string;

// Coleções apagadas por inteiro.
const WIPE_COLLECTIONS = ['transactions', 'debts', 'quotes'];
// Docs de config (metas/caixinhas/meta de vendas) apagados.
const WIPE_CONFIG_DOCS = ['goals', 'budgets', 'sales_goal'];
// Tudo que entra no backup (afetado OU preservado — é restore point completo).
const BACKUP_COLLECTIONS = [
  'bank_accounts', 'credit_cards', 'transactions', 'debts',
  'clients', 'suppliers', 'services', 'plans', 'products', 'quotes', 'config',
];

function initCredential() {
  // Preferência: serviceAccount.json na raiz; senão GOOGLE_APPLICATION_CREDENTIALS.
  const local = path.join(process.cwd(), 'serviceAccount.json');
  const alt = path.join(process.cwd(), 'service-account.json');
  if (fs.existsSync(local)) return cert(JSON.parse(fs.readFileSync(local, 'utf8')));
  if (fs.existsSync(alt)) return cert(JSON.parse(fs.readFileSync(alt, 'utf8')));
  return applicationDefault(); // usa GOOGLE_APPLICATION_CREDENTIALS
}

async function main() {
  if (!OWNER_EMAIL) {
    console.error('❌ Defina OWNER_EMAIL. Ex.: OWNER_EMAIL="voce@dominio.com" npx tsx scripts/reset-movimentacoes.ts');
    process.exit(1);
  }

  const app = initializeApp({ credential: initCredential(), projectId: PROJECT_ID });
  const db = getFirestore(app, DB_ID);
  const auth = getAuth(app);

  console.log(`\n🔌 Projeto: ${PROJECT_ID}  |  Banco: ${DB_ID}`);
  console.log(`👤 Dono alvo: ${OWNER_EMAIL}`);
  console.log(EXECUTE ? '⚠️  MODO EXECUÇÃO (vai APAGAR)\n' : '🧪 MODO DRY-RUN (só backup + inventário, NÃO apaga)\n');

  // Resolve o uid do dono.
  let uid: string;
  try {
    uid = (await auth.getUserByEmail(OWNER_EMAIL)).uid;
  } catch {
    console.error(`❌ Não achei usuário com e-mail ${OWNER_EMAIL}.`);
    process.exit(1);
  }
  console.log(`   uid: ${uid}`);

  // Lista TODAS as entidades (visão geral) e filtra as do dono.
  const allEnt = await db.collection('entities').get();
  console.log(`\n📋 Entidades no banco (${allEnt.size} no total):`);
  for (const e of allEnt.docs) {
    const d = e.data();
    const mine = d.ownerUid === uid ? '  <== SUA' : '';
    console.log(`   - ${d.name} (${e.id}) owner=${d.ownerUid} seed=${d.seed === true}${mine}`);
  }

  const mine = allEnt.docs.filter(e => e.data().ownerUid === uid);
  if (mine.length === 0) {
    console.log('\n   Nenhuma entidade sua encontrada. Nada a fazer.');
    process.exit(0);
  }

  // ---------- BACKUP (sempre) ----------
  const backup: any = { takenAt: new Date().toISOString(), ownerEmail: OWNER_EMAIL, uid, entities: [] };
  for (const ent of mine) {
    const entDump: any = { id: ent.id, data: ent.data(), subcollections: {} };
    for (const sub of BACKUP_COLLECTIONS) {
      const snap = await db.collection(`entities/${ent.id}/${sub}`).get();
      entDump.subcollections[sub] = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    }
    backup.entities.push(entDump);
  }
  const dir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `reset-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\n💾 Backup salvo: ${file}`);

  // ---------- INVENTÁRIO ----------
  console.log('\n📊 Inventário do que será afetado:');
  for (const ent of mine) {
    const sub = backup.entities.find((x: any) => x.id === ent.id).subcollections;
    const nTx = sub.transactions.length, nDebt = sub.debts.length, nQuote = sub.quotes.length;
    const nAcc = sub.bank_accounts.length, nCard = sub.credit_cards.length;
    console.log(`\n   • ${ent.data().name} (${ent.id})`);
    console.log(`     APAGAR → transações: ${nTx} | dívidas: ${nDebt} | orçamentos: ${nQuote} | metas/caixinhas: ${sub.config.filter((c: any) => WIPE_CONFIG_DOCS.includes(c.id)).length} docs`);
    console.log(`     ZERAR  → contas bancárias: ${nAcc}`);
    console.log(`     MANTER → cartões: ${nCard} | clientes: ${sub.clients.length} | fornecedores: ${sub.suppliers.length} | serviços: ${sub.services.length} | produtos: ${sub.products.length}`);
  }

  if (!EXECUTE) {
    console.log('\n🧪 DRY-RUN concluído. NADA foi apagado. Backup acima está salvo.');
    console.log('   Para executar de fato: rode de novo com  CONFIRM=1  na frente.');
    process.exit(0);
  }

  // ---------- EXECUÇÃO ----------
  let deleted = 0, zeroed = 0;
  for (const ent of mine) {
    console.log(`\n🗑️  ${ent.data().name} (${ent.id})`);
    for (const col of WIPE_COLLECTIONS) {
      const snap = await db.collection(`entities/${ent.id}/${col}`).get();
      const refs = snap.docs.map(d => d.ref);
      for (let i = 0; i < refs.length; i += 400) {
        const batch = db.batch();
        refs.slice(i, i + 400).forEach(r => { batch.delete(r); deleted++; });
        await batch.commit();
      }
      if (snap.size) console.log(`     - ${col}: ${snap.size} apagados`);
    }
    for (const cfg of WIPE_CONFIG_DOCS) {
      const ref = db.doc(`entities/${ent.id}/config/${cfg}`);
      if ((await ref.get()).exists) { await ref.delete(); deleted++; console.log(`     - config/${cfg}: apagado`); }
    }
    const accs = await db.collection(`entities/${ent.id}/bank_accounts`).get();
    for (const a of accs.docs) {
      await a.ref.update({ initialBalance: 0, currentBalance: 0 });
      zeroed++;
    }
    if (accs.size) console.log(`     - contas zeradas: ${accs.size}`);
  }

  console.log(`\n✅ Pronto. ${deleted} documentos apagados, ${zeroed} contas zeradas.`);
  console.log(`   Backup para restaurar, se precisar: ${file}`);
  process.exit(0);
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });
