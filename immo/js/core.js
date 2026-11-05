// HausOps Immobilien — reine Fachlogik (ohne DOM), in Node testbar.
// Geldbeträge werden durchgehend als ganze Cent (Integer) gespeichert.
import { vatFor, nkParticipates, co2Split } from "./recht.js";

// ---------------------------------------------------------------- Geld & Datum

export function parseAmount(input) {
  if (input === null || input === undefined) return 0;
  if (typeof input === "number") return Math.round(input * 100);
  let s = String(input).trim().replace(/\s|€|EUR/gi, "");
  if (!s) return 0;
  let neg = false;
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.234" = Tausenderpunkt
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  const cents = Math.round(n * 100);
  return neg ? -cents : cents;
}

const eurFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const fmtEUR = (cents) => eurFmt.format((cents || 0) / 100);
export const fmtNum = (cents) =>
  ((cents || 0) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function parseDate(input) {
  if (!input) return "";
  const s = String(input).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}

export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export const monthKey = (iso) => (iso || "").slice(0, 7);

export function addMonths(key, n) {
  let [y, m] = key.split("-").map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function monthRange(fromKey, toKey) {
  const out = [];
  let k = fromKey;
  while (k <= toKey && out.length < 600) { out.push(k); k = addMonths(k, 1); }
  return out;
}

export const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
  "August", "September", "Oktober", "November", "Dezember"];
export const fmtMonth = (key) => `${MONTHS_DE[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

export function nightsBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return 0;
  const a = Date.UTC(...fromIso.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  const b = Date.UTC(...toIso.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  return Math.max(0, Math.round((b - a) / 86400000));
}

export const daysInMonth = (key) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate();

export function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// ---------------------------------------------------------------- Texte normalisieren

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const normIban = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();

// ---------------------------------------------------------------- Stammdaten-Konstanten

export const UNIT_TYPES = {
  wohnung: "Wohnung",
  haus: "Haus (ganz)",
  gewerbe: "Gewerbe",
  garage: "Garage",
  stellplatz: "Stellplatz",
  carport: "Carport",
  keller: "Keller / Abstellraum",
  lager: "Lager / Hobbyraum",
  ferienwohnung: "Ferienwohnung",
  sonstiges: "Sonstiges",
};

export const OBJECT_TYPES = {
  mfh: "Mehrfamilienhaus",
  efh: "Einfamilienhaus",
  etw: "Eigentumswohnung (WEG)",
  wgh: "Wohn- & Geschäftshaus",
  garagenhof: "Garagenhof / Stellplätze",
  ferien: "Ferienimmobilie",
  sonstiges: "Sonstiges",
};

// Ausgaben-Kategorien mit Anlage-V-Gruppe und Konten-Vorschlägen (mit Steuerberater abstimmen!)
export const EXPENSE_CATEGORIES = {
  erhaltung:     { label: "Erhaltung / Reparaturen",            av: "erhaltung",   skr03: "4260", skr04: "6335" },
  grundsteuer:   { label: "Grundsteuer",                        av: "betrieb",     skr03: "4290", skr04: "6350", umlage: true },
  versorgung:    { label: "Wasser / Abwasser / Heizung / Strom",  av: "betrieb",     skr03: "4240", skr04: "6325", umlage: true },
  muell:         { label: "Müll / Straßenreinigung",            av: "betrieb",     skr03: "4290", skr04: "6350", umlage: true },
  reinigung:     { label: "Hausreinigung / Hausmeister / Garten", av: "betrieb",   skr03: "4250", skr04: "6330", umlage: true },
  versicherung:  { label: "Versicherungen (Gebäude, Haftpflicht)", av: "betrieb",  skr03: "4360", skr04: "6400", umlage: true },
  hausgeld:      { label: "Hausgeld WEG",                       av: "sonstige",    skr03: "4290", skr04: "6350" },
  verwaltung:    { label: "Verwaltung / Steuerberatung / Software", av: "verwaltung", skr03: "4950", skr04: "6825" },
  zinsen:        { label: "Schuldzinsen Darlehen",              av: "zinsen",      skr03: "2100", skr04: "7300" },
  fewo_reinigung:{ label: "Ferienwohnung: Reinigung / Wäsche",   av: "sonstige",    skr03: "4250", skr04: "6330" },
  fewo_provision:{ label: "Ferienwohnung: Portal-Provision",     av: "sonstige",    skr03: "4760", skr04: "6770" },
  fewo_ausstattung:{ label: "Ferienwohnung: Verbrauch / Ausstattung", av: "sonstige", skr03: "4980", skr04: "6850" },
  anmietung:     { label: "Miete an Vermieter (angemietete Objekte)", av: "sonstige", skr03: "4210", skr04: "6310" },
  fahrt:         { label: "Fahrtkosten",                        av: "sonstige",    skr03: "4670", skr04: "6670" },
  sonstiges:     { label: "Sonstige Werbungskosten",            av: "sonstige",    skr03: "4900", skr04: "6300" },
  herstellung:   { label: "Anschaffung / Herstellung (AfA – mit StB klären)", av: null, skr03: "0090", skr04: "0240" },
  tilgung:       { label: "Darlehenstilgung (nicht abziehbar)", av: null,          skr03: "0630", skr04: "3150" },
  privat:        { label: "Privat / nicht relevant",            av: null,          skr03: null,   skr04: null },
};

export const AV_GROUPS = {
  afa:        "Absetzung für Abnutzung (AfA Gebäude)",
  zinsen:     "Schuldzinsen",
  erhaltung:  "Erhaltungsaufwendungen",
  betrieb:    "Grundsteuer, Wasser, Müll, Heizung, Versicherungen, Hausreinigung u. ä.",
  verwaltung: "Verwaltungskosten",
  sonstige:   "Sonstige Werbungskosten",
};

export const INCOME_KINDS = {
  miete: "Miete (Soll-Monat)",
  nk_nachzahlung: "Nebenkosten-Nachzahlung",
  fewo: "Ferienwohnung / Rechnung",
  kaution: "Kaution (durchlaufend)",
  sonstige: "Sonstige Einnahme",
};

export const DEFAULT_ACCOUNTS = {
  "03": { bank: "1200", kasse: "1000", steuerfrei: "8100", kleinunternehmer: "8195", erl7: "8300", erl19: "8400", durchlaufend: "1590", sonstErtrag: "2700" },
  "04": { bank: "1800", kasse: "1600", steuerfrei: "4100", kleinunternehmer: "4185", erl7: "4300", erl19: "4400", durchlaufend: "1370", sonstErtrag: "4830" },
};

// ---------------------------------------------------------------- Mietverträge & Soll

export function contractActiveIn(contract, key) {
  const start = monthKey(contract.start);
  const end = contract.end ? monthKey(contract.end) : "9999-12";
  return !!start && key >= start && key <= end;
}

// Miete eines Monats inkl. Mietanpassungen (Staffel / Index / Erhöhung)
export function rentForMonth(contract, key) {
  let r = { kalt: contract.kalt || 0, nk: contract.nk || 0, extra: contract.extra || 0 };
  const steps = [...(contract.steps || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  for (const s of steps) if (s.from <= key) r = { kalt: s.kalt ?? r.kalt, nk: s.nk ?? r.nk, extra: s.extra ?? r.extra };
  // Gewerbliche Vermietung mit Umsatzsteuer: Beträge im Vertrag sind netto, die USt kommt obendrauf
  const net = r.kalt + r.nk + r.extra, rate = Number(contract.ustRate) || 0;
  const vat = rate ? Math.round((net * rate) / 100) : 0;
  return { ...r, net, rate, vat, total: net + vat };
}

export function sollIst(state, fromKey, toKey) {
  // Abgleich erst ab dem Monat, ab dem Zahlungen in der App erfasst werden (sonst Schein-Rückstände)
  const start = state.settings?.sollStart;
  const months = monthRange(start && start > fromKey ? start : fromKey, toKey);
  const rows = [];
  for (const c of state.contracts || []) {
    for (const key of months) {
      if (!contractActiveIn(c, key)) continue;
      const soll = rentForMonth(c, key).total;
      const ist = (state.payments || [])
        .filter((p) => p.kind === "miete" && p.contractId === c.id && p.period === key)
        .reduce((s, p) => s + p.amount, 0);
      rows.push({ contractId: c.id, key, soll, ist, diff: ist - soll });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- Zuordnung Bankumsätze

const MONTH_WORDS = ["januar", "februar", "maerz", "april", "mai", "juni", "juli", "august",
  "september", "oktober", "november", "dezember"];

// Ermittelt den Soll-Monat einer Mietzahlung: erst aus dem Verwendungszweck,
// sonst Zahlungen ab dem 20. als Vorauszahlung für den Folgemonat.
export function periodForPayment(dateIso, purpose = "") {
  const raw = String(purpose || "").replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, " "); // volle Datumsangaben ignorieren
  const p = normalize(raw);
  const y0 = Number(dateIso.slice(0, 4));
  const m = raw.match(/(?:^|[^\d])(0?[1-9]|1[0-2])\s?[./-]\s?(20\d{2}|\d{2})(?!\d)/); // "11/2026", "11.26"
  if (m) {
    let y = Number(m[2]); if (y < 100) y += 2000;
    if (Math.abs(y - y0) <= 1) return `${y}-${String(m[1]).padStart(2, "0")}`;
  }
  const mentionsRent = /miete|nutzungsentgelt|nk|nebenkosten/.test(p);
  // Monatsnamen: der zuletzt genannte gewinnt ("August Meier Miete November" → November)
  const re = new RegExp(`\\b(${MONTH_WORDS.join("|")})\\b(?:\\s(20\\d{2}))?`, "g");
  const hits = [...p.matchAll(re)].filter((mm) => mm[2] || mentionsRent);
  if (hits.length) {
    const mm = hits[hits.length - 1];
    const i = MONTH_WORDS.indexOf(mm[1]);
    let y = mm[2] ? Number(mm[2]) : y0;
    const txMonth = Number(dateIso.slice(5, 7));
    if (!mm[2] && i + 1 < txMonth - 6) y += 1; // "Januar" im Dezember gezahlt
    return `${y}-${String(i + 1).padStart(2, "0")}`;
  }
  const day = Number(dateIso.slice(8, 10));
  const key = monthKey(dateIso);
  return day >= 20 ? addMonths(key, 1) : key;
}

function nameScore(personName, text) {
  const tokens = normalize(personName).split(" ").filter((t) => t.length >= 3);
  if (!tokens.length) return 0;
  const hay = ` ${normalize(text)} `;
  const hits = tokens.filter((t) => hay.includes(` ${t} `));
  if (!hits.length) return 0;
  const last = tokens[tokens.length - 1];
  return hits.includes(last) ? (hits.length === tokens.length ? 1 : 0.8) : 0.4;
}

export function ruleKey(tx) {
  const iban = normIban(tx.iban);
  return iban ? `iban:${iban}` : `name:${normalize(tx.name)}`;
}

const DEBIT_KEYWORDS = [
  [/grundsteuer|grundbesitzabgabe/, "grundsteuer"],
  [/stadtwerke|wasser|abwasser|strom|energie|gas\b|fernwaerme|heizoel/, "versorgung"],
  [/abfall|muell|strassenreinigung/, "muell"],
  [/versicherung|allianz|huk|ergo|axa|gothaer|provinzial|r v\b/, "versicherung"],
  [/hausgeld|weg\b|wohnungseigentuemer/, "hausgeld"],
  [/hausverwaltung|steuerberat|datev|lexware|software/, "verwaltung"],
  [/zinsen|darlehen|kredit|baufinanz|annuitaet/, "zinsen"],
  [/handwerk|sanitaer|elektro|maler|dach|heizungsbau|reparatur|installateur|schluessel/, "erhaltung"],
  [/airbnb|booking com|provision|fewo direkt|vrbo|smoobu/, "fewo_provision"],
  [/reinigung|waescherei|waesche|hausmeister|garten/, "reinigung"],
];

// Ein Mieter zahlt mehrere Verträge (z. B. 2 Garagen à 70 €) mit einer Überweisung (140 €):
// Verträge derselben Person (gleiche IBAN oder gleicher Name, auch wenn der Mieter doppelt angelegt ist) suchen,
// deren Warmmieten zusammen genau den Betrag ergeben.
function multiContractCandidate(tx, state, text, rule, key) {
  const tenants = Object.fromEntries((state.tenants || []).map((t) => [t.id, t]));
  const period = periodForPayment(tx.date, tx.purpose);
  const mine = [];
  for (const c of state.contracts || []) {
    if (!contractActiveIn(c, period) && !contractActiveIn(c, key)) continue;
    const ibans = (c.tenantIds || []).flatMap((id) => (tenants[id]?.ibans || []).map(normIban));
    const ibanHit = !!tx.iban && ibans.includes(normIban(tx.iban));
    let ns = 0;
    for (const id of c.tenantIds || []) ns = Math.max(ns, nameScore(tenants[id]?.name, text));
    const ruleHit = !!rule?.contractIds?.includes(c.id);
    const soll = rentForMonth(c, period).total;
    if ((ibanHit || ns >= 0.8 || ruleHit) && soll > 0) mine.push({ c, ibanHit, ns, ruleHit, soll });
  }
  if (mine.length < 2 || mine.length > 10) return null;
  let best = null;
  for (let mask = 1; mask < 1 << mine.length; mask++) {
    const set = mine.filter((_, i) => mask & (1 << i));
    if (set.length < 2 || set.reduce((a, x) => a + x.soll, 0) !== tx.amount) continue;
    const ruleAll = !!rule?.contractIds && rule.contractIds.length === set.length && set.every((x) => x.ruleHit);
    const identity = ruleAll ? 80 : set.some((x) => x.ibanHit) ? 60 : Math.round(35 * Math.max(...set.map((x) => x.ns)));
    const score = Math.min(100, identity + 35 + (/miete|garage|stellplatz/.test(normalize(text)) ? 5 : 0));
    if (!best || score > best.score || (score === best.score && set.length > best.splits.length)) {
      best = { kind: "miete", period, contractId: set[0].c.id, splits: set.map((x) => ({ contractId: x.c.id, amount: x.soll })), score,
        why: [ruleAll ? "gelernte Regel" : set.some((x) => x.ibanHit) ? "IBAN des Mieters" : "Mietername", `Betrag = Summe von ${set.length} Verträgen`] };
    }
  }
  return best;
}

// Betrag auf mehrere Verträge verteilen: nach Warmmiete, Rest (Cent) auf den letzten
export function splitAmount(amount, solls) {
  const total = solls.reduce((a, b) => a + b, 0);
  if (!solls.length) return [];
  if (total === amount || total <= 0) return total === amount ? [...solls] : solls.map((_, i) => (i === solls.length - 1 ? amount - Math.floor(amount / solls.length) * (solls.length - 1) : Math.floor(amount / solls.length)));
  const parts = solls.map((s) => Math.floor((amount * s) / total));
  parts[parts.length - 1] += amount - parts.reduce((a, b) => a + b, 0);
  return parts;
}

// Liefert den besten Zuordnungs-Vorschlag mit Score 0..100 und Begründung.
export function suggestAssignment(tx, state) {
  const text = `${tx.name || ""} ${tx.purpose || ""}`;
  const rules = state.rules || {};
  const rule = rules[ruleKey(tx)];
  const tenants = Object.fromEntries((state.tenants || []).map((t) => [t.id, t]));
  const units = Object.fromEntries((state.units || []).map((u) => [u.id, u]));
  const key = monthKey(tx.date);

  if (tx.amount > 0) {
    const cands = [];
    // FeWo-Rechnungen
    for (const inv of state.invoices || []) {
      if (["storniert", "bezahlt", "entwurf"].includes(inv.status)) continue;
      const open = invoiceTotals(inv).gross - paidForInvoice(state, inv.id);
      let score = 0; const why = [];
      if (inv.number && normalize(text).includes(normalize(inv.number))) { score += 70; why.push("Rechnungsnr. im Verwendungszweck"); }
      if (open === tx.amount) { score += 30; why.push("Betrag = offener Rechnungsbetrag"); }
      const ns = Math.max(nameScore(inv.recipient?.name, text) || 0, nameScore(inv.recipient?.company, text) || 0);
      if (ns) { score += Math.round(30 * ns); why.push("Name passt"); }
      if (score) cands.push({ kind: "fewo", invoiceId: inv.id, score: Math.min(100, score), why });
    }
    // Mietverträge
    for (const c of state.contracts || []) {
      if (!contractActiveIn(c, key) && !contractActiveIn(c, addMonths(key, 1))) continue;
      let score = 0; const why = [];
      const ruleHit = rule && rule.kind === "miete" && rule.contractId === c.id;
      if (ruleHit) { score += 80; why.push("gelernte Regel"); }
      const ibans = (c.tenantIds || []).flatMap((id) => (tenants[id]?.ibans || []).map(normIban));
      if (tx.iban && ibans.includes(normIban(tx.iban))) { score += 60; why.push("IBAN des Mieters"); }
      let ns = 0;
      for (const id of c.tenantIds || []) ns = Math.max(ns, nameScore(tenants[id]?.name, text));
      if (ns) { score += Math.round(35 * ns); why.push("Mietername"); }
      const period = periodForPayment(tx.date, tx.purpose);
      const soll = rentForMonth(c, period).total;
      if (soll && tx.amount === soll) { score += 30; why.push("Betrag = Warmmiete"); }
      else if (soll && Math.abs(tx.amount - soll) <= soll * 0.02) { score += 10; why.push("Betrag ≈ Warmmiete"); }
      const u = units[c.unitId];
      if (u && u.name && normalize(text).includes(normalize(u.name))) { score += 10; why.push("Einheit genannt"); }
      if (/miete|nutzungsentgelt/.test(normalize(text))) { score += 5; }
      if (score >= 30) cands.push({ kind: "miete", contractId: c.id, period, score: Math.min(100, score), why });
    }
    const multi = multiContractCandidate(tx, state, text, rule, key);
    if (multi) cands.push(multi);
    if (rule && rule.kind !== "miete") cands.push({ ...rule, score: 85, why: ["gelernte Regel"] });
    if (/kaution/.test(normalize(text))) cands.push({ kind: "kaution", score: 40, why: ["Stichwort Kaution"] });
    cands.sort((a, b) => b.score - a.score);
    return cands[0] || null;
  }

  // Ausgaben
  if (rule && rule.kind === "ausgabe") return { ...rule, score: 90, why: ["gelernte Regel"] };
  // Miete an den Vermieter eines angemieteten Objekts (Name oder Betrag)
  for (const o of state.objects || []) {
    if (o.ownership !== "angemietet") continue;
    const ns = o.landlordName ? nameScore(o.landlordName, text) : 0;
    const amt = o.leaseRent && -tx.amount === o.leaseRent;
    if (ns >= 0.8 || (amt && (ns || /miete|pacht/.test(normalize(text))))) return { kind: "ausgabe", category: "anmietung", objectId: o.id, score: ns && amt ? 90 : 70, why: [ns ? "Name des Vermieters" : "", amt ? "Betrag = Miete" : ""].filter(Boolean) };
  }
  if (rule && rule.kind === "ignorieren") return { kind: "ignorieren", score: 90, why: ["gelernte Regel"] };
  const n = normalize(text);
  for (const [re, cat] of DEBIT_KEYWORDS) {
    if (re.test(n)) return { kind: "ausgabe", category: cat, objectId: null, score: 45, why: ["Stichwort im Text"] };
  }
  return null;
}

// ---------------------------------------------------------------- Rechnungen

export function invoiceTotals(inv) {
  const byRate = {};
  let gross = 0, passThrough = 0;
  for (const l of inv.lines || []) {
    const lineGross = Math.round((Number(l.qty) || 0) * (l.price || 0));
    gross += lineGross;
    if (l.passThrough) { passThrough += lineGross; continue; }
    const rate = inv.kleinunternehmer ? 0 : Number(l.vat) || 0;
    byRate[rate] = (byRate[rate] || 0) + lineGross;
  }
  const taxes = Object.entries(byRate).map(([rate, g]) => {
    const r = Number(rate);
    const net = Math.round(g / (1 + r / 100));
    return { rate: r, gross: g, net, vat: g - net };
  }).sort((a, b) => a.rate - b.rate);
  const net = taxes.reduce((s, t) => s + t.net, 0);
  const vat = taxes.reduce((s, t) => s + t.vat, 0);
  return { gross, net, vat, taxes, passThrough };
}

export function paidForInvoice(state, invoiceId) {
  return (state.payments || []).filter((p) => p.invoiceId === invoiceId).reduce((s, p) => s + p.amount, 0);
}

export function nextInvoiceNumber(settings, dateIso) {
  const year = (dateIso || new Date().toISOString()).slice(0, 4);
  const prefix = (settings.invoicePrefix || "RE-{JJJJ}-").replace("{JJJJ}", year);
  const counters = settings.invoiceCounters || {};
  const n = (counters[year] || 0) + 1;
  return { number: `${prefix}${String(n).padStart(4, "0")}`, year, n };
}

// Rechnungspositionen aus einer Ferienwohnungs-Buchung
export function linesFromBooking(b, unit) {
  const nights = nightsBetween(b.from, b.to);
  const lines = [];
  const lodging = b.total || (b.pricePerNight || 0) * nights;
  if (nights > 0 && lodging) {
    lines.push({ desc: `Übernachtung ${unit?.name || "Ferienwohnung"} (${nights} Nächte)`, qty: nights, price: Math.round(lodging / nights), vat: 7 });
    const diff = lodging - Math.round(lodging / nights) * nights;
    if (diff) lines.push({ desc: "Rundungsausgleich Übernachtung", qty: 1, price: diff, vat: 7 });
  }
  if (b.cleaning) lines.push({ desc: "Endreinigung", qty: 1, price: b.cleaning, vat: 7 });
  for (const x of b.extras || []) lines.push({ desc: x.desc, qty: x.qty || 1, price: x.price || 0, vat: x.vat ?? 19 });
  const taxable = Number(b.adults || 0) + Number(b.taxableChildren || 0);
  if (b.kurtaxe && taxable && nights) {
    lines.push({ desc: `Kurtaxe / Gästebeitrag (${taxable} Pers. × ${nights} Nächte)`, qty: taxable * nights, price: b.kurtaxe, vat: 0, passThrough: true });
  }
  return lines;
}

export function bookingsOverlap(a, b) {
  return a.unitId === b.unitId && a.id !== b.id && a.status !== "storniert" && b.status !== "storniert" &&
    a.from < b.to && b.from < a.to;
}

// ---------------------------------------------------------------- AfA & Anlage V

export function afaForYear(obj, year) {
  if (obj.ownership === "angemietet") return 0; // nur angemietet – keine Gebäude-AfA
  const basis = obj.buildingShare || 0;
  const rate = Number(obj.afaRate) || 0;
  if (!basis || !rate || !obj.purchaseDate) return 0;
  const startY = Number(obj.purchaseDate.slice(0, 4));
  const startM = Number(obj.purchaseDate.slice(5, 7));
  if (year < startY) return 0;
  const yearly = Math.round(basis * rate / 100);
  let used = 0;
  for (let y = startY; y <= year; y++) {
    let amount = y === startY ? Math.round(yearly * (13 - startM) / 12) : yearly;
    amount = Math.min(amount, basis - used);
    if (y === year) return Math.max(0, amount);
    used += amount;
  }
  return 0;
}

function objectIdOfPayment(state, p) {
  if (p.objectId) return p.objectId;
  const units = state.units || [];
  if (p.contractId) {
    const c = (state.contracts || []).find((x) => x.id === p.contractId);
    return units.find((u) => u.id === c?.unitId)?.objectId || null;
  }
  if (p.invoiceId) {
    const inv = (state.invoices || []).find((x) => x.id === p.invoiceId);
    const unitId = inv?.unitId || (state.bookings || []).find((b) => b.id === inv?.bookingId)?.unitId;
    return units.find((u) => u.id === unitId)?.objectId || null;
  }
  return null;
}

// Zerlegt eine Zahlung in steuerliche Bestandteile (für Anlage V und DATEV).
export function splitPayment(state, p) {
  const parts = [];
  if (p.kind === "miete" && p.contractId) {
    const c = (state.contracts || []).find((x) => x.id === p.contractId);
    const r = c ? rentForMonth(c, p.period || monthKey(p.date)) : null;
    if (r && r.total) {
      const nk = Math.round(p.amount * r.nk / r.total);
      parts.push({ type: "kalt", amount: p.amount - nk, vat: unitVat(state, c) });
      if (nk) parts.push({ type: "umlage", amount: nk, vat: unitVat(state, c) });
    } else parts.push({ type: "kalt", amount: p.amount, vat: 0 });
  } else if (p.kind === "nk_nachzahlung") {
    const c = (state.contracts || []).find((x) => x.id === p.contractId);
    parts.push({ type: "umlage", amount: p.amount, vat: c ? unitVat(state, c) : 0 });
  } else if (p.kind === "fewo" && p.invoiceId) {
    const inv = (state.invoices || []).find((x) => x.id === p.invoiceId);
    const t = inv ? invoiceTotals(inv) : null;
    if (t && t.gross) {
      let rest = p.amount;
      const shares = [...t.taxes.map((x) => ({ type: "fewo", vat: x.rate, g: x.gross, ku: !!inv.kleinunternehmer })),
        ...(t.passThrough ? [{ type: "durchlaufend", vat: 0, g: t.passThrough }] : [])];
      shares.forEach((s, i) => {
        const amt = i === shares.length - 1 ? rest : Math.round(p.amount * s.g / t.gross);
        rest -= amt;
        parts.push({ type: s.type, amount: amt, vat: s.vat, kleinunternehmer: s.ku });
      });
    } else parts.push({ type: "fewo", amount: p.amount, vat: 7 });
  } else if (p.kind === "kaution") {
    parts.push({ type: "kaution", amount: p.amount, vat: 0 });
  } else {
    parts.push({ type: "sonstige", amount: p.amount, vat: 0 });
  }
  return parts;
}

function unitVat(state, contract) {
  return vatFor(state, contract).vat; // Wohnraum steuerfrei, separat vermietete Stellplätze 19 % (§ 4 Nr. 12 UStG)
}

const inYear = (iso, year) => iso && iso.slice(0, 4) === String(year);

export function anlageV(state, year) {
  const objects = [...(state.objects || []), { id: null, name: "Ohne Objektzuordnung" }];
  const result = objects.map((o) => ({
    objectId: o.id, name: o.name, angemietet: o.ownership === "angemietet",
    income: { kalt: 0, umlage: 0, fewo: 0, sonstige: 0 },
    costs: Object.fromEntries(Object.keys(AV_GROUPS).map((k) => [k, 0])),
  }));
  const byId = Object.fromEntries(result.map((r) => [r.objectId ?? "_", r]));
  for (const p of state.payments || []) {
    if (!inYear(p.date, year)) continue; // Zuflussprinzip (§ 11 EStG)
    const r = byId[objectIdOfPayment(state, p) ?? "_"] || byId._;
    for (const part of splitPayment(state, p)) {
      const net = part.vat && !part.kleinunternehmer ? Math.round(part.amount / (1 + part.vat / 100)) : part.amount;
      if (part.type === "kalt") r.income.kalt += net;
      else if (part.type === "umlage") r.income.umlage += net;
      else if (part.type === "fewo") r.income.fewo += net;
      else if (part.type === "sonstige") r.income.sonstige += net;
    }
  }
  for (const e of state.expenses || []) {
    const cat = EXPENSE_CATEGORIES[e.category];
    if (!cat || !cat.av) continue;
    // Erhaltungsaufwand kann auf 2–5 Jahre verteilt werden (§ 82b EStDV)
    const n = cat.av === "erhaltung" ? Math.min(5, Math.max(1, Number(e.distribute) || 1)) : 1;
    const start = Number(e.date.slice(0, 4));
    if (year < start || year >= start + n) continue;
    const part = n === 1 ? e.amount : year === start + n - 1 ? e.amount - Math.floor(e.amount / n) * (n - 1) : Math.floor(e.amount / n);
    const r = byId[e.objectId ?? "_"] || byId._;
    r.costs[cat.av] += part;
  }
  for (const o of state.objects || []) byId[o.id].costs.afa += afaForYear(o, year);
  for (const r of result) {
    r.incomeTotal = Object.values(r.income).reduce((a, b) => a + b, 0);
    r.costTotal = Object.values(r.costs).reduce((a, b) => a + b, 0);
    r.result = r.incomeTotal - r.costTotal;
  }
  return result.filter((r) => r.objectId !== null || r.incomeTotal || r.costTotal);
}

// ---------------------------------------------------------------- DATEV-Export (EXTF Buchungsstapel)

export function accountsFor(settings) {
  const skr = settings.skr === "04" ? "04" : "03";
  return { ...DEFAULT_ACCOUNTS[skr], ...(settings.accounts?.[skr] || {}) };
}

export function expenseAccount(settings, category) {
  const skr = settings.skr === "04" ? "04" : "03";
  const custom = settings.expenseAccounts?.[skr]?.[category];
  return custom || EXPENSE_CATEGORIES[category]?.[`skr${skr}`] || null;
}

// Erzeugt Buchungssätze aus Zahlungen und Ausgaben im Zeitraum.
export function datevRows(state, fromIso, toIso) {
  const settings = state.settings || {};
  const acc = accountsFor(settings);
  const objName = (id) => (state.objects || []).find((o) => o.id === id)?.short || (state.objects || []).find((o) => o.id === id)?.name || "";
  const rows = [];
  const inRange = (d) => d >= fromIso && d <= toIso;
  for (const p of state.payments || []) {
    if (!inRange(p.date)) continue;
    const money = p.txId ? acc.bank : acc.kasse;
    const oid = objectIdOfPayment(state, p);
    const inv = p.invoiceId ? (state.invoices || []).find((x) => x.id === p.invoiceId) : null;
    const c = p.contractId ? (state.contracts || []).find((x) => x.id === p.contractId) : null;
    const tenant = c ? (state.tenants || []).find((t) => t.id === c.tenantIds?.[0]) : null;
    for (const part of splitPayment(state, p)) {
      if (!part.amount) continue;
      let gegen;
      if (part.type === "kaution") continue; // Kaution ist kein Ertrag
      if (part.type === "durchlaufend") gegen = acc.durchlaufend;
      else if (part.kleinunternehmer) gegen = acc.kleinunternehmer;
      else if (part.type === "sonstige") gegen = acc.sonstErtrag;
      else gegen = part.vat === 7 ? acc.erl7 : part.vat === 19 ? acc.erl19 : acc.steuerfrei;
      const label = { kalt: "Miete", umlage: "NK-Vorauszahlung", fewo: "FeWo", durchlaufend: "Kurtaxe", sonstige: "Einnahme" }[part.type];
      const who = inv?.recipient?.company || inv?.recipient?.name || tenant?.name || p.note || "";
      rows.push({
        amount: part.amount, sh: "S", konto: money, gegen, date: p.date,
        beleg: inv?.number || (p.period ? `M${p.period.replace("-", "")}` : ""),
        text: [objName(oid), label, p.period ? p.period.slice(5) + "/" + p.period.slice(0, 4) : "", who].filter(Boolean).join(" "),
      });
    }
  }
  for (const e of state.expenses || []) {
    if (!inRange(e.date)) continue;
    const gegen = expenseAccount(settings, e.category);
    if (!gegen || e.category === "privat") continue;
    rows.push({
      amount: e.amount, sh: "H", konto: e.txId ? acc.bank : acc.kasse, gegen, date: e.date,
      beleg: e.belegNr || "",
      text: [objName(e.objectId), EXPENSE_CATEGORIES[e.category]?.label.split(" (")[0], e.vendor].filter(Boolean).join(" "),
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;

export function datevCsv(state, fromIso, toIso, now = new Date()) {
  const s = state.settings || {};
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  const created = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
  const skr = s.skr === "04" ? "04" : "03";
  const header = [
    q("EXTF"), 700, 21, q("Buchungsstapel"), 13, created, "", q("RE"), q("Homevio"), q(""),
    s.datevBerater || "", s.datevMandant || "", `${fromIso.slice(0, 4)}0101`, s.datevKontenlaenge || 4,
    fromIso.replace(/-/g, ""), toIso.replace(/-/g, ""), q(`Immobilien ${fromIso.slice(0, 7)} bis ${toIso.slice(0, 7)}`), q(""),
    1, 0, 0, q("EUR"), "", q(""), "", "", q(skr), "", "", q(""), q(""),
  ].join(";");
  const cols = ["Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz",
    "WKZ Basis-Umsatz", "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1",
    "Belegfeld 2", "Skonto", "Buchungstext"].join(";");
  const lines = datevRows(state, fromIso, toIso).map((r) => [
    fmtNum(r.amount).replace(/\./g, ""), q(r.sh), q("EUR"), "", "", q(""), r.konto, r.gegen, q(""),
    r.date.slice(8, 10) + r.date.slice(5, 7), q(String(r.beleg).replace(/[^A-Za-z0-9$&%*+\-/]/g, "").slice(0, 36)),
    q(""), "", q(r.text.slice(0, 60)),
  ].join(";"));
  return [header, cols, ...lines].join("\r\n") + "\r\n";
}

// DATEV erwartet ANSI (Windows-1252)
export function toWin1252(str) {
  const special = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94 };
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i], c = ch.charCodeAt(0);
    out[i] = special[ch] ?? (c < 256 ? c : 0x3f);
  }
  return out;
}

// ---------------------------------------------------------------- Bank-Import (CSV & CAMT.053)

export function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const firstLines = text.split(/\r?\n/).slice(0, 30).join("\n");
  const delim = (firstLines.match(/;/g) || []).length >= (firstLines.match(/,/g) || []).length ? ";" :
    (firstLines.match(/\t/g) || []).length > (firstLines.match(/,/g) || []).length ? "\t" : ",";
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}

const COLS = {
  date: [/^buchungstag$/, /^buchungsdatum$/, /^buchung$/, /^datum$/, /^wertstellung$/, /^valuta(datum)?$/, /buchungstag/, /datum/],
  amount: [/^betrag( \(eur\)| eur|\(€\))?$/, /^betrag/, /^umsatz/, /betrag/],
  credit: [/^haben$/, /eingang/, /gutschrift/],
  debit: [/^soll$/, /ausgang/, /lastschrift/],
  name: [/beguenstigter|zahlungspflichtiger|zahlungsbeteiligter|auftraggeber|empfaenger|gegenpartei|name/],
  iban: [/iban/, /kontonummer/],
  purpose: [/verwendungszweck/, /buchungstext/, /beschreibung/, /zweck/],
};

export function detectCsv(rows) {
  let headerIdx = rows.findIndex((r) => {
    const n = r.map(normalize);
    return n.some((c) => /datum|buchungstag|buchung/.test(c)) && n.some((c) => /betrag|umsatz|soll|haben/.test(c));
  });
  if (headerIdx < 0) headerIdx = 0;
  const headers = rows[headerIdx].map(normalize);
  const used = new Set();
  const mapping = {};
  for (const [field, patterns] of Object.entries(COLS)) {
    for (const re of patterns) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(h));
      if (i > -1) { mapping[field] = i; used.add(i); break; }
    }
  }
  if (mapping.amount !== undefined) { delete mapping.credit; delete mapping.debit; }
  return { headerIdx, headers: rows[headerIdx], mapping };
}

export function txFromCsv(rows, headerIdx, mapping, accountId) {
  const out = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const date = parseDate(r[mapping.date]);
    if (!date) continue;
    let amount;
    if (mapping.amount !== undefined) amount = parseAmount(r[mapping.amount]);
    else amount = parseAmount(r[mapping.credit]) - Math.abs(parseAmount(r[mapping.debit]));
    if (!amount) continue;
    out.push(makeTx({
      accountId, date, amount,
      name: r[mapping.name] || "", iban: r[mapping.iban] || "", purpose: r[mapping.purpose] || "",
    }));
  }
  return out;
}

export function makeTx(t) {
  const tx = { id: uid("tx_"), link: null, ...t, iban: normIban(t.iban).replace(/[^A-Z0-9]/g, "") };
  tx.hash = [tx.accountId, tx.date, tx.amount, normalize(tx.name), normalize(tx.purpose).slice(0, 80)].join("|");
  return tx;
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? m[1] : "";
}
const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();

export function parseCamt(xml, accountId) {
  const out = [];
  const entries = xml.match(/<(?:\w+:)?Ntry>[\s\S]*?<\/(?:\w+:)?Ntry>/g) || [];
  for (const e of entries) {
    const amt = parseAmount(strip(tag(e, "Amt")).replace(",", "."));
    const credit = strip(tag(e, "CdtDbtInd")) === "CRDT";
    const date = parseDate(strip(tag(tag(e, "BookgDt"), "Dt")) || strip(tag(tag(e, "BookgDt"), "DtTm")) || strip(tag(tag(e, "ValDt"), "Dt")));
    const parties = tag(e, "RltdPties");
    const other = credit ? (tag(parties, "Dbtr") || tag(parties, "UltmtDbtr")) : (tag(parties, "Cdtr") || tag(parties, "UltmtCdtr"));
    const otherAcct = credit ? tag(parties, "DbtrAcct") : tag(parties, "CdtrAcct");
    const name = strip(tag(other, "Nm"));
    const iban = strip(tag(otherAcct, "IBAN"));
    const purpose = strip(tag(tag(e, "RmtInf"), "Ustrd") || tag(e, "AddtlNtryInf"));
    if (!date || !amt) continue;
    out.push(makeTx({ accountId, date, amount: credit ? Math.abs(amt) : -Math.abs(amt), name, iban, purpose }));
  }
  return out;
}

// ---------------------------------------------------------------- Hilfen Zeiträume

export function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const daysIncl = (from, to) => (from && to && to >= from ? nightsBetween(from, to) + 1 : 0);

export function overlapNights(b, fromIso, toIso) {
  const a = b.from > fromIso ? b.from : fromIso, z = b.to < toIso ? b.to : toIso;
  return a < z ? nightsBetween(a, z) : 0;
}

// Tage, die ein Vertrag im Zeitraum [from, to] (inkl.) läuft
export function contractDays(c, from, to) {
  const a = c.start > from ? c.start : from;
  const z = c.end && c.end < to ? c.end : to;
  return daysIncl(a, z);
}

// ---------------------------------------------------------------- Nebenkostenabrechnung (BetrKV)

export const NK_KEYS = {
  flaeche: "Wohnfläche (m²)",
  personen: "Personen (Personentage)",
  einheiten: "Wohneinheiten",
  verbrauch: "Verbrauch (Zähler)",
  heizkosten: "Heizkosten-VO (Grund-/Verbrauchsanteil)",
  direkt: "Direkt je Einheit",
};

// Kostenarten nach § 2 BetrKV (nur umlegbar, wenn im Mietvertrag vereinbart)
export const BETRKV = [
  ["grundsteuer", "Grundsteuer", "flaeche"],
  ["wasser", "Wasserversorgung", "personen"],
  ["abwasser", "Entwässerung / Abwasser", "personen"],
  ["heizung", "Heizung (Brennstoff, Wartung, Betriebsstrom, Messung)", "heizkosten"],
  ["warmwasser", "Warmwasser", "heizkosten"],
  ["aufzug", "Aufzug", "flaeche"],
  ["strassenreinigung", "Straßenreinigung", "flaeche"],
  ["muell", "Müllbeseitigung", "personen"],
  ["gebaeudereinigung", "Gebäudereinigung / Ungezieferbekämpfung", "flaeche"],
  ["garten", "Gartenpflege", "flaeche"],
  ["allgemeinstrom", "Beleuchtung / Allgemeinstrom", "flaeche"],
  ["schornstein", "Schornsteinreinigung", "flaeche"],
  ["versicherung", "Sach- und Haftpflichtversicherung", "flaeche"],
  ["hauswart", "Hauswart", "flaeche"],
  ["antenne", "Gemeinschaftsantenne / Kabel", "einheiten"],
  ["waesche", "Einrichtungen der Wäschepflege", "einheiten"],
  ["sonstige", "Sonstige Betriebskosten (im Vertrag benannt)", "flaeche"],
];

// Vorschlag für die Kostenpositionen aus den erfassten Ausgaben
export function nkItemsFromExpenses(state, objectId, from, to) {
  const map = { grundsteuer: "grundsteuer", versorgung: "wasser", muell: "muell", reinigung: "gebaeudereinigung", versicherung: "versicherung" };
  const items = {};
  for (const e of state.expenses || []) {
    if (e.objectId !== objectId || e.date < from || e.date > to) continue;
    const kind = e.betrkv && e.betrkv !== "keine" ? e.betrkv : map[e.category];
    if (!kind || !BETRKV.some((x) => x[0] === kind)) continue;
    const amount = typeof e.umlageAmount === "number" ? e.umlageAmount : e.amount; // nur der umlagefähige Anteil
    if (!amount) continue;
    const def = BETRKV.find((x) => x[0] === kind);
    items[kind] = items[kind] || { kind, label: def[1], amount: 0, key: def[2], pct: 70, shares: {}, umlage: true, expenseIds: [] };
    items[kind].amount += amount;
    items[kind].expenseIds.push(e.id);
  }
  return Object.values(items);
}

// Berechnet die Abrechnung tagegenau je Mietvertrag; Leerstand trägt der Vermieter.
export const NK_UNIT_TYPES = (u) => nkParticipates(u); // je Einheit einstellbar; Garagen/Stellplätze/Keller standardmäßig nicht

export function nkAbrechnung(state, { objectId, from, to, items }) {
  const units = (state.units || []).filter((u) => u.objectId === objectId && NK_UNIT_TYPES(u));
  const P = daysIncl(from, to);
  const segs = []; // {unitId, contractId|null, days, persons}
  for (const u of units) {
    let used = 0;
    for (const c of state.contracts || []) {
      if (c.unitId !== u.id) continue;
      const days = contractDays(c, from, to);
      if (!days) continue;
      segs.push({ unitId: u.id, contractId: c.id, days, persons: Number(c.persons) || 1 });
      used += days;
    }
    if (used < P) segs.push({ unitId: u.id, contractId: null, days: P - used, persons: 0 });
  }
  const unitWeight = (key, item) => {
    const w = {};
    for (const u of units) {
      if (key === "flaeche") w[u.id] = Number(u.area) || 0;
      else if (key === "einheiten") w[u.id] = 1;
      else w[u.id] = Number(item.shares?.[u.id]) || 0; // verbrauch / direkt
    }
    return w;
  };
  // verteilt einen Betrag nach Einheiten-Gewicht und innerhalb der Einheit nach Tagen
  const distribute = (amount, key, item) => {
    const raw = segs.map(() => 0);
    if (!amount) return raw;
    if (key === "personen") {
      const W = segs.reduce((s, x) => s + x.persons * x.days, 0);
      if (W) segs.forEach((x, i) => { raw[i] = amount * x.persons * x.days / W; });
      return raw;
    }
    if (key === "direkt") {
      segs.forEach((x, i) => { raw[i] = (Number(item.shares?.[x.unitId]) || 0) * x.days / P; });
      return raw;
    }
    const w = unitWeight(key, item);
    const W = Object.values(w).reduce((a, b) => a + b, 0);
    if (!W) return raw;
    segs.forEach((x, i) => { raw[i] = amount * (w[x.unitId] / W) * (x.days / P); });
    return raw;
  };
  const perSeg = segs.map(() => []);
  const warnings = [];
  const ownerExtra = items.map(() => 0);
  const co2Info = [];
  for (const [idx, item] of items.entries()) {
    let amount = item.key === "direkt" ? units.reduce((s, u) => s + (Number(item.shares?.[u.id]) || 0), 0) : item.amount;
    if (item.co2Cost > 0) { // CO2-Kostenaufteilungsgesetz: Vermieteranteil vorab abziehen
      const sp = co2Split(Math.min(item.co2Cost, amount), Number(item.co2Kg) || 0, !item.nonResidential);
      if (!item.co2Kg && !item.nonResidential) warnings.push(`${item.label}: CO2-Ausstoß (kg CO2/m²/Jahr) fehlt – ohne Angabe trägt der Vermieter im Zweifel 95 % der CO2-Kosten.`);
      amount -= sp.landlord; ownerExtra[idx] = sp.landlord; co2Info[idx] = sp;
    }
    let raw;
    const hasShares = Object.values(item.shares || {}).some(Number);
    if (item.key === "heizkosten" && hasShares) {
      const pct = Math.min(70, Math.max(50, Number(item.pct) || 70));
      const a = distribute(amount * (100 - pct) / 100, "flaeche", item);
      const b = distribute(amount * pct / 100, "verbrauch", item);
      raw = a.map((v, i) => v + b[i]);
    } else if ((item.key === "heizkosten" || item.key === "verbrauch") && !hasShares) {
      // Ohne Verbrauchswerte: Verteilung nach Fläche (statt Kosten beim Vermieter zu belassen)
      raw = distribute(amount, "flaeche", item);
      warnings.push(item.key === "heizkosten"
        ? `${item.label}: Keine Verbrauchswerte – nach Wohnfläche verteilt. Mieter dürfen ihren Heizkostenanteil dann um 15 % kürzen (§ 12 HeizkostenV); Verbrauchswerte bzw. Zählerstände nachtragen.`
        : `${item.label}: Keine Verbrauchswerte – nach Wohnfläche verteilt. Verbrauchswerte bzw. Zählerstände nachtragen, falls Zähler vorhanden.`);
    } else raw = distribute(amount, item.key, item);
    if (item.key === "flaeche" && !units.some((u) => Number(u.area))) warnings.push(`${item.label}: Bei den Einheiten fehlen die Wohnflächen.`);
    // runden; Rundungsdifferenz trägt der Vermieter
    const rounded = raw.map((v) => Math.round(v));
    const diff = amount - rounded.reduce((a, b) => a + b, 0);
    const ownerIdx = segs.findIndex((x) => !x.contractId);
    if (ownerIdx > -1) rounded[ownerIdx] += diff;
    else if (rounded.length) rounded[rounded.length - 1] += diff;
    rounded.forEach((v, i) => perSeg[i].push({ label: item.label, key: item.key, amount: v }));
  }
  const months = monthRange(monthKey(from), monthKey(to));
  const contracts = [];
  let owner = { items: items.map((it, i) => ({ label: it.label, amount: ownerExtra[i] })), total: ownerExtra.reduce((a, b) => a + b, 0), days: 0 };
  segs.forEach((x, i) => {
    const total = perSeg[i].reduce((s, it) => s + it.amount, 0);
    if (!x.contractId) {
      perSeg[i].forEach((it, k) => { owner.items[k].amount += it.amount; });
      owner.total += total; owner.days += x.days;
      return;
    }
    const c = (state.contracts || []).find((cc) => cc.id === x.contractId);
    const prepaid = (state.payments || [])
      .filter((p) => p.kind === "miete" && p.contractId === c.id && months.includes(p.period))
      .reduce((s, p) => s + splitPayment(state, p).filter((pt) => pt.type === "umlage").reduce((a, pt) => a + pt.amount, 0), 0);
    const activeMonths = months.filter((m) => contractActiveIn(c, m)).length || 1;
    contracts.push({
      contractId: c.id, unitId: x.unitId, days: x.days, persons: x.persons,
      items: perSeg[i], total, prepaid, saldo: total - prepaid, // > 0 Nachzahlung, < 0 Guthaben
      newMonthly: Math.ceil(total / activeMonths / 100) * 100,
      prepaidSoll: months.filter((m) => contractActiveIn(c, m)).reduce((s, m) => s + rentForMonth(c, m).nk, 0),
    });
  });
  const total = items.reduce((s, it) => s + (it.key === "direkt" ? units.reduce((a, u) => a + (Number(it.shares?.[u.id]) || 0), 0) : it.amount), 0);
  // § 556 Abs. 3 BGB: Zugang beim Mieter spätestens 12 Monate nach Ende des Abrechnungszeitraums
  const dk = addMonths(monthKey(to), 12);
  const deadline = `${dk}-${String(Math.min(Number(to.slice(8, 10)), daysInMonth(dk))).padStart(2, "0")}`;
  const check = contracts.reduce((s, c) => s + c.total, 0) + owner.total;
  return { from, to, days: P, contracts, owner, total, check, deadline, warnings, co2: co2Info, unitsUsed: units.map((u) => u.id) };
}

// ---------------------------------------------------------------- Ferienwohnung-Kennzahlen

export function fewoStats(state, unitIds, from, to) {
  const ids = new Set(unitIds);
  const all = (state.bookings || []).filter((b) => ids.has(b.unitId));
  const days = nightsBetween(from, to);
  const blocked = all.filter((b) => b.status === "eigennutzung").reduce((s, b) => s + overlapNights(b, from, to), 0);
  const active = all.filter((b) => !["storniert", "eigennutzung"].includes(b.status));
  const nights = active.reduce((s, b) => s + overlapNights(b, from, to), 0);
  const lodging = active.reduce((s, b) => { const n = nightsBetween(b.from, b.to); return s + (n ? Math.round((b.total || 0) * overlapNights(b, from, to) / n) : 0); }, 0);
  const available = Math.max(0, days * ids.size - blocked);
  const starting = all.filter((b) => b.from >= from && b.from < to && b.status !== "eigennutzung");
  const startActive = starting.filter((b) => b.status !== "storniert");
  return {
    nights, available, lodging,
    occupancy: available ? nights / available : 0,
    adr: nights ? Math.round(lodging / nights) : 0,
    revpar: available ? Math.round(lodging / available) : 0,
    avgStay: startActive.length ? startActive.reduce((s, b) => s + nightsBetween(b.from, b.to), 0) / startActive.length : 0,
    cancelRate: starting.length ? (starting.length - startActive.length) / starting.length : 0,
    directShare: startActive.length ? startActive.filter((b) => (b.channel || "Direkt") === "Direkt").length / startActive.length : 0,
    bookings: startActive.length,
  };
}

// ---------------------------------------------------------------- Steuerberater-Jahrespaket

export function parseOwners(text) {
  return String(text || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(.*?)[\s:]+(\d+(?:[.,]\d+)?)\s*%?$/);
    return m ? { name: m[1].trim(), share: Number(m[2].replace(",", ".")) } : { name: x, share: 100 };
  });
}

// Zuflüsse je Einheit und Kalendermonat (Kalt / Umlagen / FeWo netto)
export function incomeByUnitMonth(state, year) {
  const out = {};
  for (const p of state.payments || []) {
    if (!inYear(p.date, year)) continue;
    let unitId = null;
    if (p.contractId) unitId = (state.contracts || []).find((c) => c.id === p.contractId)?.unitId;
    else if (p.invoiceId) { const inv = (state.invoices || []).find((i) => i.id === p.invoiceId); unitId = inv?.unitId || (state.bookings || []).find((b) => b.id === inv?.bookingId)?.unitId; }
    const key = unitId || "_";
    const m = Number(p.date.slice(5, 7));
    out[key] = out[key] || {};
    out[key][m] = out[key][m] || { kalt: 0, umlage: 0, fewo: 0, sonstige: 0 };
    for (const part of splitPayment(state, p)) {
      const net = part.vat && !part.kleinunternehmer ? Math.round(part.amount / (1 + part.vat / 100)) : part.amount;
      if (out[key][m][part.type] !== undefined) out[key][m][part.type] += net;
    }
  }
  return out;
}

// Offene Punkte, die der Steuerberater sonst nachfragen würde
export function taxOpenPoints(state, year) {
  const pts = [];
  const y = String(year);
  const openTx = (state.transactions || []).filter((t) => !t.link && t.date.startsWith(y));
  if (openTx.length) pts.push(`${openTx.length} Bankumsätze ${y} sind noch nicht zugeordnet.`);
  const noObj = (state.expenses || []).filter((e) => e.date.startsWith(y) && !e.objectId && EXPENSE_CATEGORIES[e.category]?.av);
  if (noObj.length) pts.push(`${noObj.length} Ausgaben ohne Objektzuordnung.`);
  const noBeleg = (state.expenses || []).filter((e) => e.date.startsWith(y) && !e.belegNr && EXPENSE_CATEGORIES[e.category]?.av);
  if (noBeleg.length) pts.push(`${noBeleg.length} Ausgaben ohne Belegnummer – Belege beilegen bzw. nachreichen.`);
  const hk = (state.expenses || []).filter((e) => e.date.startsWith(y) && e.category === "herstellung");
  if (hk.length) pts.push(`${hk.length} Positionen als Anschaffung/Herstellung markiert – Erhaltungsaufwand oder AfA? (anschaffungsnaher Aufwand: 15 %-Grenze in 3 Jahren prüfen)`);
  for (const o of state.objects || []) {
    if (!o.buildingShare || !o.purchaseDate) pts.push(`${o.name}: Kaufdatum/Gebäudeanteil fehlt – AfA kann nicht berechnet werden.`);
    const owners = parseOwners(o.owners);
    if (owners.length > 1 && Math.round(owners.reduce((s, x) => s + x.share, 0)) !== 100) pts.push(`${o.name}: Miteigentumsanteile ergeben nicht 100 %.`);
  }
  for (const u of state.units || []) {
    const cs = (state.contracts || []).filter((c) => c.unitId === u.id).sort((a, b) => (a.start < b.start ? -1 : 1));
    for (let i = 1; i < cs.length; i++) {
      if (!cs[i - 1].end || cs[i - 1].end >= cs[i].start) pts.push(`${u.name}: Mietverträge überschneiden sich (Mieterwechsel prüfen).`);
    }
  }
  if ((state.units || []).some((u) => u.type === "ferienwohnung")) pts.push("Ferienwohnung: Einordnung gewerblich oder Vermögensverwaltung und Umsatzsteuer (Kleinunternehmer?) mit dem Steuerberater klären; Plattformen melden Umsätze (DAC7).");
  return pts;
}

// ---------------------------------------------------------------- Zählerstände & Mieterwechsel

export const METER_TYPES = { wasser_kalt: "Wasser kalt (m³)", wasser_warm: "Wasser warm (m³)", heizung: "Heizung (kWh / Einheiten)", strom: "Strom (kWh)", gas: "Gas (m³)", sonstiges: "Sonstiges" };

// Verbrauch einer Einheit im Zeitraum aus den Zählerständen (Ablesung zu Beginn → Ende)
export function consumptionFor(state, unitId, type, from, to) {
  const rs = (state.meterReadings || []).filter((r) => r.unitId === unitId && r.type === type && r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (rs.length < 2) return null;
  const startR = [...rs].reverse().find((r) => r.date <= from) || rs.find((r) => r.date >= from && r.date <= to);
  const endR = [...rs].reverse().find((r) => r.date <= addDaysIso(to, 45) && r.date > (startR?.date || ""));
  if (!startR || !endR) return null;
  return Math.max(0, Math.round((Number(endR.value) - Number(startR.value)) * 1000) / 1000);
}

// Prüft einen geplanten Mieterwechsel: Überschneidung oder Leerstand
export function checkMove(oldContract, moveOutDate, moveInDate) {
  const warnings = [];
  if (oldContract && moveOutDate && moveOutDate < oldContract.start) warnings.push("Auszug liegt vor dem Mietbeginn des bisherigen Mieters.");
  if (moveOutDate && moveInDate && moveInDate <= moveOutDate) warnings.push("Einzug muss nach dem Mietende des Vormieters liegen (sonst doppelte Miete/Nebenkosten).");
  const gap = moveOutDate && moveInDate ? nightsBetween(moveOutDate, moveInDate) - 1 : 0;
  return { warnings, vacancyDays: Math.max(0, gap) };
}

// ---------------------------------------------------------------- Live-Sync: iCal & Bank

// iCal (RFC 5545) einlesen: nur die Felder, die Portale liefern (Belegung, Kennung, Beschreibung)
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let ev = null;
  const val = (v) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  const date = (v) => { const m = v.match(/(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; };
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT") { if (ev?.from) events.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const name = line.slice(0, i).split(";")[0].toUpperCase(), v = line.slice(i + 1);
      if (name === "UID") ev.uid = v;
      else if (name === "DTSTART") ev.from = date(v);
      else if (name === "DTEND") ev.to = date(v);
      else if (name === "SUMMARY") ev.summary = val(v);
      else if (name === "DESCRIPTION") ev.description = val(v);
      else if (name === "STATUS") ev.status = v.toUpperCase();
    }
  }
  return events.map((e) => ({ ...e, to: e.to || addDaysIso(e.from, 1) }));
}

// Kalender eines Portals mit den Buchungen einer Ferienwohnung abgleichen (ohne Doppelungen)
export function mergeIcal(bookings, { unitId, feedId, channel, events, todayIso }) {
  const out = bookings.map((b) => ({ ...b }));
  const seen = new Set();
  let added = 0, updated = 0, cancelled = 0;
  for (const e of events) {
    if (e.status === "CANCELLED") continue;
    const blocked = /not available|blocked|blockiert|gesperrt/i.test(e.summary || "") && !/closed - not available/i.test(e.summary || "");
    const key = `${feedId}:${e.uid || e.from + e.to}`;
    seen.add(key);
    const code = (e.description || "").match(/details\/([A-Z0-9]{6,})/)?.[1] || "";
    const phone4 = (e.description || "").match(/Last 4 Digits\)?:\s*(\d{4})/i)?.[1] || "";
    const existing = out.find((b) => b.icalKey === key);
    if (existing) {
      if (existing.from !== e.from || existing.to !== e.to || existing.status === "storniert") { Object.assign(existing, { from: e.from, to: e.to, status: blocked ? "eigennutzung" : "bestaetigt" }); updated++; }
      continue;
    }
    // Schon über Smoobu oder manuell erfasst? Dann nur verknüpfen
    const twin = out.find((b) => b.unitId === unitId && b.from === e.from && b.to === e.to && b.status !== "storniert" && !b.icalKey);
    if (twin) { twin.icalKey = key; continue; }
    out.push({ id: `b_ical_${Math.random().toString(36).slice(2, 10)}`, unitId, guest: blocked ? "Blockiert (Portal)" : `${channel}-Gast${code ? " " + code : ""}`, from: e.from, to: e.to, adults: 0, children: 0, total: 0, cleaning: 0, kurtaxe: 0, channel, status: blocked ? "eigennutzung" : "bestaetigt", icalKey: key, note: [code && `Reservierung ${code}`, phone4 && `Tel. endet auf ${phone4}`].filter(Boolean).join(" · ") });
    added++;
  }
  // Im Kalender nicht mehr vorhanden → storniert (nur zukünftige)
  for (const b of out) {
    if (b.icalKey?.startsWith(feedId + ":") && !seen.has(b.icalKey) && b.from >= todayIso && b.status !== "storniert") { b.status = "storniert"; cancelled++; }
  }
  return { bookings: out, added, updated, cancelled };
}

// Live-Bankumsätze übernehmen (Duplikate über die Bank-Kennung bzw. Inhalt erkennen)
export function mergeBankTx(transactions, accountId, incoming) {
  const known = new Set(transactions.map((t) => t.extId || t.hash));
  const fresh = [];
  for (const t of incoming) {
    if (t.pending) continue; // nur gebuchte Umsätze
    const tx = makeTx({ accountId, date: t.date, amount: t.amount, name: t.name, iban: t.iban, purpose: t.purpose });
    if (t.extId) tx.extId = `${accountId}:${t.extId}`;
    const id = tx.extId || tx.hash;
    if (known.has(id) || known.has(tx.hash)) continue;
    // Bereits per CSV/CAMT importiert? (gleicher Betrag, ±1 Tag, gleiche IBAN bzw. gleicher Name)
    const twin = transactions.find((o) => !o.extId && o.accountId === accountId && o.amount === tx.amount && Math.abs(nightsBetween(o.date < tx.date ? o.date : tx.date, o.date < tx.date ? tx.date : o.date)) <= 1 &&
      ((o.iban && tx.iban && o.iban === tx.iban) || (normalize(o.name) && normalize(o.name) === normalize(tx.name))));
    if (twin) { twin.extId = tx.extId; known.add(id); continue; }
    known.add(id); fresh.push(tx);
  }
  return fresh;
}

// ---------------------------------------------------------------- Rechnungsempfänger (Gast oder Firma)
// recipient: { name, company, attn, street, zip, city, country, address (Altformat, Freitext), business, vatId, email }
const COUNTRY_DE = /^(de|deu|deutschland|germany)?$/i;

export function recipientLines(r = {}) {
  const out = [];
  if (r.company) {
    out.push(r.company);
    const person = r.attn || r.name;
    if (person) out.push(`z. Hd. ${person}`);
  } else if (r.name) out.push(r.name);
  if (r.street || r.zip || r.city) {
    if (r.street) out.push(r.street);
    const place = [r.zip, r.city].filter(Boolean).join(" ");
    if (place) out.push(place);
    if (r.country && !COUNTRY_DE.test(String(r.country).trim())) { const cc = String(r.country).trim().toUpperCase(); out.push(COUNTRY_NAMES[cc] || (cc.length === 2 ? cc : String(r.country).trim())); }
  } else if (r.address) out.push(...String(r.address).split(/\n/).map((x) => x.trim()).filter(Boolean));
  return out;
}

// Anzeigename in Listen
export const recipientName = (r = {}) => r.company || r.name || "";
export const recipientHasAddress = (r = {}) => !!((r.street && (r.zip || r.city)) || (r.address && r.address.trim()));

export function recipientFromBooking(b = {}) {
  return {
    name: b.guest || "", company: b.guestCompany || "", attn: "",
    street: b.guestStreet || "", zip: b.guestZip || "", city: b.guestCity || "", country: b.guestCountry || "",
    business: !!b.guestCompany, vatId: "", email: b.email || "",
  };
}

// Text für den Kanal-Hinweis auf der Rechnung
export function channelNote(b = {}) {
  if (!b.channel || b.channel === "Direkt") return "";
  return `Buchung über ${b.channel}${b.channelRef ? ` (Buchungsnr. ${b.channelRef})` : ""}.`;
}

// ---------------------------------------------------------------- Ablage: Dokumente eines Objekts nach Themen sortieren
// [Bezeichnung, Symbol, Suchwörter (Dateiname / Aussteller / Text)]
export const DOC_FOLDERS = {
  schornsteinfeger: ["Schornsteinfeger", "🧹", /schornstein|kaminkehr|kaminfeger|feuerstaett|feuerstätt|immissionsmess|bezirksschornstein/],
  nebenkosten: ["Nebenkostenabrechnungen", "🧾", /nebenkostenabrechnung|betriebskostenabrechnung|nk-?abrechnung|heizkostenabrechnung/],
  gas_heizung: ["Gas / Heizung / Öl", "🔥", /\bgas\b|erdgas|gasrechnung|heizoel|heizöl|heizung|fernwaerme|fernwärme|pellet|brenner|therme|heizkosten|ista|techem|brunata|minol/],
  strom: ["Strom", "⚡", /strom|elektrizit|eon\b|e\.on|vattenfall|enbw|rwe|stadtwerk.*strom|allgemeinstrom|zaehlerstand strom/],
  wasser: ["Wasser / Abwasser", "💧", /wasser|abwasser|kanal|niederschlag|entwaesser|entwässer/],
  muell: ["Müll / Straßenreinigung", "🗑", /muell|müll|abfall|entsorgung|strassenreinigung|straßenreinigung|winterdienst|awg|wbo/],
  grundsteuer: ["Grundsteuer / Abgaben", "🏛", /grundsteuer|grundbesitzabgab|abgabenbescheid|stadtkasse|gemeindekasse/],
  versicherung: ["Versicherungen", "🛡", /versicherung|police|allianz|huk|ergo|axa|gothaer|provinzial|wgv|generali|r\+v|signal iduna|beitragsrechnung/],
  hausmeister: ["Hausmeister / Reinigung / Garten", "🧽", /hausmeister|reinigung|treppenhaus|garten|baumpflege|rasen|hauswart/],
  wartung: ["Wartung / Prüfungen", "🔍", /wartung|rauchmelder|rauchwarn|legionell|e-?check|feuerloesch|feuerlösch|aufzug|tuev|tüv|pruefung|prüfung/],
  handwerker: ["Handwerker / Reparaturen", "🔧", /handwerk|reparatur|sanitaer|sanitär|installateur|elektriker|maler|dachdecker|tischler|schlosser|fliesen|glaser|rohrreinigung|notdienst|kostenvoranschlag|angebot/],
  hausgeld: ["Hausgeld / WEG", "🏢", /hausgeld|weg\b|eigentuemerversammlung|eigentümerversammlung|wirtschaftsplan|hausverwaltung|jahresabrechnung weg/],
  bank: ["Bank / Darlehen", "🏦", /darlehen|kredit|zinsbescheinigung|tilgung|bausparen|bauspar|kontoauszug|sparkasse|volksbank|bank/],
  steuer: ["Steuer / Finanzamt", "🧮", /finanzamt|steuerbescheid|einkommensteuer|umsatzsteuer|steuerberater|elster|anlage v/],
  mieter: ["Mietverträge / Mieter", "👥", /mietvertrag|\bmieter|uebergabe|übergabe|kaution|kuendigung|kündigung|selbstauskunft|wohnungsgeber|mieterhoehung|mieterhöhung/],
  kauf: ["Kauf / Notar / Grundbuch", "📜", /notar|kaufvertrag|grundbuch|teilungserklaerung|teilungserklärung|energieausweis|baugenehmigung|grundriss|flurkarte|expose|exposé/],
  fewo: ["Ferienwohnung", "🏖", /airbnb|booking|smoobu|kurtaxe|gaeste|gäste|ferienwohnung|fewo/],
  sonstiges: ["Sonstiges", "📁", null],
};

// Thema aus beliebigem Text (Dateiname, Aussteller, KI-Zusammenfassung) erraten
export function guessFolder(...texts) {
  const t = texts.filter(Boolean).join(" ").toLowerCase().replace(/[_\-.]+/g, " ");
  if (!t.trim()) return "sonstiges";
  for (const [k, [, , re]] of Object.entries(DOC_FOLDERS)) if (re && re.test(t)) return k;
  return "sonstiges";
}

// ---------------------------------------------------------------- Vergangene Mieten nachtragen
// Für jeden gewählten Vertrag und Monat den noch fehlenden Betrag (Soll − bereits erfasst) als Zahlung anlegen.
export function backfillPayments(state, { from, to, contractIds, day = 3, batch = "" }) {
  const out = [];
  if (!from || !to || from > to) return out;
  const ids = new Set(contractIds || []);
  for (const c of state.contracts || []) {
    if (!ids.has(c.id)) continue;
    for (const key of monthRange(from, to)) {
      if (!contractActiveIn(c, key)) continue;
      const soll = rentForMonth(c, key).total;
      const ist = (state.payments || []).filter((p) => p.kind === "miete" && p.contractId === c.id && p.period === key).reduce((s, p) => s + p.amount, 0);
      const missing = soll - ist;
      if (missing <= 0) continue;
      const dd = Math.min(Math.max(1, Number(day) || 1), daysInMonth(key));
      let date = `${key}-${String(dd).padStart(2, "0")}`;
      if (c.start > date) date = c.start;
      out.push({ id: uid("p_"), date, amount: missing, kind: "miete", contractId: c.id, period: key, invoiceId: null, objectId: null, txId: null, note: "nachgetragen", batch });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Ausländische Rechnungsempfänger
export const COUNTRY_NAMES = { AT: "ÖSTERREICH", CH: "SCHWEIZ", NL: "NIEDERLANDE", BE: "BELGIEN", LU: "LUXEMBURG", FR: "FRANKREICH", IT: "ITALIEN", ES: "SPANIEN", PT: "PORTUGAL", PL: "POLEN", CZ: "TSCHECHIEN", SK: "SLOWAKEI", HU: "UNGARN", SI: "SLOWENIEN", HR: "KROATIEN", RO: "RUMÄNIEN", BG: "BULGARIEN", GR: "GRIECHENLAND", DK: "DÄNEMARK", SE: "SCHWEDEN", FI: "FINNLAND", NO: "NORWEGEN", IE: "IRLAND", GB: "VEREINIGTES KÖNIGREICH", UK: "VEREINIGTES KÖNIGREICH", LT: "LITAUEN", LV: "LETTLAND", EE: "ESTLAND", TR: "TÜRKEI", US: "USA", UA: "UKRAINE" };
const VAT_RE = { AT: /^ATU\d{8}$/, BE: /^BE[01]\d{9}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/, CZ: /^CZ\d{8,10}$/, DE: /^DE\d{9}$/, DK: /^DK\d{8}$/, EE: /^EE\d{9}$/, EL: /^EL\d{9}$/, ES: /^ES[0-9A-Z]\d{7}[0-9A-Z]$/, FI: /^FI\d{8}$/, FR: /^FR[0-9A-Z]{2}\d{9}$/, HR: /^HR\d{11}$/, HU: /^HU\d{8}$/, IE: /^IE\d[0-9A-Z+*]\d{5}[A-Z]{1,2}$/, IT: /^IT\d{11}$/, LT: /^LT(\d{9}|\d{12})$/, LU: /^LU\d{8}$/, LV: /^LV\d{11}$/, MT: /^MT\d{8}$/, NL: /^NL\d{9}B\d{2}$/, PL: /^PL\d{10}$/, PT: /^PT\d{9}$/, RO: /^RO\d{2,10}$/, SE: /^SE\d{12}$/, SI: /^SI\d{8}$/, SK: /^SK\d{10}$/, XI: /^XI\d{9}$/, CHE: /^CHE\d{9}(MWST|TVA|IVA)?$/ };
export function normVatId(v) { return String(v || "").toUpperCase().replace(/[\s.\-]/g, ""); }
// true = Format passt, false = Format falsch, null = Land ohne Prüfregel
export function vatIdFormatOk(v) {
  const n = normVatId(v); if (!n) return null;
  const re = VAT_RE[n.slice(0, 3)] || VAT_RE[n.slice(0, 2)];
  return re ? re.test(n) : null;
}

// Angemietete Objekte: Miete an den Vermieter für vergangene Monate als Ausgabe nachtragen (nur fehlende Monate)
export function backfillLeaseExpenses(state, objectId, { from, to, day = 1 }) {
  const o = (state.objects || []).find((x) => x.id === objectId);
  if (!o?.leaseRent || !from || !to || from > to) return [];
  const out = [];
  for (const key of monthRange(from, to)) {
    if (o.leaseStart && key < o.leaseStart.slice(0, 7)) continue;
    if (o.leaseEnd && key > o.leaseEnd.slice(0, 7)) continue;
    if ((state.expenses || []).some((e) => e.objectId === objectId && e.category === "anmietung" && (e.period === key || e.date.slice(0, 7) === key))) continue;
    const dd = Math.min(Math.max(1, Number(day) || 1), daysInMonth(key));
    out.push({ id: uid("e_"), date: `${key}-${String(dd).padStart(2, "0")}`, period: key, amount: o.leaseRent, category: "anmietung", objectId, vendor: o.landlordName || "Vermieter", note: `Miete ${key}`, belegNr: "", fileIds: [] });
  }
  return out;
}
