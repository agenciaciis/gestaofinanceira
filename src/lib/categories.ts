/**
 * Ponte entre o que a IA responde (nome da categoria, em texto livre) e o id
 * que o sistema grava. Puro e testado porque roda no SERVIDOR: o cliente não
 * decide mais categoria nenhuma, só recebe o id pronto.
 */
import { CATEGORIES } from '../constants';

/** Normaliza para comparação: sem acento, sem espaço em volta, tudo minúsculo. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Nomes das categorias, para montar o prompt enviado à IA. */
export function categoryNames(): string[] {
  return CATEGORIES.map(c => c.name);
}

/**
 * Converte o nome devolvido pela IA no id da categoria.
 * Casa sem acento (a IA às vezes responde "alimentacao") e cai em 'outros'
 * quando não reconhece — nunca lança.
 */
export function matchCategoryId(name: string | null | undefined): string {
  if (!name) return 'outros';
  const target = normalize(String(name));
  if (!target) return 'outros';
  const found = CATEGORIES.find(c => normalize(c.name) === target);
  return found ? found.id : 'outros';
}
