/**
 * Extração de lançamentos por IA no SERVIDOR (OpenAI — não expõe a chave ao
 * navegador). Usado pelos bots (WhatsApp/Telegram) para entender mensagens de
 * texto ambíguas e, principalmente, FOTOS de notas/cupons (visão do gpt-4o).
 */
import OpenAI from 'openai';

const MODEL = 'gpt-4o';

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

function getAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

/** Descreve o formato JSON esperado — vale para texto e imagem. */
const SHAPE_INSTRUCTION = `Responda em JSON no formato:
{"type": "income" ou "expense", "amount": número positivo, "description": "descrição curta (ex.: nome do estabelecimento)", "categoryId": "uma destas: ${CATEGORY_IDS.join(', ')}"}
Use "income" para entrada/receita e "expense" para saída/despesa.`;

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
    const prompt = `Você é um assistente financeiro. A pessoa enviou esta mensagem descrevendo um gasto ou recebimento:
"${text}"
Extraia o lançamento financeiro. Se não houver valor monetário claro, responda com amount 0.
${SHAPE_INSTRUCTION}`;
    const completion = await ai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    return normalize(JSON.parse(completion.choices[0]?.message?.content || '{}'));
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
    const prompt = `Esta é a foto de uma nota fiscal, cupom ou comprovante. Identifique o VALOR TOTAL pago, o nome do estabelecimento (para a descrição) e a categoria mais provável. Normalmente é uma despesa (expense).
${SHAPE_INSTRUCTION}`;
    const completion = await ai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ] as any,
        },
      ],
      response_format: { type: 'json_object' },
    });
    return normalize(JSON.parse(completion.choices[0]?.message?.content || '{}'));
  } catch (err) {
    console.error('extractTransactionFromImage error:', err);
    return null;
  }
}
