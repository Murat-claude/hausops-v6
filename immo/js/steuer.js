// Steuererklärung selbst machen: Vorprüfung, Ausfüllhilfe Anlage V / V-FeWo, Umsatzsteuer-Voranmeldung.
// Keine Steuerberatung – die App bereitet Werte und Hinweise vor; die Verantwortung für die Erklärung bleibt beim Steuerpflichtigen.
import { EXPENSE_CATEGORIES, afaForYear, splitPayment, rentForMonth, monthKey, nightsBetween, addMonths, overlapNights, parseOwners } from "./core.js";
import { isWohnraum } from "./recht.js";

const inYear = (iso, y) => iso && iso.slice(0, 4) === String(y);

// ---------------------------------------------------------------- Erhaltungsaufwand verteilen (§ 82b EStDV, 2–5 Jahre)
export function expenseShareForYear(e, year) {
  const n = Math.min(5, Math.max(1, Number(e.distribute) || 1));
  const start = Number(e.date.slice(0, 4));
  if (year < start || year >= start + n) return 0;
  const part = Math.floor(e.amount / n);
  return year === start + n - 1 ? e.amount - part * (n - 1) : part;
}

// Objekt, zu dem eine Zahlung gehört
function unitOfPayment(state, p) {
  if (p.contractId) return (state.units || []).find((u) => u.id === (state.contracts || []).find((c) => c.id === p.contractId)?.unitId);
  if (p.unitId) return (state.units || []).find((u) => u.id === p.unitId);
  if (p.invoiceId) { const inv = (state.invoices || []).find((i) => i.id === p.invoiceId); const uid = inv?.unitId || (state.bookings || []).find((b) => b.id === inv?.bookingId)?.unitId; return (state.units || []).find((u) => u.id === uid); }
  return null;
}

// ---------------------------------------------------------------- Werte je Objekt für Anlage V / V-FeWo
export function taxFigures(state, objectId, year) {
  const obj = (state.objects || []).find((o) => o.id === objectId);
  const units = (state.units || []).filter((u) => u.objectId === objectId);
  const f = {
    wohnen: 0, andere: 0, umlagen: 0, fewo: 0, sonstige: 0, ustEingenommen: 0, nachzahlungVorjahre: 0,
    afa: afaForYear(obj || {}, year), zinsen: 0, geldbeschaffung: 0, erhaltung: 0, erhaltungVerteilt: 0, betrieb: 0, verwaltung: 0, sonstigeWk: 0, vorsteuer: 0,
    wohnungen: units.filter((u) => isWohnraum(u)).length, flaecheWohnen: units.filter((u) => isWohnraum(u)).reduce((s, u) => s + (Number(u.area) || 0), 0),
  };
  for (const p of state.payments || []) {
    if (!inYear(p.date, year)) continue;
    const u = unitOfPayment(state, p);
    if ((u?.objectId || p.objectId) !== objectId) continue;
    for (const part of splitPayment(state, p)) {
      if (["kaution", "durchlaufend"].includes(part.type)) continue;
      const ust = part.vat && !part.kleinunternehmer ? part.amount - Math.round(part.amount / (1 + part.vat / 100)) : 0;
      const net = part.amount - ust;
      f.ustEingenommen += ust;
      if (part.type === "fewo") f.fewo += net;
      else if (part.type === "umlage") f.umlagen += net;
      else if (part.type === "kalt") (u && isWohnraum(u) ? (f.wohnen += net) : (f.andere += net));
      else f.sonstige += net;
      if (p.kind === "miete" && p.period && p.period.slice(0, 4) < String(year)) f.nachzahlungVorjahre += part.amount;
    }
  }
  for (const e of state.expenses || []) {
    if (e.objectId !== objectId) continue;
    const cat = EXPENSE_CATEGORIES[e.category];
    if (!cat?.av) continue;
    const amt = cat.av === "erhaltung" ? expenseShareForYear(e, year) : inYear(e.date, year) ? e.amount : 0;
    if (!amt) continue;
    if (inYear(e.date, year) && e.vorsteuer) f.vorsteuer += e.vorsteuer;
    if (cat.av === "zinsen") f.zinsen += amt;
    else if (cat.av === "erhaltung") (Number(e.distribute) > 1 ? (f.erhaltungVerteilt += amt) : (f.erhaltung += amt));
    else if (cat.av === "betrieb") f.betrieb += amt;
    else if (cat.av === "verwaltung") f.verwaltung += amt;
    else f.sonstigeWk += amt;
  }
  f.einnahmen = f.wohnen + f.andere + f.umlagen + f.fewo + f.sonstige + f.ustEingenommen;
  f.werbungskosten = f.afa + f.zinsen + f.geldbeschaffung + f.erhaltung + f.erhaltungVerteilt + f.betrieb + f.verwaltung + f.sonstigeWk;
  f.ergebnis = f.einnahmen - f.werbungskosten;
  return f;
}

// Volle Euro für ELSTER: Einnahmen abrunden, Werbungskosten aufrunden (zulässig und zu Gunsten des Steuerpflichtigen)
export const euroDown = (c) => Math.floor((c || 0) / 100);
export const euroUp = (c) => Math.ceil((c || 0) / 100);

// ---------------------------------------------------------------- Ferienwohnung: Vermietung vs. Eigennutzung
export function fewoUsage(state, unitId, year) {
  const from = `${year}-01-01`, to = `${year + 1}-01-01`;
  let rented = 0, own = 0;
  for (const b of state.bookings || []) {
    if (b.unitId !== unitId || b.status === "storniert") continue;
    const n = overlapNights(b, from, to);
    if (b.status === "eigennutzung") own += n; else rented += n;
  }
  const days = nightsBetween(from, to);
  return { rented, own, empty: days - rented - own, days, costQuote: own ? rented / (rented + own) : 1 };
}

// ---------------------------------------------------------------- Vorprüfung (was ein Steuerberater prüfen würde)
export function taxChecks(state, year, todayIso) {
  const out = [];
  const add = (level, area, text, fix) => out.push({ level, area, text, fix });
  const y = String(year);
  const open = (state.transactions || []).filter((t) => !t.link && t.date.startsWith(y));
  if (open.length) add("bad", "Vollständigkeit", `${open.length} Bankumsätze aus ${year} sind nicht zugeordnet – Einnahmen/Kosten fehlen sonst in der Erklärung.`, "#/bank");
  const noBeleg = (state.expenses || []).filter((e) => e.date.startsWith(y) && EXPENSE_CATEGORIES[e.category]?.av && !(e.fileIds || []).length && !e.belegNr);
  if (noBeleg.length) add("warn", "Belege", `${noBeleg.length} Ausgaben ohne Beleg. Belege werden nicht mitgeschickt, müssen aber auf Nachfrage vorgelegt werden können.`, "#/ausgaben");
  const noObj = (state.expenses || []).filter((e) => e.date.startsWith(y) && !e.objectId && EXPENSE_CATEGORIES[e.category]?.av);
  if (noObj.length) add("bad", "Vollständigkeit", `${noObj.length} Ausgaben ohne Objekt – sie fehlen in der Anlage V.`, "#/ausgaben");
  const hasZins = (state.expenses || []).some((e) => e.date.startsWith(y) && e.category === "zinsen");
  const zinsDoc = (state.documents || []).some((d) => d.kind === "zinsbescheinigung");
  if (hasZins && !zinsDoc) add("warn", "Belege", "Zinsbescheinigung der Bank ablegen: abziehbar sind nur die Zinsen, nicht die Tilgung.", "#/dokumente");
  for (const e of (state.expenses || []).filter((x) => x.date.startsWith(y) && x.category === "herstellung")) {
    const o = (state.objects || []).find((x) => x.id === e.objectId);
    add("warn", o?.name || "Herstellungskosten", `${e.vendor || "Ausgabe"} (${(e.amount / 100).toLocaleString("de-DE")} €) ist als Anschaffung/Herstellung erfasst: nicht sofort abziehbar, sondern über die AfA. Liegt echte Herstellung vor (z. B. Erweiterung, wesentliche Verbesserung), den Gebäudewert (AfA-Basis) beim Objekt erhöhen. Der Austausch einer funktionierenden Heizung, Fenster o. Ä. gegen zeitgemäße Teile ist dagegen meist sofort abziehbarer Erhaltungsaufwand – dann Kategorie ändern.`, "#/ausgaben");
  }
  for (const o of state.objects || []) {
    if (!o.purchaseDate || !o.buildingShare) add("bad", o.name, "Kaufdatum und Gebäudeanteil (ohne Grund und Boden) fehlen – ohne sie keine AfA. Tipp: Aufteilung über die Arbeitshilfe des BMF zur Kaufpreisaufteilung.", "#/objekte");
    // Anschaffungsnaher Herstellungsaufwand: Instandsetzung > 15 % (netto) der Gebäude-Anschaffungskosten in 3 Jahren (§ 6 Abs. 1 Nr. 1a EStG)
    if (o.purchaseDate && o.buildingShare) {
      const end = `${addMonths(monthKey(o.purchaseDate), 36)}-01`;
      const sum = (state.expenses || []).filter((e) => e.objectId === o.id && ["erhaltung", "herstellung"].includes(e.category) && e.date >= o.purchaseDate && e.date < end)
        .reduce((s, e) => s + Math.round(e.amount / 1.19), 0);
      const limit = Math.round(o.buildingShare * 0.15);
      if (sum > limit) add("bad", o.name, `Anschaffungsnaher Aufwand: Instandsetzungen in den ersten 3 Jahren nach dem Kauf (netto ca. ${(sum / 100).toLocaleString("de-DE")} €) übersteigen 15 % des Gebäudewerts (${(limit / 100).toLocaleString("de-DE")} €). Sie sind dann NICHT sofort abziehbar, sondern über die AfA zu verteilen (§ 6 Abs. 1 Nr. 1a EStG). Laufende Schönheitsreparaturen zählen nicht mit – hier ggf. fachlich prüfen lassen.`, "#/ausgaben");
      else if (sum > limit * 0.8 && todayIso < end) add("warn", o.name, `Achtung 15-%-Grenze: Bis ${end.slice(0, 7).split("-").reverse().join("/")} bleiben noch ca. ${((limit - sum) / 100).toLocaleString("de-DE")} € (netto) für Instandsetzungen, ohne dass sie in die AfA wandern. Größere Arbeiten ggf. auf später verschieben.`, "#/ausgaben");
    }
    const owners = parseOwners(o.owners);
    if (owners.length > 1 && !o.ehegatten) add("bad", o.name, `Miteigentum (${owners.map((x) => x.name).join(", ")}) ohne Ehe/eingetragene Partnerschaft: Die Einkünfte müssen zuerst in einer gesonderten und einheitlichen Feststellungserklärung (ESt 1 B mit Anlage FB/V) erklärt werden; in der eigenen Erklärung steht dann nur der Anteil (Anlage V-Sonstiges). Das ist aufwendiger – hier lohnt sich ggf. einmalig der Steuerberater.`, "#/objekte");
    else if (owners.length > 1) add("info", o.name, "Ehegatten als Miteigentümer: keine Feststellungserklärung nötig, die Anlage V wird in der gemeinsamen Erklärung abgegeben (Anteile in der Anlage angeben).", null);
  }
  // Verbilligte Vermietung (§ 21 Abs. 2 EStG): Warmmiete < 66 % der ortsüblichen Warmmiete
  for (const c of state.contracts || []) {
    const u = (state.units || []).find((x) => x.id === c.unitId), o = (state.objects || []).find((x) => x.id === u?.objectId);
    if (!isWohnraum(u) || !o?.vergleichsmiete || !u.area || c.start > `${y}-12-31` || (c.end && c.end < `${y}-01-01`)) continue;
    const r = rentForMonth(c, `${y}-12` <= monthKey(todayIso) ? `${y}-12` : monthKey(todayIso));
    const ortsueblich = Math.round(o.vergleichsmiete * Number(u.area)) + r.nk;
    const quote = r.total / ortsueblich;
    if (quote < 0.5) add("bad", u.name, `Miete beträgt nur ${Math.round(quote * 100)} % der ortsüblichen Warmmiete: Werbungskosten sind nur anteilig abziehbar (§ 21 Abs. 2 EStG). Mieterhöhung prüfen.`, `#/mieter`);
    else if (quote < 0.66) add("warn", u.name, `Miete beträgt ${Math.round(quote * 100)} % der ortsüblichen Warmmiete (unter 66 %): Das Finanzamt verlangt eine Totalüberschussprognose, sonst werden Werbungskosten gekürzt. Eine Anhebung auf mindestens 66 % sichert den vollen Abzug.`, `#/mieter`);
  }
  // Ferienwohnung
  for (const u of (state.units || []).filter((x) => x.type === "ferienwohnung")) {
    const us = fewoUsage(state, u.id, year);
    if (us.own) add("warn", u.name, `Eigennutzung ${us.own} Tage, Vermietung ${us.rented} Tage: Kosten sind nur zu ${Math.round(us.costQuote * 100)} % abziehbar (Leerstand wird anteilig zugerechnet). Bei teilweiser Eigennutzung prüft das Finanzamt zudem die Überschusserzielungsabsicht.`, "#/ferien");
    else if (us.rented < 90) add("info", u.name, `Nur ${us.rented} vermietete Tage: Unterschreitet die Vermietung die ortsübliche Auslastung vergleichbarer Ferienwohnungen um mehr als 25 %, kann das Finanzamt eine Überschussprognose verlangen. Vermietungsbemühungen (Inserate, Portale, Preise) dokumentieren.`, "#/ferien");
    add("info", u.name, "Ferienwohnung: In ELSTER die Anlage V-FeWo verwenden. Bei hotelähnlichen Zusatzleistungen (tägliche Reinigung, Frühstück, Wäsche) kann die Vermietung gewerblich sein (dann Anlage G/EÜR) – im Zweifel klären.", null);
  }
  if (!state.settings?.kleinunternehmer && (state.units || []).some((u) => Number(u.vat) > 0 || u.type === "ferienwohnung")) add("info", "Umsatzsteuer", "Du bist nicht als Kleinunternehmer eingestellt: Für Ferienwohnung bzw. Stellplätze sind Umsatzsteuer-Voranmeldungen und eine Umsatzsteuererklärung abzugeben (Werte unten).", null);
  return out;
}

// ---------------------------------------------------------------- Umsatzsteuer-Voranmeldung (Kennzahlen)
export function ustVa(state, fromIso, toIso) {
  let kz81 = 0, kz86 = 0, steuer = 0, kz66 = 0;
  for (const p of state.payments || []) {
    if (p.date < fromIso || p.date > toIso) continue;
    for (const part of splitPayment(state, p)) {
      if (!part.vat || part.kleinunternehmer || part.type === "durchlaufend") continue;
      const net = Math.round(part.amount / (1 + part.vat / 100));
      if (part.vat === 19) kz81 += net; else if (part.vat === 7) kz86 += net;
      steuer += part.amount - net;
    }
  }
  for (const e of state.expenses || []) if (e.date >= fromIso && e.date <= toIso && e.vorsteuer) kz66 += e.vorsteuer;
  return { kz81, kz86, steuer, kz66, zahllast: steuer - kz66 };
}
