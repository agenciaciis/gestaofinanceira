import { GoogleGenAI, Type } from "@google/genai";
import { CATEGORIES } from "../constants";
import { parseAmountBR, parseFlexibleDate, ParsedRow } from "../lib/statementParsers";

export const suggestCategories = async (descriptions: string[], type: 'income' | 'expense') => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const prompt = `Analise as seguintes descrições de transações financeiras e sugira a categoria mais adequada para cada uma entre as seguintes opções: ${CATEGORIES.map(c => c.name).join(', ')}. 
    Tipo das transações: ${type === 'income' ? 'Receita' : 'Despesa'}
    
    Descrições:
    ${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}
    
    Responda em formato JSON, um array de strings com os NOMES das categorias sugeridas na mesma ordem das descrições.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          }
        }
      }
    });

    const suggestions = JSON.parse(response.text || '[]');
    return suggestions.map((s: string) => {
      const category = CATEGORIES.find(c => c.name.toLowerCase() === s.toLowerCase());
      return category ? category.id : 'outros';
    });
  } catch (error) {
    console.error("Error suggesting categories:", error);
    return descriptions.map(() => 'outros');
  }
};

/**
 * Extrai as transações de um extrato/fatura em PDF usando a IA (Gemini),
 * enviando o arquivo diretamente (sem precisar de parser de PDF no navegador).
 * Retorna linhas já normalizadas (data 'YYYY-MM-DD', valor com sinal).
 */
export const extractStatementFromPdf = async (
  base64: string,
  mimeType: string
): Promise<ParsedRow[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const prompt = `Você é um extrator de extratos bancários e faturas de cartão.
Extraia TODAS as transações deste documento. Para cada uma retorne:
- date: a data no formato YYYY-MM-DD
- description: a descrição/histórico
- amount: o valor numérico. Use NEGATIVO para saídas/despesas/débitos e POSITIVO para entradas/receitas/créditos. Use ponto como separador decimal e não inclua símbolo de moeda.
Ignore linhas de saldo, totais e cabeçalhos. Responda apenas o JSON do array.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      { inlineData: { data: base64, mimeType } },
      { text: prompt },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING },
            description: { type: Type.STRING },
            amount: { type: Type.NUMBER },
          },
          required: ["date", "description", "amount"],
        },
      },
    },
  });

  const raw = JSON.parse(response.text || '[]') as { date: string; description: string; amount: number }[];
  return raw
    .map((r) => ({
      date: parseFlexibleDate(r.date),
      description: String(r.description || 'Lançamento importado'),
      amount: typeof r.amount === 'number' ? r.amount : parseAmountBR(r.amount),
    }))
    .filter((r) => r.date && Number.isFinite(r.amount));
};
