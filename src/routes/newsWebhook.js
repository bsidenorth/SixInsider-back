import { Router } from "express";
import { ingestNewsItem } from "../lib/newsIngest.js";

export const newsWebhookRouter = Router();

// Middleware simples de autenticação do webhook: exige um segredo
// compartilhado no header, configurado no Apify e no .env do backend.
function requireWebhookSecret(req, res, next) {
  const secret = req.headers["x-webhook-secret"];
  if (!process.env.NEWS_WEBHOOK_SECRET || secret !== process.env.NEWS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized", detail: "x-webhook-secret inválido ou ausente" });
  }
  next();
}

// Webhook "genérico": aceita JSON já no formato { title, link, platform, content? }.
// Usado por integrações manuais, testes, ou scrapers customizados.
newsWebhookRouter.post("/webhook", requireWebhookSecret, async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body) ? req.body : [req.body];

    const results = [];
    for (const raw of rawItems) {
      const result = await ingestNewsItem({
        title: raw.title ?? raw.text ?? raw.headline,
        link: raw.link ?? raw.url ?? raw.source_url ?? raw.permalink,
        platform: raw.platform ?? raw.source_platform ?? raw.source,
        content: raw.content ?? raw.body ?? raw.selftext ?? "",
        summary: raw.summary,
        publishedAt: raw.publishedAt ?? raw.published_at ?? raw.createdAt,
      });
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
