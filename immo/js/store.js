// Datenhaltung: lokal im Browser (localStorage) + Backup-Datei (JSON).
import { uid, monthKey, addMonths } from "./core.js";

const BASE_KEY = "hausops-immo-v1";
let KEY = BASE_KEY;
// Im Cloud-Modus bekommt jeder Nutzer einen eigenen lokalen Zwischenspeicher
export function useUser(uid) { KEY = uid ? `${BASE_KEY}:${uid}` : BASE_KEY; }
export function legacyLocal() {
  try { const raw = localStorage.getItem(BASE_KEY); return raw ? normalizeState(JSON.parse(raw)) : null; } catch { return null; }
}
export function normalizeState(data) {
  const base = emptyState();
  return { ...base, ...(data || {}), settings: { ...base.settings, ...((data || {}).settings || {}) } };
}

export function emptyState() {
  return {
    version: 1,
    objects: [], units: [], tenants: [], contracts: [],
    accounts: [], transactions: [], payments: [], expenses: [],
    bookings: [], invoices: [], rules: {}, nkStatements: [], documents: [], letters: [],
    settings: {
      ownerName: "", ownerStreet: "", ownerZip: "", ownerCity: "", ownerEmail: "", ownerPhone: "",
      taxNumber: "", vatId: "", invoiceIban: "", invoiceBic: "", invoiceBank: "",
      kleinunternehmer: false, invoicePrefix: "RE-{JJJJ}-", invoiceCounters: {},
      invoiceFooter: "Vielen Dank für Ihren Aufenthalt!", paymentTermDays: 14,
      skr: "03", datevBerater: "", datevMandant: "", datevKontenlaenge: 4,
      accounts: {}, expenseAccounts: {}, autoAssignScore: 80,
      sollStart: new Date().toISOString().slice(0, 7),
    },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const data = JSON.parse(raw);
    const base = emptyState();
    return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  } catch (e) {
    console.error("HausOps: Daten konnten nicht geladen werden", e);
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error("HausOps: Speichern fehlgeschlagen", e);
    return false;
  }
}

export function importBackup(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.objects)) throw new Error("Keine gültige HausOps-Sicherung.");
  const base = emptyState();
  return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
}

// ---------------------------------------------------------------- Demo-Daten

export function demoState() {
  const s = emptyState();
  const today = new Date().toISOString().slice(0, 10);
  const thisM = monthKey(today);
  Object.assign(s.settings, {
    ownerName: "Max Mustermann", ownerStreet: "Musterweg 1", ownerZip: "12345", ownerCity: "Musterstadt",
    ownerEmail: "vermietung@example.de", taxNumber: "123/456/78901", invoiceIban: "DE02120300000000202051",
    invoiceBank: "Musterbank", sollStart: addMonths(thisM, -1),
  });
  const o1 = { id: uid("o_"), name: "MFH Lindenstraße", short: "LIN", type: "mfh", street: "Lindenstraße 12", zip: "10115", city: "Berlin", year: 1968, purchaseDate: "2019-04-01", purchasePrice: 68000000, buildingShare: 51000000, afaRate: 2, owners: "Max Mustermann 50; Erika Mustermann 50", notes: "" };
  const o2 = { id: uid("o_"), name: "Ferienhaus Ostsee", short: "OST", type: "ferien", street: "Dünenweg 3", zip: "23743", city: "Grömitz", year: 2005, purchaseDate: "2022-06-01", purchasePrice: 42000000, buildingShare: 30000000, afaRate: 2, notes: "" };
  s.objects.push(o1, o2);
  const u = (o, name, type, extra = {}) => { const x = { id: uid("u_"), objectId: o.id, name, type, area: 0, rooms: 0, floor: "", vat: 0, ...extra }; s.units.push(x); return x; };
  const w1 = u(o1, "WE 01 EG links", "wohnung", { area: 68, rooms: 3, floor: "EG" });
  const w2 = u(o1, "WE 02 EG rechts", "wohnung", { area: 54, rooms: 2, floor: "EG" });
  const w3 = u(o1, "WE 03 1. OG", "wohnung", { area: 92, rooms: 4, floor: "1. OG" });
  const g1 = u(o1, "Garage 1", "garage", { area: 18 });
  u(o1, "Stellplatz 4", "stellplatz");
  const f1 = u(o2, "FeWo Strandblick", "ferienwohnung", { area: 55, rooms: 2, floor: "OG", vat: 7, maxGuests: 4 });
  const t = (name, iban, email) => { const x = { id: uid("t_"), name, ibans: [iban], email, phone: "", notes: "" }; s.tenants.push(x); return x; };
  const t1 = t("Anna Schmidt", "DE89370400440532013000", "anna@example.de");
  const t2 = t("Familie Yilmaz", "DE75512108001245126199", "");
  const t3 = t("Jonas Becker", "DE12500105170648489890", "");
  const c = (unit, tenants, start, kalt, nk, extra = 0) => { const x = { id: uid("c_"), unitId: unit.id, tenantIds: tenants.map((z) => z.id), start, end: "", kalt, nk, extra, kaution: kalt * 3, persons: 1, steps: [], notes: "" }; s.contracts.push(x); return x; };
  const c1 = c(w1, [t1], "2021-03-01", 72000, 18000);
  const c2 = c(w3, [t2], "2020-08-01", 98000, 26000);
  const c3 = c(g1, [t3], "2023-01-01", 6000, 0);
  c2.persons = 4; c1.persons = 2;
  // Betriebskosten des Vorjahres (für die Nebenkostenabrechnung) + eine Modernisierung
  const ly = Number(thisM.slice(0, 4)) - 1;
  const ex = (date, amount, category, vendor, belegNr = "") => s.expenses.push({ id: uid("e_"), date, amount, category, objectId: o1.id, vendor, note: "", belegNr, txId: null });
  ex(`${ly}-02-15`, 128000, "grundsteuer", "Stadt Berlin", "GS-" + ly);
  ex(`${ly}-03-01`, 94000, "versicherung", "Gebäudeversicherung AG", "V-17");
  ex(`${ly}-12-20`, 258000, "versorgung", "Berliner Wasserbetriebe");
  ex(`${ly}-12-20`, 61000, "muell", "BSR Müllabfuhr", "BSR-" + ly);
  ex(`${ly}-06-10`, 145000, "erhaltung", "Malerbetrieb Klein", "R-2231");
  // Mietzahlungen des Vorjahres (bar/ohne Kontoimport erfasst)
  for (let m = 1; m <= 12; m++) {
    const per = `${ly}-${String(m).padStart(2, "0")}`;
    for (const k of [c1, c2, c3]) s.payments.push({ id: uid("p_"), date: `${per}-03`, amount: k.kalt + k.nk, kind: "miete", contractId: k.id, period: per, txId: "import", note: "" });
  }
  ex(`${ly}-09-01`, 1850000, "herstellung", "Heizungsbau Nord (neue Gasbrennwerttherme)", "R-88");
  const acc = { id: uid("a_"), name: "Mietkonto", iban: "DE02120300000000202051", bank: "Musterbank" };
  s.accounts.push(acc);
  // Bankumsätze der letzten 2 Monate (unzugeordnet → zum Ausprobieren)
  const mk = (date, amount, name, iban, purpose) => s.transactions.push({ id: uid("tx_"), accountId: acc.id, date, amount, name, iban, purpose, link: null, hash: `${date}|${amount}|${name}` });
  for (const k of [addMonths(thisM, -1), thisM]) {
    mk(`${addMonths(k, -1)}-28`, 90000, "Anna Schmidt", t1.ibans[0], `Miete ${k.slice(5)}/${k.slice(0, 4)} Lindenstr. 12`);
    mk(`${k}-02`, 124000, "Yilmaz, Mehmet", t2.ibans[0], "Miete Wohnung 1.OG");
    mk(`${k}-05`, -21500, "Stadtwerke Berlin", "DE44100500000190000001", "Abschlag Wasser Lindenstraße");
  }
  mk(`${thisM}-03`, 6000, "J. Becker", t3.ibans[0], "Garage");
  mk(`${thisM}-04`, -48712, "Musterbank Baufinanzierung", "", "Zinsen Darlehen 4711");
  // Ferienwohnung
  const b = (from, to, guest, total, adults, channel) => s.bookings.push({ id: uid("b_"), unitId: f1.id, guest, guestStreet: "", guestZip: "", guestCity: "", email: "", from, to, adults, children: 0, total, cleaning: 6500, kurtaxe: 300, channel, status: "bestaetigt", note: "" });
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  b(d(-12), d(-5), "Familie Peters", 77000, 2, "Direkt");
  b(d(3), d(10), "Laura König", 84000, 2, "Airbnb");
  b(d(-40), d(-33), "Familie Jansen", 70000, 2, "Direkt");
  s.bookings[s.bookings.length - 1].nationality = "niederländisch";
  b(d(-60), d(-54), "Eigennutzung", 0, 0, "Direkt");
  s.bookings[s.bookings.length - 1].status = "eigennutzung";
  b(d(14), d(21), "Thomas Wagner", 91000, 3, "Booking.com");
  return s;
}
