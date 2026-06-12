/**
 * Extração de lançamentos por IA no SERVIDOR (não expõe a chave ao navegador).
 * Usado pelo webhook do WhatsApp para entender mensagens de texto ambíguas e,
 * principalmente, FOTOS de notas/cupons fiscais (OCR + interpretação).
 */
import { GoogleGenAI, Type } from '@google/genai';

const CATEGORY_IDS = [
  'alimentacao', 'moradia', 'transporte', 'lazer', 'saude', 'educacao',
  'servicos', 'outros', 'salario', 'investimento', 'venda', 'transferencia',
];

export interface ExtractedTransaction {
  type: 'income' | 'expense';
  amount: number;
  description: string;
  categoryId: string;
}

const schema = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING, description: "'income' para entrada/receita, 'expense' para saída/despesa" },
    amount: { type: Type.NUMBER, description: 'Valor total positivo' },
    description: { type: Type.STRING, description: 'Descrição curta do gasto/recebimento (ex.: nome do estabelecimento)' },
    categoryId: { type: Type.STRING, description: `Uma destas categorias: ${CATEGORY_IDS.join(', ')}` },
  },
  required: ['type', 'amount', 'description', 'categoryId'],
};

function getAI(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

function normalize(raw: any): ExtractedTransaction | null {
  if (!raw) return null;
  const amount = Math.abs(Number(raw.amount));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const type = raw.type === 'income' ? 'income' : 'expense';
  const categoryId = CATEGORY_IDS.includes(raw.categoryId) ? raw.categoryId : (type === 'income' ? 'venda' : 'outros');
  const description = String(raw.description || '').slice(0, 120) || (type === 'income' ? 'Recebimento' : 'Despesa');
  return { type, amount, description, categoryId };
}

/** Interpreta uma mensagem de texto em linguagem natural. */
export async function extractTransactionFromText(text: string): Promise<ExtractedTransaction | null> {
  const ai = getAI();
  if (!ai) return null;
  try {
    const prompt = `Você é um assistente financeiro. A pessoa enviou esta mensagem por WhatsApp descrevendo um gasto ou recebimento:
"${text}"
Extraia o lançamento financeiro. Se não houver valor monetário claro, responda com amount 0.`;
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { responseMimeType: 'application/json', responseSchema: schema },
    });
    return normalize(JSON.parse(response.text || '{}'));
  } catch (err) {
    console.error('extractTransactionFromText error:', err);
    return null;
  }
}

/** Lê uma foto de nota/cupom fiscal e extrai o lançamento (despesa). */
export async function extractTransactionFromImage(base64: string, mimeType: string): Promise<ExtractedTransaction | null> {
  const ai = getAI();
  if (!ai) return null;
  try {
    const prompt = `Esta é a foto de uma nota fiscal, cupom ou comprovante. Identifique o VALOR TOTAL pago, o nome do estabelecimento (para a descrição) e a categoria mais provável. Normalmente é uma despesa (expense).`;
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        { inlineData: { data: base64, mimeType } },
        { text: prompt },
      ],
      config: { responseMimeType: 'application/json', responseSchema: schema },
    });
    return normalize(JSON.parse(response.text || '{}'));
  } catch (err) {
    console.error('extractTransactionFromImage error:', err);
    return null;
  }
}
