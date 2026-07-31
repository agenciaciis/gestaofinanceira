/**
 * Remove TODOS os dados de simulação (marcados com seed:true) criados por seed.ts.
 * Uso:  npm run seed:clean
 * Seguro: só apaga entidades com seed===true e suas subcoleções.
 */
import 'dotenv/config'; // carrega SEED_EMAIL/SEED_PASSWORD do .env
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, collection, getDocs, query, where, writeBatch, doc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const EMAIL = process.env.SEED_EMAIL ?? '';
const PASSWORD = process.env.SEED_PASSWORD ?? '';
if (!EMAIL || !PASSWORD) {
  console.error('❌ Defina SEED_EMAIL e SEED_PASSWORD no ambiente. Ex.: SEED_EMAIL=voce@dominio.com SEED_PASSWORD=suaSenha npm run seed:clean');
  process.exit(1);
}

const app = initializeApp(firebaseConfig as any);
const auth = getAuth(app);
const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

const SUBCOLLECTIONS = [
  'bank_accounts', 'credit_cards', 'transactions', 'debts',
  'clients', 'suppliers', 'services', 'plans', 'quotes', 'config',
];

async function deleteSub(entityId: string, sub: string): Promise<number> {
  const snap = await getDocs(collection(db, `entities/${entityId}/${sub}`));
  let count = 0;
  const refs = snap.docs.map(d => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach(r => { batch.delete(r); count++; });
    await batch.commit();
  }
  return count;
}

async function main() {
  console.log('🔑 Autenticando...');
  const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
  const uid = cred.user.uid;
  console.log('   login OK:', EMAIL);

  console.log('🔎 Procurando entidades de simulação (seed:true)...');
  const entSnap = await getDocs(query(collection(db, 'entities'), where('ownerUid', '==', uid), where('seed', '==', true)));
  if (entSnap.empty) {
    console.log('   Nenhuma entidade de simulação encontrada. Nada a limpar.');
    process.exit(0);
  }

  let totalDocs = 0;
  for (const ent of entSnap.docs) {
    console.log(`🗑️  Limpando "${ent.data().name}" (${ent.id})...`);
    for (const sub of SUBCOLLECTIONS) {
      const n = await deleteSub(ent.id, sub);
      if (n) console.log(`     - ${sub}: ${n}`);
      totalDocs += n;
    }
    // apaga a entidade
    const batch = writeBatch(db);
    batch.delete(doc(db, 'entities', ent.id));
    await batch.commit();
    totalDocs += 1;
  }

  console.log(`\n✅ Limpeza concluída. ${totalDocs} documentos removidos.`);
  process.exit(0);
}

main().catch((err) => { console.error('Erro na limpeza:', err); process.exit(1); });
