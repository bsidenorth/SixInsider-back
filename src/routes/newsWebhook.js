import { Router } from "express";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { extractKeywords, jaccardSimilarity, RELEVANCE_THRESHOLD } from "../lib/textUtils.js";

export const newsWebhookRouter = Router();

// Plataformas aceitas — qualquer outra coisa vinda do Apify é rejeitada
// pra evitar lixo no banco.
const VALID_PLATFORMS = new Set(["twitter", "reddit", "official"]);

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

// Middleware simples de autenticação do webhook: exige um segredo
// compartilhado no header, configurado no Apify e no .env do backend.
function requireWebhookSecret(req, res, next) {
  const secret = req.headers["x-webhook-secret"];
  if (!process.env.NEWS_WEBHOOK_SECRET || secret !== process.env.NEWS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized", detail: "x-webhook-secret inválido ou ausente" });
  }
  next();
}

newsWebhookRouter.post("/webhook", requireWebhookSecret, async (req, res) => {
  try {
    // Apify normalmente manda um array de itens (um scraping run inteiro).
    // Aceitamos tanto um objeto único quanto um array pra flexibilidade.
    const rawItems = Array.isArray(req.body) ? req.body : [req.body];

    const results = [];
    for (const raw of rawItems) {
      const result = await processSingleItem(raw);
      results.push(result);
    }

    const saved = results.filter((r) => r.status === "saved").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    return res.status(200).json({
      received: rawItems.length,
      saved,
      skipped,
      details: results,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[news/webhook] erro inesperado:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

async function processSingleItem(raw) {
  // --- 1. Validação básica -------------------------------------------
  // Aceita alguns nomes de campo alternativos, já que scrapers diferentes
  // (Twitter vs Reddit) costumam nomear as coisas de jeitos diferentes.
  const title = clean(raw.title ?? raw.text ?? raw.headline);
  const link = clean(raw.link ?? raw.url ?? raw.source_url ?? raw.permalink);
  const platform = clean(raw.platform ?? raw.source_platform ?? raw.source)?.toLowerCase();

  if (!title || !link) {
    return { status: "skipped", reason: "faltando title ou link", raw_title: title, raw_link: link };
  }
  if (!VALID_PLATFORMS.has(platform)) {
    return { status: "skipped", reason: `plataforma inválida: "${platform}"`, title };
  }

  // --- 2. Limpeza -------------------------------------------------------
  const content = clean(raw.content ?? raw.body ?? raw.selftext ?? "");
  const summary = clean(raw.summary) || content.slice(0, 220) || title;
  const publishedAt = parseDate(raw.publishedAt ?? raw.published_at ?? raw.createdAt) ?? new Date();

  // Evita duplicata: mesma source_url já ingerida antes.
  const { data: existing } = await supabaseAdmin
    .from("news")
    .select("id")
    .eq("source_url", link)
    .maybeSingle();

  if (existing) {
    return { status: "skipped", reason: "já existe (mesma source_url)", title, link };
  }

  // --- 3. Cruzamento de relevância --------------------------------------
  // Busca notícias das últimas 24h de OUTRAS plataformas e compara palavras-chave.
  const isTrending = await checkCrossSourceRelevance({ title, platform, publishedAt });

  // --- 4. Salvar ----------------------------------------------------------
  const slugBase = slugify(title) || "noticia";
  const slug = `${slugBase}-${Date.now().toString(36)}`;

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
      published_at: publishedAt.toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[news/webhook] erro ao inserir:", error);
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

  // Marca também a(s) notícia(s) antiga(s) que combinaram, já que agora
  // sabemos que o assunto está circulando em múltiplas fontes.
  const matchedIds = matches.map((m) => m.id);
  await supabaseAdmin.from("news").update({ is_trending: true }).in("id", matchedIds);

  return true;
}

function clean(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
