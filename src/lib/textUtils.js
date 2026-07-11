// Stopwords básicas PT/EN — palavras comuns que não ajudam a identificar
// se duas notícias são "sobre a mesma coisa".
const STOPWORDS = new Set([
  "a", "o", "os", "as", "de", "da", "do", "das", "dos", "e", "em", "um",
  "uma", "para", "com", "por", "no", "na", "nos", "nas", "que", "se",
  "sobre", "novo", "nova", "the", "a", "an", "and", "of", "in", "on",
  "for", "to", "is", "are", "new", "official", "confirms", "confirmed",
  "gta", "gta6", "rockstar",
]);

/**
 * Transforma um título em um conjunto (Set) de palavras-chave relevantes,
 * já sem acento, pontuação, stopwords e palavras curtas demais.
 */
export function extractKeywords(title = "") {
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9\s]/g, " "); // remove pontuação

  const words = normalized
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  return new Set(words);
}

/**
 * Similaridade de Jaccard entre dois conjuntos de palavras-chave:
 * intersecção / união. Retorna um número de 0 a 1.
 */
export function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const word of setA) {
    if (setB.has(word)) intersectionSize += 1;
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

// Duas notícias com 35%+ de sobreposição de palavras-chave são
// consideradas "sobre o mesmo assunto". Ajuste esse número se estiver
// pegando falsos positivos/negativos demais na prática.
export const RELEVANCE_THRESHOLD = 0.35;
