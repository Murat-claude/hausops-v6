// Cloud-Modus: Anmeldung, Daten je Nutzer, Belege und Admin über Supabase.
// Ohne Konfiguration läuft die App weiter im lokalen Modus (Daten nur im Browser).
import { createClient } from "../vendor/supabase.js";

export let sb = null;
export let config = null;

// Konfiguration: window.HAUSOPS_CONFIG (z. B. in config.js) oder Netlify-Function immo-config
export async function init() {
  let cfg = window.HAUSOPS_CONFIG;
  if (!cfg?.supabaseUrl) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch("/.netlify/functions/immo-config", { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok && (res.headers.get("content-type") || "").includes("json")) cfg = await res.json();
    } catch { /* lokaler Modus */ }
  }
  if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) return false;
  config = cfg;
  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "hausops-immo-auth" },
  });
  return true;
}

const redirect = () => `${location.origin}${location.pathname}`;
const fail = (error) => { if (error) throw error; };

export async function session() {
  const { data, error } = await sb.auth.getSession();
  fail(error);
  return data.session;
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  fail(error);
}

export async function signUp({ email, password, fullName, company }) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: fullName, company }, emailRedirectTo: redirect() } });
  fail(error);
  return data; // data.session === null → E-Mail-Bestätigung nötig
}

export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
  fail(error);
}

export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  fail(error);
}

export const signOut = () => sb.auth.signOut();
export const onAuth = (fn) => sb.auth.onAuthStateChange((event, s) => fn(event, s));

// ---------------------------------------------------------------- Profil, Tarife, Einstellungen

export async function profile(uid) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", uid).single();
  fail(error);
  return data;
}

export async function updateProfile(uid, patch) {
  const { error } = await sb.from("profiles").update(patch).eq("id", uid);
  fail(error);
}

export async function plans() {
  const { data, error } = await sb.from("plans").select("*").order("sort");
  fail(error);
  return data;
}

export async function appSettings() {
  const { data, error } = await sb.from("app_settings").select("*").eq("id", 1).single();
  fail(error);
  return data;
}

export const touch = () => sb.rpc("touch_last_seen").then(() => {}, () => {});

// ---------------------------------------------------------------- Daten

export async function loadState(uid) {
  const { data, error } = await sb.from("app_state").select("data, version, updated_at").eq("user_id", uid).single();
  fail(error);
  return data;
}

export async function saveState(data, version) {
  const { data: v, error } = await sb.rpc("save_state", { p_data: data, p_version: version });
  if (error) {
    const m = error.message || "";
    if (m.includes("version_conflict")) throw Object.assign(new Error("version_conflict"), { code: "conflict" });
    if (m.includes("plan_limit")) throw Object.assign(new Error(m), { code: "plan_limit", limit: Number(m.split(":")[1]) });
    if (m.includes("account_blocked")) throw Object.assign(new Error(m), { code: "blocked" });
    throw error;
  }
  return v;
}

// ---------------------------------------------------------------- Belege (Storage)

const bucket = () => sb.storage.from("belege");

export async function uploadFile(uid, id, blob) {
  const { error } = await bucket().upload(`${uid}/${id}`, blob, { upsert: true, contentType: blob.type || "application/octet-stream" });
  fail(error);
}

export async function downloadFile(uid, id) {
  const { data, error } = await bucket().download(`${uid}/${id}`);
  fail(error);
  return data;
}

export async function removeFile(uid, id) {
  const { error } = await bucket().remove([`${uid}/${id}`]);
  fail(error);
}

// ---------------------------------------------------------------- Admin

export async function adminUsers() {
  const { data, error } = await sb.rpc("admin_users");
  fail(error);
  return data;
}

export async function adminUpdateUser(p) {
  const { error } = await sb.rpc("admin_update_user", p);
  fail(error);
}

export async function adminLog() {
  const { data, error } = await sb.from("admin_log").select("*").order("at", { ascending: false }).limit(100);
  fail(error);
  return data;
}

export async function savePlan(plan) {
  const { error } = await sb.from("plans").upsert(plan);
  fail(error);
}

export async function saveAppSettings(patch) {
  const { error } = await sb.from("app_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
  fail(error);
}

// Löschen braucht den Service-Schlüssel → Netlify-Function immo-admin
export async function deleteAccount(targetId) {
  const s = await session();
  const res = await fetch("/.netlify/functions/immo-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
    body: JSON.stringify(targetId ? { action: "delete_user", userId: targetId } : { action: "delete_self" }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.success) throw new Error(out.error || `Fehler ${res.status}`);
}

export function friendlyAuthError(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return "E-Mail oder Passwort ist falsch.";
  if (/Email not confirmed/i.test(m)) return "Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Bestätigungsmail).";
  if (/already registered|already been registered/i.test(m)) return "Für diese E-Mail gibt es schon ein Konto – bitte anmelden.";
  if (/Password should be|weak/i.test(m)) return "Das Passwort ist zu schwach (mindestens 8 Zeichen, besser mit Zahl und Sonderzeichen).";
  if (/geschlossen/i.test(m)) return "Die Registrierung ist derzeit geschlossen.";
  if (/rate limit/i.test(m)) return "Zu viele Versuche – bitte kurz warten.";
  if (/fetch|network/i.test(m)) return "Keine Verbindung zum Server.";
  return m;
}
