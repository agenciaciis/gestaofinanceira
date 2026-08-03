/**
 * Endpoints de IA no SERVIDOR (OpenAI / ChatGPT).
 *
 * A chave (OPENAI_API_KEY) nunca sai do servidor — antes o navegador falava
 * direto com o provedor e a chave ia no bundle, o que deixava qualquer visitante
 * gastar na conta do dono.
 *
 * São endpoints de PROPÓSITO FIXO, não um proxy genérico: o prompt mora aqui,
 * o cliente manda só dados. Assim um usuário logado não pode transformar o
 * servidor num ChatGPT de graça para prompts arbitrários.
 */
import OpenAI from 'openai';
import type { Express, NextFunction, Request, Response } from 'express';
import type admin from 'firebase-admin';
import { categoryNames, matchCategoryId } from './src/lib/categories';

// Modelo único para tudo (texto, conselho e leitura de PDF/imagem).
const MODEL = 'gpt-4o';

/** Teto do PDF/imagem aceito no parse de extrato (base64), ~12 MB de arquivo. */
const MAX_BASE64_CHARS = 16_000_000;

function getAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
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

  const requireAI = (res: Response): OpenAI | null => {
    const ai = getAI();
    if (!ai) {
      res.status(503).json({ error: 'IA indisponível: OPENAI_API_KEY não configurada no servidor.' });
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

Responda em JSON no formato {"categorias": ["NomeCategoria1", "NomeCategoria2", ...]} com os NOMES das categorias na mesma ordem das descrições.`;

    try {
      const completion = await ai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
      const names: unknown[] = Array.isArray(parsed.categorias)
        ? parsed.categorias
        : Array.isArray(parsed.categories) ? parsed.categories : [];
      const categoryIds = descriptions.map((_: string, i: number) => matchCategoryId(names[i] as string));
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
      const completion = await ai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
      });
      res.json({ advice: completion.choices[0]?.message?.content || '' });
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
Ignore linhas de saldo, totais e cabeçalhos.
Responda em JSON no formato {"rows": [{"date": "YYYY-MM-DD", "description": "...", "amount": -0.00}, ...]}.`;

    const dataUrl = `data:${mimeType};base64,${base64}`;
    // PDF entra como arquivo; imagem entra como image_url (visão do gpt-4o).
    const filePart = mimeType.includes('pdf')
      ? { type: 'file', file: { filename: 'extrato.pdf', file_data: dataUrl } }
      : { type: 'image_url', image_url: { url: dataUrl } };

    try {
      const completion = await ai.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }, filePart] as any,
          },
        ],
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
      const rows = Array.isArray(parsed.rows)
        ? parsed.rows
        : Array.isArray(parsed.transactions) ? parsed.transactions : (Array.isArray(parsed) ? parsed : []);
      res.json({ rows });
    } catch (error) {
      console.error('IA: erro ao ler extrato:', error);
      res.status(502).json({ error: 'Não foi possível ler o extrato. Tente novamente.' });
    }
  });
}
