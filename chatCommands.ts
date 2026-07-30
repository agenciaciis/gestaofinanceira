/**
 * Cérebro de comandos do chat financeiro — compartilhado por WhatsApp e Telegram.
 *
 * Antes esta lógica vivia embutida no webhook do WhatsApp em server.ts. Foi
 * extraída para cá para que os dois canais usem exatamente o mesmo comportamento
 * (saldo/extrato/dívidas/ajuda, criar lançamento por texto/foto/IA, apagar e
 * corrigir o último). O ENVIO da resposta continua específico de cada canal.
 */
import { parseFinanceMessage } from './src/lib/whatsappParse';
import { extractTransactionFromText, extractTransactionFromImage, ExtractedTransaction } from './whatsapp-ai';
import { computeBalances } from './src/lib/finance';

export interface ChatEntity {
  id: string;
  ownerUid?: string;
  collaboratorsEmails?: string[];
  [k: string]: any;
}

export interface ChatContext {
  db: FirebaseFirestore.Firestore;
  /** admin.firestore.FieldValue.serverTimestamp (injetado para não acoplar ao admin). */
  serverTimestamp: () => any;
  entity: ChatEntity;
  text: string;
  hasImage: boolean;
  /** Baixa a imagem (base64+mime) quando `hasImage`. Específico do canal. */
  getImageBase64?: () => Promise<{ base64: string; mime: string } | null>;
  /** Identifica o remetente para o "apagar/corrigir último" (ex.: `wa:5511...`, `tg:123`). */
  senderKey: string;
}

// Último lançamento criado por remetente (para "corrigir/apagar último").
const lastTxBySender = new Map<string, { entityId: string; txId: string }>();

const fmt = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const emojiFor = (t: string) => (t === 'income' ? '🟢' : t === 'expense' ? '🔴' : '🔵');

/**
 * Processa uma mensagem e devolve o texto de resposta (vazio = não responder).
 * Faz as leituras/escritas no Firestore via `ctx.db` (Admin SDK).
 */
export async function handleChatCommand(ctx: ChatContext): Promise<string> {
  const { db, entity, text, hasImage, senderKey } = ctx;

  const pickDefaultAccountId = async (): Promise<string | null> => {
    const snap = await db.collection(`entities/${entity.id}/bank_accounts`).get();
    if (snap.empty) return null;
    const accs = snap.docs;
    const corrente = accs.find(d => d.data().type === 'corrente');
    return (corrente || accs[0]).id;
  };

  const createTransaction = async (tx: ExtractedTransaction): Promise<string> => {
    const accountId = await pickDefaultAccountId();
    const ref = await db.collection(`entities/${entity.id}/transactions`).add({
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      date: new Date().toISOString().split('T')[0],
      categoryId: tx.categoryId,
      accountId,
      status: 'completed',
      entityId: entity.id,
      ownerUid: entity.ownerUid,
      collaboratorsEmails: entity.collaboratorsEmails || [],
      source: senderKey.startsWith('tg:') ? 'telegram' : 'whatsapp',
      createdAt: ctx.serverTimestamp(),
    });
    lastTxBySender.set(senderKey, { entityId: entity.id, txId: ref.id });
    return `✅ *Lançamento registrado!*\n${emojiFor(tx.type)} ${tx.type === 'income' ? 'Entrada' : 'Saída'}: ${fmt(tx.amount)}\n📝 ${tx.description}\n_Responda "corrigir último para X" ou "apagar último" se precisar._`;
  };

  // ---------- IMAGEM (foto da nota/cupom) ----------
  if (hasImage) {
    const img = ctx.getImageBase64 ? await ctx.getImageBase64() : null;
    if (img?.base64) {
      const extracted = await extractTransactionFromImage(img.base64, img.mime || 'image/jpeg');
      if (extracted) return createTransaction(extracted);
      return '❌ Não consegui ler a nota. Tente uma foto mais nítida ou me mande em texto (ex.: "gastei 50 no posto").';
    }
    return '❌ Não recebi a imagem. Tente novamente.';
  }

  // ---------- TEXTO ----------
  const intent = parseFinanceMessage(text);

  if (intent?.kind === 'command' && intent.command === 'saldo') {
    const [accSnap, txSnap] = await Promise.all([
      db.collection(`entities/${entity.id}/bank_accounts`).get(),
      db.collection(`entities/${entity.id}/transactions`).get(),
    ]);
    const accounts = accSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    const balances = computeBalances(accounts, transactions);
    const total = Object.values(balances).reduce((a, v) => a + v, 0);
    return `💰 *Saldo total atual:*\n${fmt(total)}`;
  }

  if (intent?.kind === 'command' && intent.command === 'extrato') {
    const snap = await db.collection(`entities/${entity.id}/transactions`).orderBy('date', 'desc').limit(5).get();
    let list = '📑 *Últimos 5 lançamentos:*';
    snap.forEach(doc => {
      const t = doc.data();
      list += `\n${emojiFor(t.type)} ${new Date(t.date).toLocaleDateString('pt-BR')} - ${t.description}: ${fmt(t.amount)}`;
    });
    return list;
  }

  if (intent?.kind === 'command' && intent.command === 'dividas') {
    const snap = await db.collection(`entities/${entity.id}/debts`).get();
    let totalRemaining = 0; let list = '';
    snap.forEach(doc => {
      const debt = doc.data();
      totalRemaining += debt.remainingAmount || 0;
      list += `\n- ${debt.name}: ${fmt(debt.remainingAmount || 0)}`;
    });
    return list ? `📉 *Resumo de Dívidas*\nTotal restante: ${fmt(totalRemaining)}${list}` : '✅ Você não possui dívidas registradas.';
  }

  if (intent?.kind === 'command' && intent.command === 'ajuda') {
    return `🤖 *Assistente Financeiro CIIS*\n\nÉ só falar naturalmente! Exemplos:\n• "gastei 50 no posto"\n• "recebi 2000 do cliente"\n• 📷 _mande a foto da nota_ que eu lanço sozinho\n\nComandos:\n• *saldo* — saldo total\n• *extrato* — últimos lançamentos\n• *dívidas* — resumo de dívidas\n• *apagar último* / *corrigir último para X*`;
  }

  if (intent?.kind === 'delete_last') {
    const last = lastTxBySender.get(senderKey);
    if (last) {
      await db.doc(`entities/${last.entityId}/transactions/${last.txId}`).delete();
      lastTxBySender.delete(senderKey);
      return '🗑️ Último lançamento apagado com sucesso.';
    }
    return 'Não encontrei um lançamento recente para apagar.';
  }

  if (intent?.kind === 'edit_last') {
    const last = lastTxBySender.get(senderKey);
    if (last) {
      await db.doc(`entities/${last.entityId}/transactions/${last.txId}`).update({ amount: intent.amount });
      return `✏️ Valor do último lançamento corrigido para ${fmt(intent.amount)}.`;
    }
    return 'Não encontrei um lançamento recente para corrigir.';
  }

  if (intent?.kind === 'transaction') {
    return createTransaction(intent as unknown as ExtractedTransaction);
  }

  // Texto ambíguo: tenta a IA.
  const extracted = await extractTransactionFromText(text);
  if (extracted && extracted.amount > 0) {
    return createTransaction(extracted);
  }
  return '🤔 Não entendi. Tente algo como *"gastei 50 no posto"*, mande a *foto da nota*, ou digite *ajuda*.';
}
