import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  // eslint-disable-next-line no-console
  console.error(
    "[SixInsider] Faltando SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env. " +
      "O backend não vai conseguir gravar no banco até isso ser configurado."
  );
}

// service_role ignora Row Level Security — por isso NUNCA deve ser exposta
// no frontend, só usada aqui no servidor.
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
