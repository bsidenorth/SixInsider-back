import { Router } from "express";
import crypto from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.js";

export const paymentWebhookRouter = Router();

// Eventos que LIGAM o premium.
const PREMIUM_ON_EVENTS = new Set(["subscription.paid", "payment.success"]);
// Eventos que DESLIGAM o premium.
const PREMIUM_OFF_EVENTS = new Set(["subscription.canceled", "subscription.cancelled", "subscription.past_due"]);

paymentWebhookRouter.post("/payment", async (req, res) => {
  try {
    // --- 1. Verificação de assinatura ---------------------------------
    // Ajuste este bloco conforme a documentação real da Cactos assim que
    // vocês tiverem acesso a ela — o formato exato do header/assinatura
    // (HMAC, secret simples, etc.) varia por gateway. Por padrão, aqui
    // comparamos um segredo compartilhado enviado no header.
    if (!isValidSignature(req)) {
      return res.status(401).json({ error: "unauthorized", detail: "assinatura do webhook inválida" });
    }

    const event = req.body ?? {};
    const eventType = event.type ?? event.event ?? event.event_type;

    // Identificador do cliente/assinante — tentamos vários formatos comuns
    // de payload de gateway de pagamento.
    const customerId =
      event.customer_id ?? event.customer?.id ?? event.subscription?.customer_id ?? event.data?.customer_id;
    const email = event.customer_email ?? event.customer?.email ?? event.data?.customer?.email;

    if (!eventType) {
      return res.status(400).json({ error: "bad_request", detail: "campo type/event ausente no payload" });
    }
    if (!customerId && !email) {
      return res.status(400).json({ error: "bad_request", detail: "nenhum identificador de cliente (customer_id ou email) no payload" });
    }

    let newStatus = null;
    if (PREMIUM_ON_EVENTS.has(eventType)) newStatus = true;
    else if (PREMIUM_OFF_EVENTS.has(eventType)) newStatus = false;
    else {
      // Evento que não muda status premium (ex: "payment.refunded" parcial,
      // "invoice.created", etc). Só confirmamos recebimento, sem agir.
      return res.status(200).json({ received: true, ignored_event: eventType });
    }

    const user = await upsertPremiumStatus({ customerId, email, isPremium: newStatus });

    return res.status(200).json({
      received: true,
      event: eventType,
      user_id: user.id,
      is_premium: user.is_premium,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[payment/webhook] erro inesperado:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

function isValidSignature(req) {
  const secret = process.env.CACTOS_WEBHOOK_SECRET;
  const receivedSignature = req.headers["x-cactos-signature"];
  if (!secret || !receivedSignature) return false;

  // Comparação em tempo constante pra evitar timing attacks.
  const expected = Buffer.from(secret);
  const received = Buffer.from(String(receivedSignature));
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

async function upsertPremiumStatus({ customerId, email, isPremium }) {
  // Tenta achar o usuário por cactos_customer_id primeiro, depois por email.
  let existing = null;
  if (customerId) {
    const { data } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("cactos_customer_id", customerId)
      .maybeSingle();
    existing = data;
  }
  if (!existing && email) {
    const { data } = await supabaseAdmin.from("users").select("*").eq("email", email).maybeSingle();
    existing = data;
  }

  const now = new Date().toISOString();

  if (existing) {
    const { data: updated, error } = await supabaseAdmin
      .from("users")
      .update({
        is_premium: isPremium,
        premium_updated_at: now,
        premium_since: isPremium ? existing.premium_since ?? now : existing.premium_since,
        cactos_customer_id: customerId ?? existing.cactos_customer_id,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;
    return updated;
  }

  // Usuário ainda não existe no nosso banco (primeiro pagamento antes de
  // qualquer login/cadastro prévio) — criamos o registro na hora.
  if (!email) {
    throw new Error("Não é possível criar usuário sem email (customer_id sozinho não basta)");
  }

  const { data: created, error } = await supabaseAdmin
    .from("users")
    .insert({
      email,
      cactos_customer_id: customerId ?? null,
      is_premium: isPremium,
      premium_since: isPremium ? now : null,
      premium_updated_at: now,
    })
    .select()
    .single();

  if (error) throw error;
  return created;
}
