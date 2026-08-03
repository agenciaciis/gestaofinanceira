/**
 * Chaves de integração (OpenAI, Telegram) geridas pela tela Ajustes → Integrações.
 *
 * Guardadas em `server_config/integrations` (Firestore), lidas SÓ pelo servidor
 * via Admin. O navegador nunca recebe o valor cheio — só um status mascarado
 * (set + últimos 4 dígitos). A regra do Firestore nega o acesso do cliente.
 *
 * Estratégia: no boot (e a cada save) copiamos os valores para process.env, então
 * o resto do servidor (ai-routes, telegram) continua lendo process.env sem saber
 * a origem — .env OU Firestore. Se o Firestore tiver o valor, ele vence o .env.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import type admin from 'firebase-admin';
import { setTelegramWebhook } from './telegram';

const DOC_PATH = 'server_config/integrations';

// Campo no Firestore -> variável de ambiente que o resto do código lê.
const FIELD_TO_ENV: Record<string, string> = {
  openaiApiKey: 'OPENAI_API_KEY',
  telegramBotToken: 'TELEGRAM_BOT_TOKEN',
  telegramWebhookSecret: 'TELEGRAM_WEBHOOK_SECRET',
};

function applyToEnv(data: Record<string, any>) {
  for (const [field, env] of Object.entries(FIELD_TO_ENV)) {
    const v = data?.[field];
    if (typeof v === 'string' && v.trim()) process.env[env] = v.trim();
  }
}

/** Carrega os segredos do Firestore para process.env (Firestore vence o .env). */
export async function loadServerSecrets(db: FirebaseFirestore.Firestore | null): Promise<void> {
  if (!db) return;
  try {
    const snap = await db.doc(DOC_PATH).get();
    if (snap.exists) {
      applyToEnv(snap.data() || {});
      console.log('Integrações: segredos carregados do Firestore.');
    }
  } catch (e: any) {
    console.warn('Integrações: não consegui carregar do Firestore:', e?.message);
  }
}

/** Status mascarado — nunca expõe o valor cheio ao navegador. */
function mask(v?: string): { set: boolean; hint?: string } {
  if (!v) return { set: false };
  return { set: true, hint: v.length >= 4 ? `••••${v.slice(-4)}` : '••••' };
}

export function registerIntegrationRoutes(
  app: Express,
  firebaseAdmin: typeof admin,
  db: FirebaseFirestore.Firestore | null,
) {
  // Só o DONO (quem tem ao menos uma entidade) mexe nas chaves globais.
  const requireOwner = async (req: Request, res: Response, next: NextFunction) => {
    if (!db) return res.status(500).json({ error: 'DB indisponível' });
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    let uid: string;
    try { uid = (await firebaseAdmin.auth().verifyIdToken(token)).uid; }
    catch { return res.status(401).json({ error: 'Sessão inválida.' }); }
    const owned = await db.collection('entities').where('ownerUid', '==', uid).limit(1).get();
    if (owned.empty) return res.status(403).json({ error: 'Apenas o dono pode gerenciar as chaves.' });
    (req as Request & { uid?: string }).uid = uid;
    next();
  };

  // Status mascarado das chaves — NUNCA devolve o valor cheio.
  app.get('/api/admin/integrations', requireOwner, async (_req, res) => {
    try {
      const snap = await db!.doc(DOC_PATH).get();
      const d = snap.exists ? (snap.data() || {}) : {};
      res.json({
        openai: mask(d.openaiApiKey),
        telegramToken: mask(d.telegramBotToken),
        telegramSecret: mask(d.telegramWebhookSecret),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Erro ao ler integrações.' });
    }
  });

  // Salva SÓ os campos enviados não-vazios (não apaga os outros) e atualiza o env.
  app.post('/api/admin/integrations', requireOwner, async (req, res) => {
    const body = req.body || {};
    const update: Record<string, string> = {};
    for (const field of Object.keys(FIELD_TO_ENV)) {
      const v = body[field];
      if (typeof v === 'string' && v.trim()) update[field] = v.trim();
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nada para salvar.' });
    try {
      await db!.doc(DOC_PATH).set(update, { merge: true });
      applyToEnv(update);
      // Se o token do Telegram mudou, re-registra o webhook na hora.
      let webhook: { ok: boolean; detail?: string } | undefined;
      if (update.telegramBotToken) webhook = await setTelegramWebhook();
      res.json({ ok: true, webhook });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Erro ao salvar integrações.' });
    }
  });
}
