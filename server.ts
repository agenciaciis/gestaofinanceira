import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import fs from 'fs';
import axios from 'axios';
import { parseFinanceMessage } from './src/lib/whatsappParse';
import { extractTransactionFromText, extractTransactionFromImage, ExtractedTransaction } from './whatsapp-ai';
import { computeBalances } from './src/lib/finance';
import { registerAiRoutes } from './ai-routes';

// Guarda o último lançamento criado por número (para "corrigir/apagar último").
const lastTxBySender = new Map<string, { entityId: string; txId: string }>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
    console.log('Firebase Admin initialized successfully from file');
  } else if (process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log('Firebase Admin initialized successfully from environment variables');
  } else {
    console.warn('Firebase configuration not found (neither file nor environment variables)');
  }
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error);
}

const getDb = () => {
  try {
    // Note: To use a specific database ID in Firebase Admin, 
    // it's best to set the FIRESTORE_DATABASE environment variable.
    return admin.firestore();
  } catch (error) {
    console.error('Failed to get Firestore instance:', error);
    return null;
  }
};

const db = getDb();

async function startServer() {
  console.log('Starting server...');
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Limite alto o bastante para o upload de extrato em PDF/imagem (base64).
  app.use(express.json({ limit: '25mb' }));

  // API Routes
  app.get('/api/health', (req, res) => {
    console.log('Health check requested');
    res.json({ status: 'ok' });
  });

  // Endpoints de IA (a chave do Gemini fica só aqui, nunca no navegador).
  registerAiRoutes(app, admin);

  // WhatsApp Status Proxy
  app.get('/api/whatsapp/status/:entityId', async (req, res) => {
    if (!db) return res.status(500).json({ error: 'Database not initialized' });
    const { entityId } = req.params;
    try {
      const entityDoc = await db.collection('entities').doc(entityId).get();
      const entity = entityDoc.data();
      
      if (!entity?.whatsappConfig?.enabled) {
        return res.json({ status: 'disabled' });
      }

      const { apiUrl, apiKey, instanceName } = entity.whatsappConfig;
      const response = await axios.get(`${apiUrl}/instance/connectionState/${instanceName}`, {
        headers: { 'apikey': apiKey }
      });
      
      res.json(response.data);
    } catch (error: any) {
      console.error('Error checking WhatsApp status:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // WhatsApp Webhook
  app.post('/api/whatsapp/webhook', async (req, res) => {
    if (!db) return res.sendStatus(500);

    // Segredo compartilhado opcional: se WHATSAPP_WEBHOOK_TOKEN estiver definido,
    // exige o token (header x-webhook-token ou ?token=) para aceitar o webhook.
    const expectedToken = process.env.WHATSAPP_WEBHOOK_TOKEN;
    if (expectedToken) {
      const provided = (req.headers['x-webhook-token'] as string) || (req.query.token as string) || '';
      if (provided !== expectedToken) {
        console.warn('WhatsApp Webhook: token inválido, requisição rejeitada.');
        return res.sendStatus(401);
      }
    }

    // Validação defensiva do payload (evita crash/abuso com corpo malformado).
    const body = req.body || {};
    const event = body.event;
    const data = body.data;
    if (event !== 'messages.upsert') return res.sendStatus(200);
    if (!data || !data.key || typeof data.key.remoteJid !== 'string' || !data.message) {
      return res.status(400).json({ error: 'Payload inválido' });
    }

    {
      const message = data.message || {};
      const remoteJid = data.key.remoteJid;
      const senderNumber = remoteJid.split('@')[0];
      const rawText = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || '';
      const text = typeof rawText === 'string' ? rawText.slice(0, 500) : '';
      const hasImage = !!message.imageMessage;

      if (!senderNumber) return res.sendStatus(200);
      if (!text && !hasImage) return res.sendStatus(200);

      // responde no fim, fora do try, garantindo 200 sempre
      let responseText = '';
      try {
        const entitiesSnapshot = await db.collection('entities').get();
        let targetEntity: any = null;
        for (const doc of entitiesSnapshot.docs) {
          const entity = doc.data();
          if (entity.whatsappConfig?.enabled && entity.whatsappConfig?.phoneNumber === senderNumber) {
            targetEntity = { id: doc.id, ...entity };
            break;
          }
        }
        if (!targetEntity) return res.sendStatus(200);

        const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const emojiFor = (t: string) => (t === 'income' ? '🟢' : t === 'expense' ? '🔴' : '🔵');

        const pickDefaultAccountId = async (): Promise<string | null> => {
          const snap = await db!.collection(`entities/${targetEntity.id}/bank_accounts`).get();
          if (snap.empty) return null;
          const accs = snap.docs;
          const corrente = accs.find(d => d.data().type === 'corrente');
          return (corrente || accs[0]).id;
        };

        const createTransaction = async (tx: ExtractedTransaction, origem: string) => {
          const accountId = await pickDefaultAccountId();
          const ref = await db!.collection(`entities/${targetEntity.id}/transactions`).add({
            description: tx.description,
            amount: tx.amount,
            type: tx.type,
            date: new Date().toISOString().split('T')[0],
            categoryId: tx.categoryId,
            accountId: accountId,
            status: 'completed',
            entityId: targetEntity.id,
            ownerUid: targetEntity.ownerUid,
            collaboratorsEmails: targetEntity.collaboratorsEmails || [],
            source: 'whatsapp',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          lastTxBySender.set(senderNumber, { entityId: targetEntity.id, txId: ref.id });
          return `✅ *Lançamento registrado!*\n${emojiFor(tx.type)} ${tx.type === 'income' ? 'Entrada' : 'Saída'}: ${fmt(tx.amount)}\n📝 ${tx.description}\n_Responda "corrigir último para X" ou "apagar último" se precisar._`;
        };

        // ---------- IMAGEM (foto da nota/cupom) ----------
        if (hasImage) {
          let base64: string = data.message?.base64 || message.imageMessage?.base64 || '';
          if (!base64) {
            // Evolution API: baixa o media em base64
            try {
              const { apiUrl, apiKey, instanceName } = targetEntity.whatsappConfig;
              const media = await axios.post(
                `${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
                { message: { key: data.key } },
                { headers: { apikey: apiKey } }
              );
              base64 = media.data?.base64 || media.data?.media || '';
            } catch (e: any) {
              console.error('Erro ao baixar mídia do WhatsApp:', e.message);
            }
          }
          if (base64) {
            const mime = message.imageMessage?.mimetype || 'image/jpeg';
            const extracted = await extractTransactionFromImage(base64, mime);
            if (extracted) responseText = await createTransaction(extracted, 'imagem');
            else responseText = '❌ Não consegui ler a nota. Tente uma foto mais nítida ou me mande em texto (ex.: "gastei 50 no posto").';
          } else {
            responseText = '❌ Não recebi a imagem. Tente novamente.';
          }
        } else {
          // ---------- TEXTO ----------
          const intent = parseFinanceMessage(text);

          if (intent?.kind === 'command' && intent.command === 'saldo') {
            const [accSnap, txSnap] = await Promise.all([
              db.collection(`entities/${targetEntity.id}/bank_accounts`).get(),
              db.collection(`entities/${targetEntity.id}/transactions`).get(),
            ]);
            const accounts = accSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
            const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
            const balances = computeBalances(accounts, transactions);
            const total = Object.values(balances).reduce((a, v) => a + v, 0);
            responseText = `💰 *Saldo total atual:*\n${fmt(total)}`;
          } else if (intent?.kind === 'command' && intent.command === 'extrato') {
            const snap = await db.collection(`entities/${targetEntity.id}/transactions`).orderBy('date', 'desc').limit(5).get();
            let list = '📑 *Últimos 5 lançamentos:*';
            snap.forEach(doc => {
              const t = doc.data();
              list += `\n${emojiFor(t.type)} ${new Date(t.date).toLocaleDateString('pt-BR')} - ${t.description}: ${fmt(t.amount)}`;
            });
            responseText = list;
          } else if (intent?.kind === 'command' && intent.command === 'dividas') {
            const snap = await db.collection(`entities/${targetEntity.id}/debts`).get();
            let totalRemaining = 0; let list = '';
            snap.forEach(doc => {
              const debt = doc.data();
              totalRemaining += debt.remainingAmount || 0;
              list += `\n- ${debt.name}: ${fmt(debt.remainingAmount || 0)}`;
            });
            responseText = list ? `📉 *Resumo de Dívidas*\nTotal restante: ${fmt(totalRemaining)}${list}` : '✅ Você não possui dívidas registradas.';
          } else if (intent?.kind === 'command' && intent.command === 'ajuda') {
            responseText = `🤖 *Assistente Financeiro CIIS*\n\nÉ só falar naturalmente! Exemplos:\n• "gastei 50 no posto"\n• "recebi 2000 do cliente"\n• 📷 _mande a foto da nota_ que eu lanço sozinho\n\nComandos:\n• *saldo* — saldo total\n• *extrato* — últimos lançamentos\n• *dívidas* — resumo de dívidas\n• *apagar último* / *corrigir último para X*`;
          } else if (intent?.kind === 'delete_last') {
            const last = lastTxBySender.get(senderNumber);
            if (last) {
              await db.doc(`entities/${last.entityId}/transactions/${last.txId}`).delete();
              lastTxBySender.delete(senderNumber);
              responseText = '🗑️ Último lançamento apagado com sucesso.';
            } else {
              responseText = 'Não encontrei um lançamento recente para apagar.';
            }
          } else if (intent?.kind === 'edit_last') {
            const last = lastTxBySender.get(senderNumber);
            if (last) {
              await db.doc(`entities/${last.entityId}/transactions/${last.txId}`).update({ amount: intent.amount });
              responseText = `✏️ Valor do último lançamento corrigido para ${fmt(intent.amount)}.`;
            } else {
              responseText = 'Não encontrei um lançamento recente para corrigir.';
            }
          } else if (intent?.kind === 'transaction') {
            responseText = await createTransaction(intent, 'texto');
          } else {
            // Texto ambíguo: tenta a IA
            const extracted = await extractTransactionFromText(text);
            if (extracted && extracted.amount > 0) {
              responseText = await createTransaction(extracted, 'ia-texto');
            } else {
              responseText = '🤔 Não entendi. Tente algo como *"gastei 50 no posto"*, mande a *foto da nota*, ou digite *ajuda*.';
            }
          }
        }

        if (responseText) {
          const { apiUrl, apiKey, instanceName } = targetEntity.whatsappConfig;
          await axios.post(
            `${apiUrl}/message/sendText/${instanceName}`,
            { number: senderNumber, text: responseText },
            { headers: { apikey: apiKey } }
          );
        }
      } catch (error) {
        console.error('Error processing WhatsApp message:', error);
      }
    }

    res.sendStatus(200);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    console.log('Initializing Vite in development mode...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite middleware initialized');
  } else {
    console.log('Serving static files in production mode...');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
