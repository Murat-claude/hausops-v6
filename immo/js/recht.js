// Rechtliche Prüfungen (Stand November 2026) – reine Logik, in Node testbar.
// Ziel: Vermieterinteressen voll ausschöpfen, aber nur innerhalb der gesetzlichen Grenzen.
// Keine Rechtsberatung: Die App weist auf Grenzen hin und blockiert nichts, was im Einzelfall zulässig sein kann.
import { addMonths, monthKey, rentForMonth, nightsBetween, daysIncl } from "./core.js";

// ---------------------------------------------------------------- Einheiten

export const WOHNRAUM = ["wohnung", "haus"];
export const PARKING = ["garage", "stellplatz", "carport"];
export const NEBENRAUM = ["keller", "lager"];

export const isWohnraum = (u) => WOHNRAUM.includes(u?.type);
export const isParking = (u) => PARKING.includes(u?.type);

// Nimmt die Einheit an der Umlage der Hausnebenkosten teil? (Vorgabe, je Einheit änderbar)
export function nkParticipates(u) {
  if (typeof u?.nkUmlage === "boolean") return u.nkUmlage;
  return !PARKING.includes(u?.type) && !NEBENRAUM.includes(u?.type);
}

// Umsatzsteuer auf Miete einer Einheit (§ 4 Nr. 12 UStG):
// Wohnungen, Gewerbe, Keller/Lager steuerfrei (Option nach § 9 UStG bei Gewerbe möglich, dann unit.vat = 19);
// Fahrzeugstellplätze steuerpflichtig, außer als Nebenleistung zur Wohnungsvermietung an denselben Mieter.
export function vatFor(state, contract) {
  const u = (state.units || []).find((x) => x.id === contract?.unitId);
  if (!u) return { vat: 0, reason: "" };
  if (Number(contract?.ustRate)) return { vat: Number(contract.ustRate), reason: `Gewerblicher Mieter: Option zur Umsatzsteuer (§ 9 UStG) – Miete netto zzgl. ${contract.ustRate} % USt` };
  if (state.settings?.kleinunternehmer && !u.vat) return { vat: 0, reason: "Kleinunternehmer (§ 19 UStG)" };
  if (!isParking(u)) return { vat: Number(u.vat) || 0, reason: Number(u.vat) ? "Option zur Umsatzsteuer (§ 9 UStG)" : "steuerfrei (§ 4 Nr. 12 UStG)" };
  // Nebenleistung: derselbe Mieter mietet im selben Objekt Wohnraum beim selben Vermieter
  const tenantIds = new Set(contract.tenantIds || []);
  const overlaps = (c) => c.start <= (contract.end || "9999") && (!c.end || c.end >= contract.start);
  const living = (state.contracts || []).some((c) => c.id !== contract.id && overlaps(c) && (c.tenantIds || []).some((t) => tenantIds.has(t)) &&
    (() => { const w = (state.units || []).find((x) => x.id === c.unitId); return isWohnraum(w) && w.objectId === u.objectId; })());
  if (living) return { vat: 0, reason: "Nebenleistung zur Wohnungsvermietung – steuerfrei (§ 4 Nr. 12 UStG)" };
  return { vat: 19, reason: "Separat vermieteter Stellplatz/Garage – 19 % USt (§ 4 Nr. 12 S. 2 UStG). Bruttomiete enthält die USt." };
}

// ---------------------------------------------------------------- Kaution (§ 551 BGB)

export function depositCheck(unit, contract) {
  const out = [];
  if (!isWohnraum(unit) || !contract?.kaution) return out;
  const max = (contract.kalt || 0) * 3;
  if (contract.kaution > max) out.push({ level: "bad", text: `Kaution übersteigt 3 Nettokaltmieten (${(max / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}) – der übersteigende Teil ist unwirksam (§ 551 Abs. 1 BGB).` });
  out.push({ level: "info", text: "Mieter darf die Kaution in 3 Monatsraten zahlen; die erste ist mit Beginn des Mietverhältnisses fällig. Kaution getrennt vom eigenen Vermögen (Mietkautionskonto) und insolvenzsicher anlegen (§ 551 Abs. 2, 3 BGB)." });
  return out;
}

// ---------------------------------------------------------------- Mieterhöhung (§§ 557a, 557b, 558, 559, 560 BGB)

const monthsBetween = (a, b) => { const [y1, m1] = a.split("-").map(Number); const [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); };

// Letzte Änderung der Nettokaltmiete (Monat) vor einem Stichmonat
export function lastKaltChange(contract, beforeKey) {
  let last = monthKey(contract.start), kalt = contract.kalt;
  for (const s of [...(contract.steps || [])].sort((a, b) => (a.from < b.from ? -1 : 1))) {
    if (s.from >= beforeKey) break;
    if (s.kalt !== undefined && s.kalt !== kalt) { last = s.from; kalt = s.kalt; }
  }
  return last;
}

export function rentIncreaseCheck(unit, obj, contract, step) {
  const out = [];
  const before = rentForMonth(contract, addMonths(step.from, -1));
  if (!isWohnraum(unit)) {
    if (step.kalt > before.kalt) out.push({ level: "info", text: "Kein Wohnraum (Garage/Stellplatz/Gewerbe/Keller): Mieterhöhung richtet sich nach dem Vertrag; die §§ 557 ff. BGB gelten nicht." });
    return out;
  }
  if (step.nk !== undefined && step.nk !== before.nk) out.push({ level: "info", text: "Änderung der Betriebskostenvorauszahlung nur nach einer Abrechnung und in angemessener Höhe, per Erklärung in Textform (§ 560 Abs. 4 BGB)." });
  if (!(step.kalt > before.kalt)) return out;
  const art = contract.mietart || "standard";
  const since = monthsBetween(lastKaltChange(contract, step.from), step.from);
  if (art === "staffel") {
    if (since < 12) out.push({ level: "bad", text: `Staffelmiete: Zwischen zwei Staffeln muss mindestens 1 Jahr liegen (§ 557a Abs. 2 BGB) – hier ${since} Monate.` });
    out.push({ level: "info", text: "Staffelmiete: Nur die im Vertrag betragsmäßig festgelegten Staffeln sind zulässig; Erhöhungen nach §§ 558, 559 BGB sind ausgeschlossen." });
    return out;
  }
  if (art === "index") {
    if (since < 12) out.push({ level: "bad", text: `Indexmiete: Die Miete muss mindestens 1 Jahr unverändert bleiben (§ 557b Abs. 2 BGB) – hier ${since} Monate.` });
    out.push({ level: "info", text: "Indexmiete: Erhöhung nur entsprechend der Änderung des Verbraucherpreisindex (VPI), per Erklärung in Textform mit Angabe der Indexwerte; wirksam ab dem übernächsten Monat nach Zugang." });
    return out;
  }
  if (since < 15) out.push({ level: "bad", text: `Die erhöhte Miete darf frühestens 15 Monate nach Einzug bzw. der letzten Erhöhung wirksam werden (§ 558 Abs. 1 BGB) – hier ${since} Monate. (Modernisierungs- und Betriebskostenerhöhungen zählen nicht mit.)` });
  const base3 = rentForMonth(contract, addMonths(step.from, -36));
  const baseKalt = monthKey(contract.start) > addMonths(step.from, -36) ? contract.kalt : base3.kalt;
  const cap = obj?.kappung15 ? 15 : 20;
  const pct = baseKalt ? ((step.kalt - baseKalt) / baseKalt) * 100 : 0;
  if (pct > cap + 1e-9) out.push({ level: "bad", text: `Kappungsgrenze überschritten: +${pct.toFixed(1).replace(".", ",")} % in 3 Jahren, erlaubt sind ${cap} % (§ 558 Abs. 3 BGB${cap === 15 ? ", Kappungsgrenzen-Verordnung" : ""}).` });
  out.push({ level: "info", text: "Die neue Miete darf die ortsübliche Vergleichsmiete nicht übersteigen. Verlangen in Textform mit Begründung (Mietspiegel, 3 Vergleichswohnungen oder Gutachten); Zustimmungsfrist bis Ende des 2. Monats nach Zugang, wirksam ab dem 3. Monat (§§ 558a, 558b BGB)." });
  return out;
}

// Wo ist (vermieterfreundlich) eine Mieterhöhung möglich? – nur Wohnraum mit normaler Miete
export function increaseOpportunities(state, todayIso, objectsById = {}) {
  const key = monthKey(todayIso);
  const out = [];
  for (const c of state.contracts || []) {
    const u = (state.units || []).find((x) => x.id === c.unitId);
    if (!isWohnraum(u) || (c.end && c.end < todayIso) || c.start > todayIso || (c.mietart || "standard") !== "standard") continue;
    const effective = addMonths(key, 3); // Zugang jetzt → Wirkung ab dem 3. Monat
    const since = monthsBetween(lastKaltChange(c, effective), effective);
    if (since < 15) continue;
    const obj = objectsById[u.objectId] || (state.objects || []).find((o) => o.id === u.objectId);
    const cap = obj?.kappung15 ? 15 : 20;
    const baseKalt = monthKey(c.start) > addMonths(effective, -36) ? c.kalt : rentForMonth(c, addMonths(effective, -36)).kalt;
    const now = rentForMonth(c, key).kalt;
    const maxByCap = Math.floor(baseKalt * (1 + cap / 100));
    if (maxByCap > now) out.push({ contractId: c.id, now, maxByCap, cap, effective, perM2: u.area ? Math.round(now / Number(u.area)) : null });
  }
  return out;
}

// Mietpreisbremse bei Neuvermietung (§§ 556d ff. BGB)
export function rentBrakeCheck(obj, unit, newKalt, prevKalt, vergleichPerM2Cents) {
  const out = [];
  if (!obj?.mietpreisbremse || !isWohnraum(unit)) return out;
  if (!vergleichPerM2Cents || !unit.area) {
    out.push({ level: "info", text: "Mietpreisbremse: Die Miete darf die ortsübliche Vergleichsmiete um höchstens 10 % übersteigen (Ausnahmen: höhere Vormiete, Neubau mit Erstbezug nach dem 1.10.2014, umfassende Modernisierung). Vergleichsmiete laut Mietspiegel eintragen, um zu prüfen." });
    return out;
  }
  const limit = Math.round(vergleichPerM2Cents * Number(unit.area) * 1.1);
  const allowed = Math.max(limit, prevKalt || 0);
  if (newKalt > allowed) out.push({ level: "bad", text: `Mietpreisbremse: zulässig wären höchstens ${(allowed / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} (Vergleichsmiete + 10 %${prevKalt > limit ? " bzw. Vormiete" : ""}).` });
  if (prevKalt > limit) out.push({ level: "info", text: "Beruft sich der Vermieter auf die Vormiete oder eine Ausnahme, muss er den Mieter VOR Vertragsschluss unaufgefordert darüber informieren (§ 556g Abs. 1a BGB)." });
  return out;
}

// ---------------------------------------------------------------- Betriebskosten

export function nkPeriodCheck(from, to) {
  const out = [];
  const days = daysIncl(from, to);
  if (days > 366) out.push({ level: "bad", text: "Der Abrechnungszeitraum darf höchstens 12 Monate umfassen (§ 556 Abs. 3 S. 1 BGB)." });
  if (days < 28) out.push({ level: "info", text: "Sehr kurzer Abrechnungszeitraum – üblich ist das Kalenderjahr." });
  return out;
}

// CO2-Kostenaufteilungsgesetz: Vermieteranteil nach CO2-Ausstoß (kg CO2 je m² Wohnfläche und Jahr)
export const CO2_STUFEN = [[12, 0], [17, 10], [22, 20], [27, 30], [32, 40], [37, 50], [42, 60], [47, 70], [52, 80], [Infinity, 95]];
export function co2Split(co2CostCents, kgPerM2, wohngebaeude = true) {
  if (!co2CostCents) return { landlordPct: 0, landlord: 0, tenant: 0 };
  const pct = wohngebaeude ? CO2_STUFEN.find(([lim]) => kgPerM2 < lim)[1] : 50;
  const landlord = Math.round((co2CostCents * pct) / 100);
  return { landlordPct: pct, landlord, tenant: co2CostCents - landlord, stufe: wohngebaeude ? CO2_STUFEN.findIndex(([lim]) => kgPerM2 < lim) + 1 : null };
}

// ---------------------------------------------------------------- Rechnungen

export function eInvoiceHint(inv) {
  if (!inv?.recipient?.business) return null;
  const y = Number((inv.date || "").slice(0, 4));
  if (y <= 2026) return "Rechnung an ein Unternehmen: Bis Ende 2026 ist eine PDF-/Papierrechnung noch zulässig (Übergangsregelung). Der Empfänger muss E-Rechnungen bereits empfangen können.";
  if (y === 2027) return "Ab 2027 müssen Unternehmen mit mehr als 800.000 € Vorjahresumsatz E-Rechnungen (XRechnung/ZUGFeRD) ausstellen; darunter ist PDF bis Ende 2027 noch zulässig.";
  return "Ab 2028 ist an Unternehmen eine E-Rechnung (XRechnung/ZUGFeRD) Pflicht – eine PDF-Rechnung genügt nicht mehr.";
}

// ---------------------------------------------------------------- Datenschutz & Aufbewahrung

export const RETENTION = { buchungsbelege: 8, geschaeftsbriefe: 6, buecher: 10, meldeschein: 1 };

// Daten, deren Aufbewahrungsfrist abgelaufen ist → Löschen/Anonymisieren vorschlagen
export function retentionDue(state, todayIso) {
  const y = Number(todayIso.slice(0, 4));
  const tenants = (state.tenants || []).filter((t) => !t.anonymized).filter((t) => {
    const cs = (state.contracts || []).filter((c) => (c.tenantIds || []).includes(t.id));
    if (!cs.length || cs.some((c) => !c.end || c.end >= todayIso)) return false;
    const lastEndYear = Math.max(...cs.map((c) => Number(c.end.slice(0, 4))));
    return y > lastEndYear + RETENTION.buchungsbelege; // Frist beginnt mit Ende des Kalenderjahres
  });
  const guests = (state.bookings || []).filter((b) => !b.anonymized && b.to && nightsBetween(b.to, todayIso) > 366 && (b.nationality || b.email || b.phone || b.guestStreet));
  return { tenants, guests };
}

export function anonymizeTenant(t) {
  return { ...t, name: `Ehemaliger Mieter ${t.id.slice(-4)}`, members: "", email: "", phone: "", ibans: [], address: "", prevAddress: "", notes: "", anonymized: true };
}
export function anonymizeGuest(b) {
  return { ...b, email: "", phone: "", nationality: "", guestStreet: "", guestZip: "", guestCity: "", note: "", anonymized: true };
}

// Pseudonymisierung für KI-Anfragen: Namen → "Mieter 1", IBANs entfernen
export function pseudonymizer(state) {
  const map = new Map();
  (state.tenants || []).forEach((t, i) => map.set(t.name, `Mieter ${i + 1}`));
  (state.bookings || []).forEach((b, i) => b.guest && map.set(b.guest, `Gast ${i + 1}`));
  const names = [...map.keys()].filter((n) => n && n.length > 2).sort((a, b) => b.length - a.length);
  const fn = (text) => {
    let s = String(text);
    for (const n of names) s = s.split(n).join(map.get(n));
    return s.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g, "[IBAN]");
  };
  // Rückübersetzung für die Anzeige (bleibt lokal)
  const back = [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  fn.revert = (text) => { let s = String(text); for (const [name, ps] of back) s = s.split(ps).join(name); return s; };
  return fn;
}
