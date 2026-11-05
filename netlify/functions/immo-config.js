// HausOps Immobilien: öffentliche Supabase-Konfiguration für den Browser.
// Der anon-Key ist öffentlich (Zugriff wird über Row Level Security geschützt).
// Netlify → Site settings → Environment variables:
//   IMMO_SUPABASE_URL, IMMO_SUPABASE_ANON_KEY
exports.handler = async () => {
  const url = process.env.IMMO_SUPABASE_URL || "";
  const key = process.env.IMMO_SUPABASE_ANON_KEY || "";
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    body: JSON.stringify(url && key ? { supabaseUrl: url, supabaseAnonKey: key } : {}),
  };
};
