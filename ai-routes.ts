/**
 * Endpoints de IA no SERVIDOR.
 *
 * Antes, o navegador falava direto com o Gemini e a chave ia junto no bundle —
 * qualquer visitante conseguia extraí-la e gastar na conta do dono. Aqui a
 * chave nunca sai do servidor.
 *
 * São endpoints de PROPÓSITO FIXO, não um proxy genérico: o prompt mora aqui,
 * o cliente manda só dados. Assim um usuário logado não pode transformar o
 * servidor num Gemini de graça para prompts arbitrários.
 */
import { GoogleGenAI, Type } from '@google/genai';
import type { Express, NextFunction, Request, Response } from 'express';
import type admin from 'firebase-admin';
import { categoryNames, matchCategoryId } from './src/lib/categories';

const MODEL = 'gemini-3-flash-preview';

/** Teto do PDF/imagem aceito no parse de extrato (base64), ~12 MB de arquivo. */
const MAX_BASE64_CHARS = 16_000_000;

function getAI(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

export function registerAiRoutes(app: Express, firebaseAdmin: typeof admin) {
  /** Exige um ID token válido do Firebase — a IA não é aberta ao público. */
  const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    try {
      const decoded = await firebaseAdmin.auth().verifyIdToken(token);
      (req as Request & { uid?: string }).uid = decoded.uid;
      next();
    } catch (error) {
      console.warn('IA: token inválido rejeitado.');
      return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    }
  };

  const requireAI = (res: Response): GoogleGenAI | null => {
    const ai = getAI();
    if (!ai) {
      res.status(503).json({ error: 'IA indisponível: GEMINI_API_KEY não configurada no servidor.' });
      return null;
    }
    return ai;
  };

  /**
   * Sugere a categoria de uma ou mais descrições.
   * Body: { descriptions: string[], type: 'income' | 'expense' }
   * Resposta: { categoryIds: string[] } — ids já resolvidos, na mesma ordem.
   */
  app.post('/api/ai/suggest-categories', requireAuth, async (req, res) => {
    const ai = requireAI(res);
    if (!ai) return;

    const body = req.body || {};
    const raw = Array.isArray(body.descriptions) ? body.descriptions : [];
    const descriptions = raw
      .slice(0, 100)
      .map((d: unknown) => String(d ?? '').slice(0, 200))
      .filter((d: string) => d.length > 0);

    if (descriptions.length === 0) return res.json({ categoryIds: [] });
    const type = body.type === 'income' ? 'income' : 'expense';

    const prompt = `Analise as seguintes descrições de transações financeiras e sugira a categoria mais adequada para cada uma entre as seguintes opções: ${categoryNames().join(', ')}.
Tipo das transações: ${type === 'income' ? 'Receita' : 'Despesa'}

Descrições:
${descriptions.map((d: string, i: number) => `${i + 1}. ${d}`).join('\n')}

Responda em formato JSON, um array de strings com os NOMES das categorias sugeridas na mesma ordem das descrições.`;

    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      });
      const names = JSON.parse(response.text || '[]');
      const categoryIds = descriptions.map((_: string, i: number) => matchCategoryId(names[i]));
      res.json({ categoryIds });
    } catch (error) {
      console.error('IA: erro ao sugerir categorias:', error);
      // Degrada em vez de quebrar o formulário do usuário.
      res.json({ categoryIds: descriptions.map(() => 'outros') });
    }
  });

  /**
   * Conselho financeiro focado em quitar dívidas.
   * Body: { balance: number, debts: [...], recentTransactions: [...] }
   * Resposta: { advice: string }
   */
  app.post('/api/ai/financial-advice', requireAuth, async (req, res) => {
    const ai = requireAI(res);
    if (!ai) return;

    const body = req.body || {};
    const summary = {
      balance: Number(body.balance) || 0,
      debts: (Array.isArray(body.debts) ? body.debts : []).slice(0, 50).map((d: any) => ({
        name: String(d?.name ?? '').slice(0, 80),
        amount: Number(d?.amount) || 0,
        interest: d?.interest === null || d?.interest === undefined ? null : Number(d.interest),
      })),
      recentTransactions: (Array.isArray(body.recentTransactions) ? body.recentTransactions : [])
        .slice(0, 30)
        .map((t: any) => ({
          desc: String(t?.desc ?? '').slice(0, 80),
          amount: Number(t?.amount) || 0,
          type: t?.type === 'income' ? 'income' : 'expense',
        })),
    };

    const prompt = `Como um consultor financeiro profissional, analise os seguintes dados financeiros e forneça 3 dicas práticas e curtas para melhorar a saúde financeira, focar em quitar dívidas e onde investir se sobrar dinheiro. Seja direto e motivador. Responda em Português do Brasil.
Dados: ${JSON.stringify(summary)}`;

    try {
      const response = await ai.models.generateContent({ model: MODEL, contents: prompt });
      res.json({ advice: response.text || '' });
    } catch (error) {
      console.error('IA: erro ao gerar análise financeira:', error);
      res.status(502).json({ error: 'Não foi possível gerar a análise no momento.' });
    }
  });

  /**
   * Extrai transações de um extrato/fatura em PDF ou imagem.
   * Body: { base64: string, mimeType: string }
   * Resposta: { rows: { date, description, amount }[] } — cru, normalizado no client.
   */
  app.post('/api/ai/parse-statement', requireAuth, async (req, res) => {
    const ai = requireAI(res);
    if (!ai) return;

    const body = req.body || {};
    const base64 = typeof body.base64 === 'string' ? body.base64 : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    if (!base64 || !mimeType) return res.status(400).json({ error: 'Arquivo ausente.' });
    if (base64.length > MAX_BASE64_CHARS) {
      return res.status(413).json({ error: 'Arquivo grande demais. Envie um extrato menor.' });
    }

    const prompt = `Você é um extrator de extratos bancários e faturas de cartão.
Extraia TODAS as transações deste documento. Para cada uma retorne:
- date: a data no formato YYYY-MM-DD
- description: a descrição/histórico
- amount: o valor numérico. Use NEGATIVO para saídas/despesas/débitos e POSITIVO para entradas/receitas/créditos. Use ponto como separador decimal e não inclua símbolo de moeda.
Ignore linhas de saldo, totais e cabeçalhos. Responda apenas o JSON do array.`;

    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ inlineData: { data: base64, mimeType } }, { text: prompt }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                description: { type: Type.STRING },
                amount: { type: Type.NUMBER },
              },
              required: ['date', 'description', 'amount'],
            },
          },
        },
      });
      res.json({ rows: JSON.parse(response.text || '[]') });
    } catch (error) {
      console.error('IA: erro ao ler extrato:', error);
      res.status(502).json({ error: 'Não foi possível ler o extrato. Tente novamente.' });
    }
  });
}
