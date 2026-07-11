import "dotenv/config";
import express from "express";
import cors from "cors";
import { newsWebhookRouter } from "./routes/newsWebhook.js";
import { paymentWebhookRouter } from "./routes/paymentWebhook.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" })); // payloads de Apify podem vir com content grande

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "sixinsider-backend" });
});

app.use("/api/news", newsWebhookRouter);
app.use("/api/v1/webhooks", paymentWebhookRouter);

app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[SixInsider backend] rodando na porta ${PORT}`);
});
