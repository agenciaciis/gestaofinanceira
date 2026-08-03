/**
 * Integração com o Telegram: webhook (comandos), vínculo do chat ao usuário e
 * disparo dos alertas. O token do bot mora só no servidor (TELEGRAM_BOT_TOKEN).
 *
 * Como o WhatsApp, as operações de Firestore exigem credencial Admin — só
 * funcionam DEPLOYADO (na VPS). Local sem credencial, os endpoints existem mas
 * as leituras/escritas falham (esperado).
 */
import axios from 'axios';
import type { Express, NextFunction, Request, Response } from 'express';
import type admin from 'firebase-admin';
import { handleChatCommand } from './chatCommands';
import { selectEntityAlerts, buildWeeklySummary, filterUnsent, AlertItem, AlertContext } from './src/lib/telegramAlerts';

const api = (path: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}`;

function hasToken(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  if (!hasToken()) return;
  try {
    await axios.post(api('sendMessage'), { chat_id: chatId, text });
  } catch (e: any) {
    console.error('Telegram sendMessage falhou:', e?.message);
  }
}

let cachedBotUsername: string | null = null;
async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername || !hasToken()) return cachedBotUsername;
  try {
    const r = await axios.get(api('getMe'));
    cachedBotUsername = r.data?.result?.username || null;
  } catch (e: any) {
    console.error('Telegram getMe falhou:', e?.message);
  }
  return cachedBotUsername;
}

/**
 * Registra o webhook no Telegram apontando para APP_URL/api/telegram/webhook.
 * Chamado no startup — sem isso o Telegram não entrega as mensagens ao servidor.
 * Requer APP_URL público e HTTPS (o Telegram recusa http e localhost).
 */
export async function setTelegramWebhook(): Promise<{ ok: boolean; detail?: string }> {
  if (!hasToken()) return { ok: false, detail: 'TELEGRAM_BOT_TOKEN ausente' };
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (!base) return { ok: false, detail: 'APP_URL ausente' };
  if (!base.startsWith('https://')) return { ok: false, detail: `APP_URL precisa ser https (recebi "${base}")` };
  const url = `${base}/api/telegram/webhook`;
  try {
    const body: Record<string, unknown> = { url, allowed_updates: ['message', 'edited_message'] };
    // Se houver segredo, o Telegram passa a mandá-lo no header — o webhook confere.
    if (process.env.TELEGRAM_WEBHOOK_SECRET) body.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
    const r = await axios.post(api('setWebhook'), body);
    return { ok: !!r.data?.ok, detail: r.data?.description };
  } catch (e: any) {
    return { ok: false, detail: e?.response?.data?.description || e?.message };
  }
}

interface ParsedUpdate { chatId: string; text?: string; photoFileId?: string; startPayload?: string; }
function parseUpdate(body: any): ParsedUpdate | null {
  const msg = body?.message || body?.edited_message;
  if (!msg?.chat?.id) return null;
  const chatId = String(msg.chat.id);
  const raw: string = (msg.text || msg.caption || '').slice(0, 500);
  const out: ParsedUpdate = { chatId };
  if (Array.isArray(msg.photo) && msg.photo.length) out.photoFileId = msg.photo[msg.photo.length - 1].file_id;
  if (raw.startsWith('/start')) out.startPayload = raw.replace('/start', '').trim();
  else out.text = raw;
  return out;
}

async function fetchPhoto(fileId: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const info = await axios.get(api('getFile'), { params: { file_id: fileId } });
    const filePath = info.data?.result?.file_path;
    if (!filePath) return null;
    const bin = await axios.get(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`, { responseType: 'arraybuffer' });
    return { base64: Buffer.from(bin.data).toString('base64'), mime: filePath.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  } catch (e: any) {
    console.error('Telegram getFile falhou:', e?.message);
    return null;
  }
}

/** Dispara os alertas de todos os chats vinculados. `weekly` inclui o resumo. */
export async function runTelegramAlerts(db: FirebaseFirestore.Firestore, weekly: boolean): Promise<{ sent: number }> {
  let sent = 0;
  const links = await db.collection('telegram_links').get();
  for (const linkDoc of links.docs) {
    const link = linkDoc.data() as any;
    const uid = link.uid;
    if (!uid) continue;
    const sentKeys: string[] = Array.isArray(link.sentKeys) ? link.sentKeys : [];

    const ents = await db.collection('entities').where('ownerUid', '==', uid).get();
    const alerts: AlertItem[] = [];
    for (const eDoc of ents.docs) {
      const entity = { id: eDoc.id, ...eDoc.data() } as any;
      const [accSnap, txSnap, budgetDoc] = await Promise.all([
        db.collection(`entities/${entity.id}/bank_accounts`).get(),
        db.collection(`entities/${entity.id}/transactions`).get(),
        db.doc(`entities/${entity.id}/config/budgets`).get(),
      ]);
      const ctx: AlertContext = {
        entityName: entity.name || '',
        entityType: entity.type === 'PJ' ? 'PJ' : 'PF',
        accounts: accSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[],
        transactions: txSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[],
        budgets: budgetDoc.exists ? (budgetDoc.data() as any) : {},
        today: new Date(),
        dueDays: typeof link.dueDays === 'number' ? link.dueDays : 2,
        balanceFloor: typeof link.balanceFloor === 'number' ? link.balanceFloor : 0,
      };
      alerts.push(...selectEntityAlerts(ctx));
      if (weekly) alerts.push(buildWeeklySummary(ctx));
    }

    const toSend = filterUnsent(alerts, sentKeys);
    for (const a of toSend) { await sendTelegramMessage(linkDoc.id, a.text); sent++; }
    if (toSend.length) {
      const merged = [...sentKeys, ...toSend.map(a => a.key)].slice(-500);
      await linkDoc.ref.set({ sentKeys: merged }, { merge: true });
    }
  }
  return { sent };
}

/** Hora e dia-da-semana no fuso de São Paulo (para o agendador). */
function spNow(): { hour: number; weekday: number; ymd: string } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t: string) => f.find(p => p.type === t)?.value || '';
  const wmap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number(get('hour')),
    weekday: wmap[get('weekday')] ?? 0,
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export function registerTelegramRoutes(app: Express, firebaseAdmin: typeof admin, db: FirebaseFirestore.Firestore | null) {
  // Endpoint autenticado: gera um código de vínculo e devolve o deep link.
  app.post('/api/telegram/link-code', async (req: Request, res: Response) => {
    if (!db) return res.status(500).json({ error: 'DB indisponível' });
    if (!hasToken()) return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN não configurado no servidor.' });
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    let uid: string;
    try { uid = (await firebaseAdmin.auth().verifyIdToken(token)).uid; }
    catch { return res.status(401).json({ error: 'Sessão inválida.' }); }

    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    await db.collection('telegram_codes').doc(code).set({ uid, createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp() });
    const username = await getBotUsername();
    res.json({ code, botUsername: username, deepLink: username ? `https://t.me/${username}?start=${code}` : null });
  });

  // Webhook do Telegram.
  app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
    if (!db) return res.sendStatus(500);
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.sendStatus(401);

    const upd = parseUpdate(req.body);
    if (!upd) return res.sendStatus(200);
    try {
      // 1. Vínculo via /start <code>
      if (upd.startPayload !== undefined) {
        const code = upd.startPayload;
        let reply = 'Envie o /start pelo botão das *Configurações → Telegram* para vincular sua conta.';
        if (code) {
          const codeDoc = await db.collection('telegram_codes').doc(code).get();
          const uid = codeDoc.exists ? (codeDoc.data() as any).uid : null;
          if (uid) {
            await db.collection('telegram_links').doc(upd.chatId).set({ uid, linkedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            await codeDoc.ref.delete();
            reply = '✅ Conta vinculada! A partir de agora eu te aviso por aqui e aceito seus comandos (ex.: "saldo", "gastei 50 no posto").';
          } else {
            reply = '❌ Código inválido ou expirado. Gere um novo nas Configurações → Telegram.';
          }
        }
        await sendTelegramMessage(upd.chatId, reply);
        return res.sendStatus(200);
      }

      // 2. Comando/lançamento — precisa de chat vinculado.
      const linkDoc = await db.collection('telegram_links').doc(upd.chatId).get();
      const link = linkDoc.exists ? (linkDoc.data() as any) : null;
      if (!link?.uid) {
        await sendTelegramMessage(upd.chatId, 'Seu chat ainda não está vinculado. Abra as *Configurações → Telegram* no app e toque em "Conectar".');
        return res.sendStatus(200);
      }

      // Entidade alvo: a padrão do usuário, ou a primeira dele.
      const ents = await db.collection('entities').where('ownerUid', '==', link.uid).get();
      if (ents.empty) { await sendTelegramMessage(upd.chatId, 'Não encontrei nenhuma entidade na sua conta.'); return res.sendStatus(200); }
      const entDoc = ents.docs.find(d => d.id === link.defaultEntityId) || ents.docs[0];
      const entity = { id: entDoc.id, ...entDoc.data() } as any;

      const responseText = await handleChatCommand({
        db,
        serverTimestamp: () => firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        entity,
        text: upd.text || '',
        hasImage: !!upd.photoFileId,
        getImageBase64: upd.photoFileId ? () => fetchPhoto(upd.photoFileId!) : undefined,
        senderKey: `tg:${upd.chatId}`,
      });
      if (responseText) await sendTelegramMessage(upd.chatId, responseText);
    } catch (error) {
      console.error('Erro no webhook do Telegram:', error);
    }
    return res.sendStatus(200);
  });

  // Disparo manual/cron dos alertas (protegido por token).
  app.post('/api/telegram/run-alerts', async (req: Request, res: Response) => {
    if (!db) return res.status(500).json({ error: 'DB indisponível' });
    const expected = process.env.ALERTS_CRON_TOKEN;
    const provided = (req.headers['x-alerts-token'] as string) || (req.query.token as string) || '';
    if (expected && provided !== expected) return res.sendStatus(401);
    const weekly = req.query.weekly === '1' || spNow().weekday === 1;
    const result = await runTelegramAlerts(db, weekly);
    res.json(result);
  });

  // Agendador in-process: às 08:00 (São Paulo) dispara os alertas do dia;
  // na segunda inclui o resumo semanal. Guarda a última data para não repetir.
  if (db && hasToken()) {
    // Auto-registra o webhook no Telegram (sem isso, nada chega ao servidor).
    setTelegramWebhook().then(r => {
      if (r.ok) console.log(`Telegram: webhook registrado em ${process.env.APP_URL}/api/telegram/webhook`);
      else console.warn(`Telegram: webhook NÃO registrado (${r.detail}). Defina APP_URL público https no .env do servidor.`);
    });

    let lastRunYmd = '';
    const tick = async () => {
      try {
        const { hour, weekday, ymd } = spNow();
        if (hour === 8 && ymd !== lastRunYmd) {
          lastRunYmd = ymd;
          const r = await runTelegramAlerts(db, weekday === 1);
          console.log(`Telegram: alertas do dia disparados (${r.sent} mensagens).`);
        }
      } catch (e: any) {
        console.error('Agendador de alertas falhou:', e?.message);
      }
    };
    setInterval(tick, 30 * 60 * 1000); // a cada 30 min
    console.log('Telegram: agendador de alertas ativo (08:00 America/Sao_Paulo).');
  }
}
