import { supabaseAdmin } from "../supabaseAdmin.js";
import { extractKeywords, jaccardSimilarity, RELEVANCE_THRESHOLD } from "./textUtils.js";

// Plataformas aceitas — qualquer outra coisa é rejeitada pra evitar lixo no banco.
export const VALID_PLATFORMS = new Set(["twitter", "reddit", "official"]);

function slugify(title) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

export function clean(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

export function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Recebe um item já normalizado ({ title, link, platform, content?, summary?, publishedAt? })
 * e faz: validação, deduplicação, cruzamento de relevância e insert no Supabase.
 * Usado tanto pelo webhook manual (/api/news/webhook) quanto pelo tradutor do Apify.
 */
export async function ingestNewsItem({ title, link, platform, content = "", summary = "", publishedAt }) {
  title = clean(title);
  link = clean(link);
  platform = clean(platform)?.toLowerCase();

  if (!title || !link) {
    return { status: "skipped", reason: "faltando title ou link", raw_title: title, raw_link: link };
  }
  if (!VALID_PLATFORMS.has(platform)) {
    return { status: "skipped", reason: `plataforma inválida: "${platform}"`, title };
  }

  content = clean(content);
  summary = clean(summary) || content.slice(0, 220) || title;
  const publishedDate = parseDate(publishedAt) ?? new Date();

  // Evita duplicata: mesma source_url já ingerida antes.
  const { data: existing } = await supabaseAdmin
    .from("news")
    .select("id")
    .eq("source_url", link)
    .maybeSingle();

  if (existing) {
    return { status: "skipped", reason: "já existe (mesma source_url)", title, link };
  }

  const isTrending = await checkCrossSourceRelevance({ title, platform, publishedAt: publishedDate });

  const slugBase = slugify(title) || "noticia";
  const slug = `${slugBase}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const { data: inserted, error } = await supabaseAdmin
    .from("news")
    .insert({
      title,
      summary,
      content,
      status: "rumor", // status editorial default; ajuste manual depois via painel/admin
      source_url: link,
      source_platform: platform,
      is_trending: isTrending,
      slug,
      published_at: publishedDate.toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[ingestNewsItem] erro ao inserir:", error);
    return { status: "skipped", reason: "erro no banco de dados", detail: error.message, title };
  }

  return { status: "saved", id: inserted.id, title, is_trending: isTrending };
}

// Verifica se há alguma notícia de OUTRA plataforma, no mesmo dia, com
// palavras-chave parecidas. Se achar, marca ambas como "em_alta"/is_trending.
async function checkCrossSourceRelevance({ title, platform, publishedAt }) {
  const startOfDay = new Date(publishedAt);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(publishedAt);
  endOfDay.setHours(23, 59, 59, 999);

  const { data: sameDayNews, error } = await supabaseAdmin
    .from("news")
    .select("id, title, source_platform")
    .neq("source_platform", platform)
    .gte("published_at", startOfDay.toISOString())
    .lte("published_at", endOfDay.toISOString());

  if (error || !sameDayNews?.length) return false;

  const newKeywords = extractKeywords(title);
  const matches = sameDayNews.filter((candidate) => {
    const candidateKeywords = extractKeywords(candidate.title);
    return jaccardSimilarity(newKeywords, candidateKeywords) >= RELEVANCE_THRESHOLD;
  });

  if (matches.length === 0) return false;

  const matchedIds = matches.map((m) => m.id);
  await supabaseAdmin.from("news").update({ is_trending: true }).in("id", matchedIds);

  return true;
}
