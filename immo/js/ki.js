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
  required: ["doc_type", "ordner", "vendor", "date", "amount", "invoice_number", "category", "betrkv", "umlagefaehig", "umlage_betrag", "positions", "hinweis_vermieter", "meter_readings", "period_from", "period_to", "object_hint", "summary", "consumption", "confidence"],
  properties: {
    doc_type: { type: "string", enum: ["rechnung", "bescheid", "abrechnung", "vertrag", "zaehlerstand", "kontoauszug", "sonstiges"] },
    ordner: { type: "string", enum: ["schornsteinfeger", "gas_heizung", "strom", "wasser", "muell", "grundsteuer", "versicherung", "hausmeister", "wartung", "handwerker", "hausgeld", "bank", "steuer", "mieter", "nebenkosten", "kauf", "fewo", "sonstiges"], description: "Themen-Ordner für die Ablage: Schornsteinfeger, Gas/Heizung/Öl, Strom, Wasser/Abwasser, Müll, Grundsteuer/Abgaben, Versicherung, Hausmeister/Reinigung/Garten, Wartung/Prüfungen, Handwerker/Reparaturen, Hausgeld/WEG, Bank/Darlehen, Steuer/Finanzamt, Mietverträge/Mieter, Nebenkostenabrechnungen, Kauf/Notar/Grundbuch, Ferienwohnung, sonst sonstiges" },
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
    system: `Du liest Belege und Unterlagen eines privaten Vermieters in Deutschland aus und ordnest sie einem Themen-Ordner zu (Rechnungen, Grundsteuer-/Abgabenbescheide, Versorger- und Versicherungsabrechnungen, Handwerker-, Hausmeister- und Wartungsrechnungen, Zählerfotos). Übernimm Beträge und Daten exakt vom Beleg; was nicht draufsteht, bleibt leer.
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

const ASSISTANT_SYSTEM = `Du bist der Assistent in „Homevio“, der Verwaltungs-App eines privaten Vermieters in Deutschland (Wohnungen, Garagen, Stellplätze, Ferienwohnungen).
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

// ---------------------------------------------------------------- Mietvertrag auslesen

const LEASE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["mieter", "vermieter", "objekt_adresse", "einheit", "flaeche_m2", "mietbeginn", "mietende", "kaltmiete", "nebenkosten_vz", "heizkosten_vz", "zuschlaege", "kaution", "mietart", "staffeln", "kuendigungsfrist", "bk_klausel", "sonstige_bk", "personen", "besonderheiten", "risiken", "confidence"],
  properties: {
    mieter: { type: "array", items: { type: "string" }, description: "Namen aller Mieter" },
    vermieter: { type: "string" },
    objekt_adresse: { type: "string" },
    einheit: { type: "string", description: "Bezeichnung/Lage der Wohnung, Garage, Stellplatz, Keller" },
    flaeche_m2: { type: "number", description: "0 wenn nicht angegeben" },
    mietbeginn: { type: "string", description: "YYYY-MM-DD oder leer" },
    mietende: { type: "string", description: "YYYY-MM-DD bei Befristung, sonst leer" },
    kaltmiete: { type: "number", description: "Nettokaltmiete in Euro pro Monat" },
    nebenkosten_vz: { type: "number", description: "Betriebskostenvorauszahlung in Euro pro Monat (ohne Heizung), 0 wenn keine" },
    heizkosten_vz: { type: "number", description: "Heizkostenvorauszahlung in Euro pro Monat, 0 wenn keine/in NK enthalten" },
    zuschlaege: { type: "number", description: "Zuschläge (Stellplatz, Garage, Möblierung) pro Monat, 0 wenn keine" },
    kaution: { type: "number" },
    mietart: { type: "string", enum: ["standard", "staffel", "index"] },
    staffeln: { type: "array", items: { type: "object", additionalProperties: false, required: ["ab", "kaltmiete"], properties: { ab: { type: "string", description: "YYYY-MM" }, kaltmiete: { type: "number" } } } },
    kuendigungsfrist: { type: "string", description: "kurz, z. B. '3 Monate (gesetzlich)'" },
    bk_klausel: { type: "boolean", description: "Wurde die Umlage der Betriebskosten (z. B. nach § 2 BetrKV) wirksam vereinbart?" },
    sonstige_bk: { type: "array", items: { type: "string" }, description: "Ausdrücklich benannte sonstige Betriebskosten (§ 2 Nr. 17 BetrKV)" },
    personen: { type: "number", description: "0 wenn nicht angegeben" },
    besonderheiten: { type: "array", items: { type: "string" }, description: "Wichtige Regelungen: Schönheitsreparaturen, Kleinreparaturen, Tierhaltung, Untervermietung, Keller/Stellplatz inklusive …" },
    risiken: { type: "array", items: { type: "string" }, description: "Klauseln, die nach aktueller BGH-Rechtsprechung unwirksam sein könnten (z. B. starre Fristen für Schönheitsreparaturen, Quotenabgeltung, Kaution über 3 Kaltmieten), aus Vermietersicht kurz erklärt" },
    confidence: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
  },
};

export async function readLease({ base64, mediaType }) {
  const fileBlock = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
  return call({
    effort: "medium",
    format: LEASE_SCHEMA,
    system: "Du liest deutsche Miet- und Garagenverträge für den Vermieter aus. Übernimm Daten exakt aus dem Vertrag; was nicht drinsteht, bleibt leer bzw. 0. Beträge in Euro. Prüfe zusätzlich, ob die Betriebskostenumlage wirksam vereinbart ist und welche sonstigen Betriebskosten ausdrücklich genannt sind, und weise auf Klauseln hin, die nach aktueller BGH-Rechtsprechung unwirksam sein könnten – sachlich, kurz, aus Vermietersicht.",
    messages: [{ role: "user", content: [fileBlock, { type: "text", text: "Lies diesen Mietvertrag aus." }] }],
  });
}

// ---------------------------------------------------------------- Rechnungsadresse aus Foto / Screenshot / PDF lesen

const ADDRESS_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["company", "name", "street", "zip", "city", "country", "vat_id", "tax_number", "email", "phone", "reference", "note", "confidence"],
  properties: {
    company: { type: "string", description: "Firmenname exakt wie geschrieben inkl. Rechtsform (GmbH, B.V., Sp. z o.o., S.r.l. …), leer bei Privatperson" },
    name: { type: "string", description: "Ansprechpartner/Person, falls angegeben (z. Hd.), sonst leer" },
    street: { type: "string", description: "Straße und Hausnummer (ggf. mit Zusatz wie Postfach, Gebäude, Etage)" },
    zip: { type: "string", description: "Postleitzahl genau wie angegeben (z. B. 1010, 2511 CV, 00-950, SW1A 1AA)" },
    city: { type: "string" },
    country: { type: "string", description: "ISO-3166-Alpha-2-Code (DE, AT, NL, PL …); DE wenn eindeutig Deutschland oder nichts angegeben ist" },
    vat_id: { type: "string", description: "USt-IdNr./VAT number/BTW/NIP/TVA mit Länderpräfix, ohne Leerzeichen (z. B. NL123456789B01, ATU12345678, PL1234567890); leer wenn keine" },
    tax_number: { type: "string", description: "Nationale Steuernummer, falls zusätzlich angegeben, sonst leer" },
    email: { type: "string", description: "E-Mail für Rechnungen (invoice@, buchhaltung@, accounts payable …), sonst leer" },
    phone: { type: "string" },
    reference: { type: "string", description: "Bestellnummer/PO/Kostenstelle/Referenz, die auf die Rechnung soll, sonst leer" },
    note: { type: "string", description: "Kurzer Hinweis auf Deutsch, falls etwas unklar oder unvollständig ist, sonst leer" },
    confidence: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
  },
};

export async function readAddress({ base64, mediaType, text }) {
  const content = [];
  if (base64) content.push(mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
  content.push({ type: "text", text: text ? `Rechnungsanschrift aus diesem Text:\n${text}` : "Lies die Rechnungsanschrift aus diesem Bild (z. B. Screenshot einer E-Mail oder Buchungsbestätigung)." });
  return call({
    effort: "low",
    format: ADDRESS_SCHEMA,
    system: `Du liest Rechnungsanschriften für eine Ferienwohnungs-Rechnung aus (oft Firmen, die Mitarbeiter unterbringen, auch aus dem Ausland). Übernimm Namen, Sonderzeichen und Diakritika exakt (ł, ø, ş, é, ß …), erfinde nichts. Wenn mehrere Adressen vorkommen, nimm die ausdrücklich als Rechnungsadresse/billing/invoice address bezeichnete, nicht die Absender- oder Lieferadresse und nicht die Adresse der Ferienwohnung. USt-IdNr. immer mit Länderpräfix und ohne Leerzeichen/Punkte.`,
    messages: [{ role: "user", content }],
  });
}
