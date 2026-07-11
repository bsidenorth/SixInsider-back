import { Router } from "express";
import { ingestNewsItem } from "../lib/newsIngest.js";
import { VALID_PLATFORMS } from "../lib/newsIngest.js";

export const apifyWebhookRouter = Router();

// A configuração de headers customizados no painel do Apify (pelo celular)
// é mais chata de achar, então autenticamos por query string mesmo:
// .../api/news/apify-webhook?secret=SEU_SEGREDO&platform=twitter
//
// A plataforma também vem pela URL — configure um webhook por Actor no
// Apify (um pra Twitter, outro pra Reddit se tiver), cada um apontando
// pra essa mesma rota com o "platform" certo.
function requireSecretAndPlatform(req, res, next) {
  const secret = req.query.secret;
  const platform = req.query.platform;

  if (!process.env.NEWS_WEBHOOK_SECRET || secret !== process.env.NEWS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized", detail: "?secret= inválido ou ausente na URL do webhook" });
  }
  if (!VALID_PLATFORMS.has(String(platform).toLowerCase())) {
    return res.status(400).json({ error: "bad_request", detail: '?platform= precisa ser "twitter", "reddit" ou "official"' });
  }
  req.platform = String(platform).toLowerCase();
  next();
}

apifyWebhookRouter.post("/apify-webhook", requireSecretAndPlatform, async (req, res) => {
  try {
    const event = req.body ?? {};

    // O Apify manda vários tipos de evento (ACTOR.RUN.SUCCEEDED, FAILED, etc).
    // Só nos interessa quando a execução terminou com sucesso.
    const eventType = event.eventType;
    if (eventType && eventType !== "ACTOR.RUN.SUCCEEDED") {
      return res.status(200).json({ received: true, ignored_event: eventType });
    }

    const datasetId = event.resource?.defaultDatasetId;
    if (!datasetId) {
      return res.status(400).json({ error: "bad_request", detail: "payload sem resource.defaultDatasetId — não é um evento de run do Apify?" });
    }
    if (!process.env.APIFY_TOKEN) {
      return res.status(500).json({ error: "internal_error", detail: "APIFY_TOKEN não configurado no backend" });
    }

    // Busca os itens raspados desse run direto na API do Apify.
    const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${process.env.APIFY_TOKEN}&clean=true`;
    const datasetRes = await fetch(datasetUrl);
    if (!datasetRes.ok) {
      return res.status(502).json({ error: "apify_fetch_failed", status: datasetRes.status });
    }
    const items = await datasetRes.json();

    const results = [];
    let loggedSample = false;
    for (const raw of items) {
      const mapped = mapScrapedItem(raw, req.platform);

      // Se não conseguiu extrair título/link, imprime os campos reais do
      // item cru (só do primeiro, pra não poluir o log) — assim dá pra
      // ver exatamente como esse Actor nomeia os campos e ajustar o mapa.
      if (!loggedSample && (!mapped.title || mapped.title === "Tweet sem texto" || !mapped.link)) {
        // eslint-disable-next-line no-console
        console.log("[news/apify-webhook] AMOSTRA DO ITEM CRU (campos disponíveis):", Object.keys(raw));
        // eslint-disable-next-line no-console
        console.log("[news/apify-webhook] AMOSTRA DO ITEM CRU (conteúdo):", JSON.stringify(raw).slice(0, 1500));
        loggedSample = true;
      }

      const result = await ingestNewsItem(mapped);
      results.push(result);
    }

    const saved = results.filter((r) => r.status === "saved").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    // eslint-disable-next-line no-console
    console.log(`[news/apify-webhook] platform=${req.platform} recebidos=${items.length} salvos=${saved} pulados=${skipped}`);

    return res.status(200).json({ received: items.length, saved, skipped, details: results });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[news/apify-webhook] erro inesperado:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// Traduz o formato de saída de Actors comuns (Tweet Scraper V2 pro Twitter,
// e os campos mais comuns de scrapers de Reddit) pro formato interno.
// Tenta vários nomes de campo alternativos porque cada Actor nomeia diferente.
function mapScrapedItem(raw, platform) {
  if (platform === "twitter") {
    const text = raw.text ?? raw.fullText ?? raw.full_text ?? raw.tweetText ?? raw.content ?? raw.description ?? "";
    const link =
      raw.twitterUrl ?? raw.url ?? raw.tweetUrl ?? raw.link ?? raw.permalink ?? raw.statusUrl ?? "";
    return {
      title: text ? text.slice(0, 140) : "Tweet sem texto",
      link,
      platform: "twitter",
      content: text,
      publishedAt: raw.createdAt ?? raw.timestamp ?? raw.date ?? raw.created_at,
    };
  }

  if (platform === "reddit") {
    return {
      title: raw.title ?? (raw.text ?? "").slice(0, 140) ?? "Post sem título",
      link: raw.url ?? raw.permalink ?? raw.postUrl,
      platform: "reddit",
      content: raw.selftext ?? raw.text ?? raw.body ?? "",
      publishedAt: raw.createdAt ?? raw.created_utc ?? raw.timestamp,
    };
  }

  // "official" ou qualquer outra fonte — assume formato já parecido com o nosso.
  return {
    title: raw.title ?? raw.text,
    link: raw.url ?? raw.link,
    platform,
    content: raw.content ?? raw.text ?? "",
    publishedAt: raw.publishedAt ?? raw.createdAt,
  };
}
