// Reparaturen & Instandhaltung: Aufträge, Kosten, Kleinreparaturen, Wartungsplan (reine Fachlogik, testbar)

export const REPAIR_STATUS = {
  gemeldet: "🆕 gemeldet", beauftragt: "📋 beauftragt", in_arbeit: "🔨 in Arbeit", erledigt: "✅ erledigt", abgelehnt: "✖ abgelehnt / kein Mangel",
};
export const REPAIR_OPEN = ["gemeldet", "beauftragt", "in_arbeit"];
export const REPAIR_KINDS = {
  reparatur: "Reparatur / Mangel", wartung: "Wartung / Prüfung", schoenheit: "Schönheitsreparatur / Renovierung",
  modernisierung: "Modernisierung / Verbesserung", notfall: "Notdienst / Havarie",
};
export const PRIORITIES = { normal: "normal", dringend: "dringend", notfall: "🚨 Notfall (sofort)" };
// Wer trägt die Kosten?
export const PAYERS = {
  vermieter: "Vermieter (Erhaltungsaufwand)",
  kleinreparatur: "Mieter – Kleinreparaturklausel",
  mieter_schaden: "Mieter – selbst verursachter Schaden",
  versicherung: "Versicherung (Schadenfall)",
  umlage: "Umlage über Nebenkosten (Wartung nach BetrKV)",
};

// Kosten eines Auftrags: verknüpfte Ausgaben, sonst manuell eingetragene Kosten
export function repairCost(state, r) {
  const linked = (state.expenses || []).filter((e) => (r.expenseIds || []).includes(e.id));
  return linked.length ? linked.reduce((s, e) => s + (e.amount || 0), 0) : r.cost || 0;
}

// Kleinreparaturklausel (BGH VIII ZR 38/88 u. a.): nur Teile mit häufigem Mieterzugriff, Grenze je Fall UND Jahreshöchstbetrag.
// Übersteigt eine Reparatur die Grenze je Fall, zahlt der Mieter NICHTS (keine anteilige Beteiligung).
export function kleinreparaturCheck(contract, amount, spentThisYear = 0, annualRentKalt = 0) {
  const k = contract?.kleinreparatur || (contract?.kleinRepCase ? { perCase: contract.kleinRepCase, yearMax: contract.kleinRepYear || 0 } : null);
  if (!k?.perCase) return { applies: false, tenantPays: 0, reason: "Im Mietvertrag ist keine Kleinreparaturklausel hinterlegt – Kosten trägt der Vermieter." };
  const perCase = k.perCase, yearCap = k.yearMax || Math.round(annualRentKalt * 0.08);
  const warn = [];
  if (perCase > 12000) warn.push("Die Grenze je Fall liegt über ca. 120 € – Gerichte halten höhere Beträge oft für unwirksam; dann gilt die ganze Klausel nicht.");
  if (!k.yearMax) warn.push("Ohne Jahreshöchstbetrag ist die Klausel unwirksam (BGH). Hier wurden hilfsweise 8 % der Jahreskaltmiete angesetzt – bitte Vertrag prüfen.");
  if (amount > perCase) return { applies: false, tenantPays: 0, reason: `Kosten (${(amount / 100).toFixed(2)} €) über der Grenze je Fall (${(perCase / 100).toFixed(2)} €) – der Mieter zahlt dann nichts, auch nicht anteilig.`, warn };
  const left = Math.max(0, yearCap - spentThisYear);
  const pays = Math.min(amount, left);
  return { applies: pays > 0, tenantPays: pays, reason: pays < amount ? `Jahreshöchstbetrag fast ausgeschöpft – Mieter trägt noch ${(pays / 100).toFixed(2)} €.` : "Kleinreparatur: Mieter trägt die Kosten (nur Teile mit häufigem Zugriff: Armaturen, Schalter, Steckdosen, Fenster-/Türgriffe, Rollläden …).", warn };
}

// Wartungsvorlagen mit Intervall und Umlagefähigkeit (BetrKV § 2)
export const MAINT_TEMPLATES = [
  { key: "heizung", title: "Heizungswartung", months: 12, betrkv: "heizung", note: "umlagefähig (§ 2 Nr. 4a BetrKV)" },
  { key: "schornstein", title: "Schornsteinfeger / Feuerstättenschau", months: 12, betrkv: "schornstein", note: "umlagefähig (§ 2 Nr. 12 BetrKV)" },
  { key: "rauchmelder", title: "Rauchwarnmelder prüfen", months: 12, betrkv: "sonstige", note: "Wartung umlagefähig, wenn als sonstige Betriebskosten vereinbart; Miete der Geräte nicht (BGH VIII ZR 379/20)" },
  { key: "legionellen", title: "Legionellenprüfung Trinkwasser", months: 36, betrkv: "warmwasser", note: "Pflicht bei Großanlagen mit Duschen (TrinkwV); umlagefähig" },
  { key: "aufzug", title: "Aufzug: Wartung & TÜV", months: 12, betrkv: "aufzug", note: "umlagefähig (§ 2 Nr. 7 BetrKV)" },
  { key: "dachrinne", title: "Dachrinnen reinigen", months: 12, betrkv: "sonstige", note: "umlagefähig nur als regelmäßige, vereinbarte sonstige Betriebskosten" },
  { key: "feuerloescher", title: "Feuerlöscher prüfen", months: 24, betrkv: "sonstige", note: "umlagefähig als vereinbarte sonstige Betriebskosten" },
  { key: "echeck", title: "Elektro-Prüfung (E-Check)", months: 48, betrkv: "sonstige", note: "nur umlagefähig, wenn regelmäßig und im Vertrag vereinbart" },
  { key: "rueckstau", title: "Rückstausicherung warten", months: 12, betrkv: "abwasser", note: "umlagefähig (Entwässerung)" },
  { key: "spielplatz", title: "Spielplatz: Sand & Geräte prüfen", months: 12, betrkv: "garten", note: "umlagefähig (§ 2 Nr. 10 BetrKV)" },
  { key: "dach", title: "Dach- und Fassadenkontrolle", months: 24, betrkv: "", note: "nicht umlagefähig (Instandhaltung)" },
];

const addMonthsIso = (iso, m) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
export const nextDue = (m) => (m.lastDone ? addMonthsIso(m.lastDone, Number(m.months) || 12) : m.firstDue || null);

// Fällige / bald fällige Wartungen (Standard: 30 Tage Vorlauf)
export function maintenanceDue(state, today, days = 30) {
  const horizon = new Date(`${today}T00:00:00Z`); horizon.setUTCDate(horizon.getUTCDate() + days);
  const h = horizon.toISOString().slice(0, 10);
  return (state.maintenance || []).map((m) => ({ ...m, due: nextDue(m) }))
    .filter((m) => m.active !== false && m.due && m.due <= h)
    .map((m) => ({ ...m, overdue: m.due < today }))
    .sort((a, b) => (a.due < b.due ? -1 : 1));
}

// Kostenübersicht je Objekt und Jahr (nach Kostenträger und Art)
export function repairStats(state, year, objectId = "") {
  const y = String(year);
  const list = (state.repairs || []).filter((r) => (!objectId || r.objectId === objectId));
  const costOf = (r) => repairCost(state, r);
  const inYear = list.filter((r) => (r.doneAt || r.reportedAt || "").startsWith(y) && r.status !== "abgelehnt");
  const byPayer = {}, byKind = {};
  for (const r of inYear) {
    const c = costOf(r); const p = r.payer || "vermieter";
    byPayer[p] = (byPayer[p] || 0) + c;
    byKind[r.kind || "reparatur"] = (byKind[r.kind || "reparatur"] || 0) + c;
  }
  const open = list.filter((r) => REPAIR_OPEN.includes(r.status));
  return {
    total: Object.values(byPayer).reduce((s, v) => s + v, 0), landlord: byPayer.vermieter || 0, byPayer, byKind,
    count: inYear.length, open: open.length, urgent: open.filter((r) => r.priority !== "normal").length,
    quotesOpen: open.reduce((s, r) => s + (r.quote || 0), 0),
  };
}

// Anschaffungsnahe Herstellungskosten (§ 6 Abs. 1 Nr. 1a EStG): Instandsetzung in 3 Jahren nach Kauf > 15 % (netto) des Gebäudeanteils
export function fifteenPercent(state, object, today) {
  if (!object?.purchaseDate || !object.buildingShare) return null;
  const end = addMonthsIso(object.purchaseDate, 36);
  const sum = (state.expenses || []).filter((e) => e.objectId === object.id && ["erhaltung", "herstellung"].includes(e.category) && e.date >= object.purchaseDate && e.date < end)
    .reduce((s, e) => s + Math.round((e.amount || 0) / 1.19), 0); // netto (ohne USt) geschätzt
  const limit = Math.round(object.buildingShare * 0.15);
  return { until: end, active: today < end, sum, limit, left: limit - sum, pct: limit ? sum / limit : 0 };
}
