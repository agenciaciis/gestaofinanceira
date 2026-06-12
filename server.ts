import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import fs from 'fs';
import axios from 'axios';

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

  app.use(express.json());

  // API Routes
  app.get('/api/health', (req, res) => {
    console.log('Health check requested');
    res.json({ status: 'ok' });
  });

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
    console.log('WhatsApp Webhook received:', JSON.stringify(req.body, null, 2));
    
    const { event, data } = req.body;

    if (event === 'messages.upsert') {
      const message = data.message;
      const remoteJid = data.key.remoteJid;
      const senderNumber = remoteJid.split('@')[0];
      const text = message.conversation || message.extendedTextMessage?.text || '';

      if (!text) return res.sendStatus(200);

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

        const command = text.toLowerCase().trim();
        let responseText = '';

        if (command.startsWith('lançar') || command.startsWith('lancar')) {
          const parts = text.split(' ');
          if (parts.length >= 3) {
            const amount = parseFloat(parts[1].replace(',', '.'));
            const description = parts.slice(2).join(' ');

            if (!isNaN(amount)) {
              await db.collection(`entities/${targetEntity.id}/transactions`).add({
                description,
                amount,
                type: 'expense',
                date: new Date().toISOString().split('T')[0],
                status: 'completed',
                entityId: targetEntity.id,
                categoryId: 'outros',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              });
              responseText = `✅ *Lançamento realizado!*\n💰 Valor: R$ ${amount.toFixed(2)}\n📝 Descrição: ${description}`;
            } else {
              responseText = '❌ Valor inválido. Use: *Lançar [valor] [descrição]*';
            }
          } else {
            responseText = '❌ Formato inválido. Use: *Lançar [valor] [descrição]*';
          }
        } else if (command === 'saldo') {
          const accountsSnapshot = await db.collection(`entities/${targetEntity.id}/bank_accounts`).get();
          let total = 0;
          accountsSnapshot.forEach(doc => {
            total += doc.data().currentBalance || 0;
          });
          responseText = `💰 *Seu saldo total atual é:*\nR$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        } else if (command === 'extrato') {
          const transactionsSnapshot = await db.collection(`entities/${targetEntity.id}/transactions`)
            .orderBy('date', 'desc')
            .limit(5)
            .get();
          
          let list = '📑 *Últimos 5 Lançamentos:*';
          transactionsSnapshot.forEach(doc => {
            const t = doc.data();
            const emoji = t.type === 'income' ? '🟢' : t.type === 'expense' ? '🔴' : '🔵';
            list += `\n${emoji} ${new Date(t.date).toLocaleDateString('pt-BR')} - ${t.description}: R$ ${t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
          });
          responseText = list;
        } else if (command === 'ajuda') {
          responseText = `🤖 *Assistente Financeiro*\n\nComandos disponíveis:\n- *Saldo*: Ver saldo total\n- *Extrato*: Ver últimos 5 lançamentos\n- *Lançar [valor] [descrição]*: Registrar um gasto\n- *Dívidas*: Ver resumo de dívidas`;
        } else if (command === 'dívidas' || command === 'dividas') {
          const debtsSnapshot = await db.collection(`entities/${targetEntity.id}/debts`).get();
          let totalRemaining = 0;
          let list = '';
          debtsSnapshot.forEach(doc => {
            const debt = doc.data();
            totalRemaining += debt.remainingAmount || 0;
            list += `\n- ${debt.name}: R$ ${debt.remainingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
          });
          responseText = list ? `📉 *Resumo de Dívidas*\nTotal Restante: R$ ${totalRemaining.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n${list}` : '✅ Você não possui dívidas registradas.';
        }

        if (responseText) {
          const { apiUrl, apiKey, instanceName } = targetEntity.whatsappConfig;
          await axios.post(`${apiUrl}/message/sendText/${instanceName}`, {
            number: senderNumber,
            text: responseText
          }, {
            headers: { 'apikey': apiKey }
          });
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
