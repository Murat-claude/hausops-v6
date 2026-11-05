// KI-Funktionen über die Claude API (Anthropic SDK, direkt aus dem Browser).
// Der API-Schlüssel bleibt – wie alle Daten – nur auf diesem Gerät.
import Anthropic from "../vendor/anthropic-sdk.js";
import { EXPENSE_CATEGORIES, BETRKV } from "./core.js";

const KEY = "hausops-immo-ki-key";
const MODEL = "claude-opus-5-5";

export const getKey = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const setKey = (k) => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch {} };
export const hasKey = () => !!getKey();

function client() {
  const apiKey = getKey();
  if (!apiKey) throw new Error("Kein API-Schlüssel hinterlegt (Einstellungen → KI-Assistent).");
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

// Gemeinsamer Aufruf: Claude Opus 5.5 mit serverseitigem Fallback bei Ablehnung
async function call({ system, messages, format, effort = "medium", maxTokens = 16000 }) {
  const res = await client().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages,
    output_config: { effort, ...(format ? { format: { type: "json_schema", schema: format } } : {}) },
  });
  if (res.stop_reason === "refusal") throw new Error("Die KI hat diese Anfrage abgelehnt.");
  if (res.stop_reason === "max_tokens") throw new Error("Antwort war zu lang und wurde abgeschnitten.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!format) return text;
  try { return JSON.parse(text); } catch { throw new Error("KI-Antwort konnte nicht gelesen werden."); }
}

export function friendlyError(e) {
  const s = e?.status;
  if (s === 401) return "API-Schlüssel ungültig – bitte unter Einstellungen prüfen.";
  if (s === 429) return "Zu viele Anfragen / Guthaben aufgebraucht – bitte später erneut versuchen.";
  if (s === 413) return "Datei zu groß für die KI (max. ca. 30 MB).";
  if (s === 400 && /web_search|web search/i.test(e?.message || "")) return "Die Web-Suche ist für deinen API-Schlüssel nicht freigeschaltet (Anthropic Console → Settings → Privacy/Web search).";
  if (s >= 500) return "Der KI-Dienst ist gerade nicht erreichbar – bitte später erneut versuchen.";
  if (e?.name === "APIConnectionError" || /fetch|network/i.test(e?.message || "")) return "Keine Verbindung zum KI-Dienst (Internet?).";
  return e?.message || String(e);
}

// ---------------------------------------------------------------- Beleg auslesen

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["doc_type", "vendor", "date", "amount", "invoice_number", "category", "betrkv", "umlagefaehig", "umlage_betrag", "positions", "hinweis_vermieter", "meter_readings", "period_from", "period_to", "object_hint", "summary", "consumption", "confidence"],
  properties: {
    doc_type: { type: "string", enum: ["rechnung", "bescheid", "abrechnung", "vertrag", "zaehlerstand", "kontoauszug", "sonstiges"] },
    vendor: { type: "string", description: "Aussteller / Firma / Behörde" },
    date: { type: "string", description: "Rechnungs- bzw. Bescheiddatum als YYYY-MM-DD, leer wenn unbekannt" },
    amount: { type: "number", description: "Zu zahlender Gesamtbetrag brutto in Euro (Gutschrift negativ), 0 wenn keiner" },
    invoice_number: { type: "string" },
    category: { type: "string", enum: Object.keys(EXPENSE_CATEGORIES) },
    betrkv: { type: "string", enum: [...BETRKV.map((b) => b[0]), "keine"], description: "Kostenart nach § 2 BetrKV, 'keine' wenn nicht umlagefähig" },
    umlagefaehig: { type: "boolean", description: "true, wenn der Beleg ganz oder teilweise umlagefähig ist" },
    umlage_betrag: { type: "number", description: "Umlagefähiger Anteil brutto in Euro (Summe der umlagefähigen Positionen), 0 wenn nichts umlagefähig" },
    positions: {
      type: "array", description: "Rechnungspositionen, gruppiert nach umlagefähig / nicht umlagefähig. Bei einfachen Belegen genau eine Position.",
      items: {
        type: "object", additionalProperties: false, required: ["text", "amount", "betrkv", "umlagefaehig", "reason"],
        properties: {
          text: { type: "string" }, amount: { type: "number", description: "brutto in Euro" },
          betrkv: { type: "string", enum: [...BETRKV.map((b) => b[0]), "keine"] },
          umlagefaehig: { type: "boolean" }, reason: { type: "string", description: "kurze Begründung (z. B. 'Wartung = umlagefähig', 'Reparatur = Instandhaltung')" },
        },
      },
    },
    hinweis_vermieter: { type: "string", description: "Vermieterfreundlicher Tipp: was zusätzlich umlagefähig sein könnte, was im Mietvertrag stehen muss, oder was aufgeschlüsselt werden sollte; leer wenn nichts" },
    meter_readings: {
      type: "array", description: "Abgelesene Zählerstände (bei Zählerfotos oder Abrechnungen), sonst leer",
      items: { type: "object", additionalProperties: false, required: ["meter_type", "meter_number", "value", "date"],
        properties: { meter_type: { type: "string", enum: ["wasser_kalt", "wasser_warm", "heizung", "strom", "gas", "sonstiges"] }, meter_number: { type: "string" }, value: { type: "number" }, date: { type: "string", description: "YYYY-MM-DD oder leer" } } },
    },
    period_from: { type: "string", description: "Beginn des Leistungs-/Abrechnungszeitraums YYYY-MM-DD oder leer" },
    period_to: { type: "string", description: "Ende des Leistungs-/Abrechnungszeitraums YYYY-MM-DD oder leer" },
    object_hint: { type: "string", description: "Adresse/Objekt, auf das sich der Beleg bezieht, wörtlich" },
    summary: { type: "string", description: "Ein Satz auf Deutsch, worum es geht; Besonderheiten (z. B. Abschlag statt Jahresabrechnung, Zählerstände)" },
    consumption: { type: "string", description: "Verbrauchswerte/Zählerstände falls vorhanden, sonst leer" },
    confidence: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
  },
};

export async function readReceipt({ base64, mediaType, objects }) {
  const fileBlock = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
  return call({
    effort: "medium",
    format: RECEIPT_SCHEMA,
    system: `Du liest Belege für die Buchhaltung eines privaten Vermieters in Deutschland aus (Rechnungen, Grundsteuer-/Abgabenbescheide, Versorger- und Versicherungsabrechnungen, Handwerker-, Hausmeister- und Wartungsrechnungen, Zählerfotos). Übernimm Beträge und Daten exakt vom Beleg; was nicht draufsteht, bleibt leer.
Prüfe vermieterfreundlich, aber rechtssicher nach § 2 BetrKV, was auf Mieter umlegbar ist:
- Zerlege gemischte Rechnungen in Positionen: z. B. Hausmeister (Pflege/Reinigung/Winterdienst umlagefähig, Reparatur/Verwaltung/Notdienstpauschale nicht), Heizungsfirma (Wartung, Reinigung, Immissionsmessung umlagefähig, Reparatur/Ersatzteile nicht), Aufzug-Vollwartung (Reparaturanteil abziehen), Versicherung (Gebäude, Elementar, Glas, Haftpflicht umlagefähig; Rechtsschutz, Mietausfall nicht).
- Typisch umlagefähig und oft übersehen: Legionellenprüfung, Wartung Rauchwarnmelder (nicht deren Miete), Zählermiete/Eichung, Ablesedienst, Dachrinnenreinigung, E-Check, Feuerlöscherprüfung (die letzten nur, wenn im Mietvertrag als sonstige Betriebskosten benannt – dann im Hinweis erwähnen).
- Seit 1.7.2024 sind Kabel-TV-Gebühren nicht mehr umlagefähig.
- Nie umlagefähig: Reparaturen/Instandhaltung, Verwaltung, Bankgebühren, Zinsen, Rücklagen, Anschaffungen.
Gib im Feld hinweis_vermieter einen kurzen, konkreten Tipp, wie der Vermieter möglichst viel rechtssicher umlegen kann (z. B. "Rechnung vom Hausmeister nach Tätigkeiten aufschlüsseln lassen").`,
    messages: [{ role: "user", content: [fileBlock, { type: "text", text: `Lies diesen Beleg aus. Meine Objekte: ${objects.join("; ") || "–"}.` }] }],
  });
}

// ---------------------------------------------------------------- Assistent

const ASSISTANT_SYSTEM = `Du bist der Assistent in „HausOps Immobilien“, der Verwaltungs-App eines privaten Vermieters in Deutschland (Wohnungen, Garagen, Stellplätze, Ferienwohnungen).
Du bekommst die aktuellen Daten der App als JSON. Beantworte Fragen ausschließlich auf Basis dieser Daten und deines Fachwissens zu Vermietung, Nebenkosten (BetrKV, HeizkostenV, § 556 BGB), Mietrecht und Steuern (Anlage V, AfA, Umsatzsteuer bei Ferienwohnungen).
- Antworte auf Deutsch, kurz, konkret, mit Zahlen aus den Daten (Beträge im Format 1.234,56 €).
- Wenn etwas nicht in den Daten steht, sag das und nenne, wo man es in der App erfasst.
- Bei rechtlichen oder steuerlichen Fragen: gib eine fundierte Einschätzung, weise bei Grenzfällen auf Anwalt, Haus & Grund oder Steuerberater hin.
- Wenn der Nutzer einen Text (Brief, E-Mail, Nachricht an Gast) möchte, formuliere ihn fertig zum Kopieren.
- Verwende einfache Formatierung (Absätze, Aufzählungen mit „-“), keine Tabellen.`;

export async function ask({ question, history, context }) {
  const messages = [
    ...history.flatMap((h) => [{ role: "user", content: h.q }, { role: "assistant", content: h.a }]),
    { role: "user", content: question },
  ];
  return call({
    effort: "medium",
    system: [
      { type: "text", text: ASSISTANT_SYSTEM },
      { type: "text", text: `Heutiges Datum: ${new Date().toISOString().slice(0, 10)}\nDaten der App (JSON):\n${JSON.stringify(context)}`, cache_control: { type: "ephemeral" } },
    ],
    messages,
  });
}

// ---------------------------------------------------------------- Briefe

const LETTER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["subject", "body"],
  properties: {
    subject: { type: "string", description: "Betreffzeile ohne das Wort 'Betreff'" },
    body: { type: "string", description: "Brieftext ab der Anrede bis einschließlich Grußformel und Name, Absätze durch Leerzeilen" },
  },
};

export async function draftLetter({ kind, instructions, facts, current }) {
  return call({
    effort: "medium",
    format: LETTER_SCHEMA,
    system: "Du schreibst Briefe eines privaten Vermieters an seine Mieter in Deutschland: sachlich, freundlich, rechtssicher formuliert, in einfacher Sprache. Halte gesetzliche Formvorgaben ein (z. B. Begründung und Fristen bei Mieterhöhung nach §§ 558 ff. BGB, Zahlungsfrist bei Mahnung) und erfinde keine Zahlen – nutze nur die gegebenen Fakten, fehlende Angaben als [Platzhalter].",
    messages: [{ role: "user", content: `Briefart: ${kind}\nFakten (JSON): ${JSON.stringify(facts)}\n${current ? `Bisheriger Entwurf:\n${current}\n` : ""}Anweisung: ${instructions || "Bitte formulieren."}` }],
  });
}

// ---------------------------------------------------------------- Recherche im Internet (Web-Suche)

export async function research(question) {
  const c = client();
  const messages = [{ role: "user", content: question }];
  const params = {
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "DE" } }],
    system: "Du recherchierst für einen privaten Vermieter in Deutschland zum Betriebskostenrecht (BetrKV, BGB, HeizkostenV, aktuelle BGH- und Landgerichtsurteile). Suche im Internet nach aktuellen, verlässlichen Quellen (Gesetzestexte, BGH-Urteile, Haus & Grund, Mieterbund, Fachportale). Antworte auf Deutsch in 4–8 Sätzen: klare Einschätzung (umlagefähig ja/nein/strittig), Voraussetzungen (z. B. Nennung im Mietvertrag, Aufschlüsselung), vermieterfreundliche, aber rechtssichere Empfehlung und das wichtigste Urteil mit Aktenzeichen, falls vorhanden. Keine Tabellen.",
    messages,
  };
  let res;
  for (let i = 0; i < 4; i++) {
    res = await c.beta.messages.create(params);
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content }); // Server setzt die Suche fort
  }
  if (res.stop_reason === "refusal") throw new Error("Die KI hat diese Anfrage abgelehnt.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const sources = new Map();
  for (const b of res.content) {
    for (const cit of b.citations || []) if (cit.url) sources.set(cit.url, cit.title || cit.url);
  }
  if (!sources.size) for (const b of res.content) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content.slice(0, 5)) if (r.url) sources.set(r.url, r.title || r.url);
  return { text, sources: [...sources].map(([url, title]) => ({ url, title })) };
}
