import { GoogleGenAI, Type } from "@google/genai";
import { CATEGORIES } from "../constants";

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
