// HausOps Immobilien — Oberfläche (Vanilla JS, ohne Build-Schritt)
import * as C from "./core.js";
import * as S from "./store.js";
import * as F from "./files.js";
import * as K from "./ki.js";
import * as Cloud from "./cloud.js";
import * as B from "./betrkv.js";
import * as R from "./recht.js";
import * as T from "./steuer.js";
import * as I from "./instand.js";
import * as M from "./monat.js";

let state = S.load();
const ui = { bankFilter: "offen", bankSearch: "", month: C.monthKey(today()), year: Number(today().slice(0, 4)), csv: null };

function today() { return new Date().toISOString().slice(0, 10); }
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = C.fmtEUR, d = C.fmtDate;
const byId = (list, id) => (state[list] || []).find((x) => x.id === id);
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (f(x) || 0), 0);

function persist() { if (blockedWrite()) return; S.save(state); scheduleSync(); }

// Nur-Lesen-Modus (Testphase abgelaufen / Abo beendet): Änderung verwerfen und Tarif anbieten
function blockedWrite() {
  if (!isCloud() || canWrite()) return false;
  if (auth.snapshot) state = S.normalizeState(JSON.parse(auth.snapshot));
  render();
  if (isViewer()) toast("👁 Nur-Lesen-Zugriff – Änderungen sind in diesem Bestand nicht möglich.");
  else paywall();
  return true;
}

function commit(msg) {
  if (blockedWrite()) return;
  if (!S.save(state) && !isCloud()) toast("⚠️ Speichern fehlgeschlagen (Speicher voll?) – bitte Datensicherung exportieren.");
  else if (msg) toast(msg);
  scheduleSync();
  render();
}

function toast(msg) {
  document.querySelectorAll(".toast").forEach((x) => x.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function download(name, content, type = "text/plain;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- Bezeichnungen

const unitLabel = (u) => (u ? `${byId("objects", u.objectId)?.short || byId("objects", u.objectId)?.name || ""} · ${u.name}` : "–");
const tenantNames = (c) => (c?.tenantIds || []).map((id) => byId("tenants", id)?.name).filter(Boolean).join(", ") || "–";
const contractLabel = (c) => (c ? `${unitLabel(byId("units", c.unitId))} – ${tenantNames(c)}` : "–");
const fewoUnits = () => state.units.filter((u) => u.type === "ferienwohnung");
const activeContract = (unitId, key = ui.month) => state.contracts.find((c) => c.unitId === unitId && C.contractActiveIn(c, key));

function linkLabel(tx) {
  if (!tx.link) return "";
  if (tx.link.type === "ignore") return `<span class="badge grey">ignoriert</span>`;
  if (tx.link.type === "payment") {
    const p = byId("payments", tx.link.id);
    if (!p) return "";
    if (tx.link.ids?.length > 1) return `<span class="badge ok">Miete ${C.fmtMonth(p.period)} · aufgeteilt</span> <span class="small">${tx.link.ids.map((id) => byId("payments", id)).filter(Boolean).map((x) => `${esc(contractLabel(byId("contracts", x.contractId)))} ${eur(x.amount)}`).join(" + ")}</span>`;
    if (p.kind === "miete") return `<span class="badge ok">Miete ${C.fmtMonth(p.period)}</span> <span class="small">${esc(contractLabel(byId("contracts", p.contractId)))}</span>`;
    if (p.kind === "fewo") return `<span class="badge ok">Rechnung ${esc(byId("invoices", p.invoiceId)?.number || "")}</span>`;
    return `<span class="badge ok">${esc(C.INCOME_KINDS[p.kind])}</span> <span class="small">${esc(p.contractId ? contractLabel(byId("contracts", p.contractId)) : "")}</span>`;
  }
  const e = byId("expenses", tx.link.id);
  if (!e) return "";
  return `<span class="badge">${esc(C.EXPENSE_CATEGORIES[e.category]?.label)}</span> <span class="small">${esc(byId("objects", e.objectId)?.name || "")}</span>`;
}

function suggestionLabel(s) {
  if (!s) return "";
  if (s.kind === "miete" && (s.splits?.length > 1 || s.contractIds?.length > 1)) return `Miete ${C.fmtMonth(s.period)} · aufgeteilt: ${(s.splits || s.contractIds.map((contractId) => ({ contractId }))).map((x) => `${contractLabel(byId("contracts", x.contractId))}${x.amount ? ` ${eur(x.amount)}` : ""}`).join(" + ")}`;
  if (s.kind === "miete") return `Miete ${C.fmtMonth(s.period)} · ${contractLabel(byId("contracts", s.contractId))}`;
  if (s.kind === "fewo") return `Rechnung ${byId("invoices", s.invoiceId)?.number || ""}`;
  if (s.kind === "ausgabe") return `${C.EXPENSE_CATEGORIES[s.category]?.label}${s.objectId ? " · " + (byId("objects", s.objectId)?.name || "") : ""}`;
  if (s.kind === "ignorieren") return "Ignorieren";
  return C.INCOME_KINDS[s.kind] || s.kind;
}

// ---------------------------------------------------------------- Formulare

const opt = (pairs, v) => pairs.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("");
const objectOpts = (empty = "– ohne –") => [["", empty], ...state.objects.map((o) => [o.id, o.name])];
const unitOpts = (filter = () => true) => state.units.filter(filter).map((u) => [u.id, unitLabel(u)]);
const contractOpts = () => state.contracts.map((c) => [c.id, contractLabel(c)]);

function fieldHtml(f, data) {
  const v = data[f.k];
  const cls = f.full || f.t === "textarea" || f.t === "checks" ? "f full" : "f";
  const attrs = `name="${f.k}" ${f.req ? "required" : ""} ${f.ph ? `placeholder="${esc(f.ph)}"` : ""}`;
  let input;
  switch (f.t) {
    case "select": input = `<select ${attrs}>${opt(typeof f.opts === "function" ? f.opts() : f.opts, v)}</select>`; break;
    case "textarea": input = `<textarea ${attrs}>${esc(v)}</textarea>`; break;
    case "money": input = `<input ${attrs} inputmode="decimal" value="${v || v === 0 ? esc(C.fmtNum(v)) : ""}">`; break;
    case "moneyOpt": input = `<input ${attrs} inputmode="decimal" value="${typeof v === "number" ? esc(C.fmtNum(v)) : ""}">`; break;
    case "number": input = `<input ${attrs} type="number" step="${f.step || 1}" value="${esc(v ?? "")}">`; break;
    case "checkbox": return `<label class="f inline ${f.full ? "full" : ""}"><input type="checkbox" name="${f.k}" ${v ? "checked" : ""}> ${esc(f.l)}</label>`;
    case "checks": {
      const opts = typeof f.opts === "function" ? f.opts() : f.opts;
      input = `<div class="checks">${opts.map(([k, l]) => `<label><input type="checkbox" name="${f.k}" value="${esc(k)}" ${(v || []).includes(k) ? "checked" : ""}> ${esc(l)}</label>`).join("") || '<span class="muted small">Noch keine Einträge vorhanden.</span>'}</div>`;
      break;
    }
    case "list": input = `<input ${attrs} value="${esc((v || []).join(", "))}">`; break;
    default: input = `<input ${attrs} type="${f.t || "text"}" value="${esc(v ?? "")}">`;
  }
  return `<label class="${cls}"><span>${esc(f.l)}${f.req ? " *" : ""}</span>${input}${f.hint ? `<small class="muted">${esc(f.hint)}</small>` : ""}</label>`;
}

function readFields(form, spec) {
  const fd = new FormData(form);
  const out = {};
  for (const f of spec) {
    if (f.t === "checkbox") out[f.k] = form.elements[f.k]?.checked || false;
    else if (f.t === "checks") out[f.k] = fd.getAll(f.k);
    else if (f.t === "money") out[f.k] = C.parseAmount(fd.get(f.k));
    else if (f.t === "moneyOpt") out[f.k] = String(fd.get(f.k) || "").trim() === "" ? undefined : Math.abs(C.parseAmount(fd.get(f.k)));
    else if (f.t === "number") out[f.k] = fd.get(f.k) === "" ? "" : Number(fd.get(f.k));
    else if (f.t === "list") out[f.k] = String(fd.get(f.k) || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    else out[f.k] = String(fd.get(f.k) ?? "").trim();
  }
  return out;
}

// Öffnet einen Dialog. body = HTML, onSubmit(form) → false hält den Dialog offen.
function dialog({ title, body, onSubmit, onDelete, submit = "Speichern", wide = false, onOpen }) {
  const dlg = $("#modal");
  dlg.className = wide ? "wide" : "";
  dlg.innerHTML = `<form method="dialog" novalidate>
    <div class="dh">${esc(title)}</div>
    <div class="db">${body}</div>
    <div class="df">
      ${onDelete ? '<button type="button" class="btn danger" data-dlg="delete">Löschen</button>' : ""}
      <span class="grow"></span>
      <button type="button" class="btn" data-dlg="cancel">Abbrechen</button>
      ${onSubmit ? `<button type="submit" class="btn primary">${esc(submit)}</button>` : ""}
    </div></form>`;
  const form = $("form", dlg);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const bad = [...form.querySelectorAll("[required]")].find((el) => !el.value.trim());
    if (bad) { bad.focus(); toast("Bitte Pflichtfelder ausfüllen."); return; }
    const r = onSubmit(form);
    if (r !== false && form.isConnected) dlg.close(); // ein währenddessen geöffneter neuer Dialog bleibt offen
  });
  form.querySelector('[data-dlg="cancel"]').onclick = () => dlg.close();
  const del = form.querySelector('[data-dlg="delete"]');
  if (del) del.onclick = () => { if (confirm("Wirklich löschen?")) { onDelete(); dlg.close(); } };
  dlg.showModal();
  if (onOpen) onOpen(form);
  return form;
}

function formDialog({ title, spec, data = {}, onSave, onDelete, wide, intro = "" }) {
  dialog({
    title, wide, onDelete,
    body: `${intro}<div class="fgrid">${spec.map((f) => fieldHtml(f, data)).join("")}</div>`,
    onSubmit: (form) => onSave(readFields(form, spec)),
  });
}

function upsert(list, item) {
  const arr = state[list];
  const i = arr.findIndex((x) => x.id === item.id);
  if (i > -1) arr[i] = item; else arr.push(item);
}

// ---------------------------------------------------------------- Stammdaten-Formulare

const SPEC = {
  object: [
    { k: "name", l: "Bezeichnung", req: 1, ph: "z. B. MFH Lindenstraße" },
    { k: "short", l: "Kürzel (für DATEV-Buchungstext)", ph: "LIN" },
    { k: "type", l: "Art", t: "select", opts: Object.entries(C.OBJECT_TYPES) },
    { k: "street", l: "Straße & Hausnummer" },
    { k: "zip", l: "PLZ" }, { k: "city", l: "Ort" },
    { k: "year", l: "Baujahr", t: "number" },
    { k: "plot", l: "Grundstücksfläche m²", t: "number" },
    { k: "purchaseDate", l: "Kaufdatum (Übergang Nutzen/Lasten)", t: "date" },
    { k: "purchasePrice", l: "Kaufpreis inkl. Nebenkosten (€)", t: "money" },
    { k: "buildingShare", l: "Davon Gebäudeanteil = AfA-Basis (€)", t: "money" },
    { k: "afaRate", l: "AfA-Satz in %", t: "number", step: 0.01, hint: "2 % (Baujahr 1925–2022), 2,5 % (vor 1925), 3 % (ab 2023)" },
    { k: "aktenzeichen", l: "Aktenzeichen Grundsteuerwert-/Einheitswertbescheid", hint: "Steht im Bescheid des Finanzamts – wird in der Anlage V abgefragt" },
    { k: "ehegatten", l: "Miteigentümer sind Ehegatten / eingetragene Lebenspartner", t: "checkbox" },
    { k: "kappung15", l: "Gebiet mit Kappungsgrenzen-Verordnung (15 % statt 20 %)", t: "checkbox" },
    { k: "mietpreisbremse", l: "Gebiet mit Mietpreisbremse (§ 556d BGB)", t: "checkbox" },
    { k: "vergleichsmiete", l: "Ortsübliche Vergleichsmiete laut Mietspiegel (€/m²)", t: "money", hint: "Für die Prüfung von Neuvermietung (Mietpreisbremse) und Mieterhöhung" },
    { k: "owners", l: "Eigentümer & Anteile (bei Miteigentum)", ph: "Max Mustermann 50; Erika Mustermann 50", full: 1, hint: "Für die Aufteilung der Anlage V je Person" },
    { k: "notes", l: "Notizen (Hausverwaltung, Grundbuch, Darlehen …)", t: "textarea" },
  ],
  unit: [
    { k: "objectId", l: "Objekt", t: "select", opts: () => state.objects.map((o) => [o.id, o.name]), req: 1 },
    { k: "name", l: "Bezeichnung", req: 1, ph: "WE 03 · 1. OG links" },
    { k: "type", l: "Art", t: "select", opts: Object.entries(C.UNIT_TYPES) },
    { k: "floor", l: "Lage / Etage" },
    { k: "area", l: "Wohn-/Nutzfläche m²", t: "number", step: 0.01 },
    { k: "rooms", l: "Zimmer", t: "number", step: 0.5 },
    { k: "vat", l: "Umsatzsteuer auf Miete", t: "select", opts: [["0", "automatisch (Wohnraum/Keller steuerfrei; Stellplatz/Garage je nach Mieter)"], ["7", "7 % (Beherbergung / Ferienwohnung)"], ["19", "19 % (Option nach § 9 UStG bei Gewerbe)"]] },
    { k: "nkUmlage", l: "An der Umlage der Hausnebenkosten beteiligt?", t: "select", opts: [["", "automatisch (Wohnung/Gewerbe/FeWo ja; Garage, Stellplatz, Keller nein)"], ["ja", "ja"], ["nein", "nein"]] },
    { k: "maxGuests", l: "Max. Gäste (Ferienwohnung)", t: "number" },
    { k: "smoobuName", l: "Name in Smoobu (für Import)", hint: "Nur für Ferienwohnungen, falls abweichend" },
    { k: "registrationNo", l: "Registrierungsnummer (Ferienwohnung)", hint: "Falls die Kommune eine Registrierung verlangt (EU-VO 2024/1028) – erscheint auf Rechnungen" },
    { k: "meters", l: "Zähler (Strom, Wasser, Gas …)", t: "textarea", ph: "Strom 12345678, Wasser kalt 99887" },
    { k: "features", l: "Ausstattung / Details", t: "textarea", ph: "Balkon, EBK, Keller Nr. 3, Bad mit Fenster …" },
  ],
  tenant: [
    { k: "name", l: "Name (wie auf Kontoauszug)", req: 1 },
    { k: "email", l: "E-Mail", t: "email" }, { k: "phone", l: "Telefon" },
    { k: "ibans", l: "IBAN(s) des Mieters – für automatische Zuordnung", t: "list", full: 1, hint: "Mehrere durch Komma trennen" },
    { k: "members", l: "Weitere Personen / Mitmieter", full: 1 },
    { k: "address", l: "Zustellanschrift (falls abweichend, z. B. nach Auszug)", full: 1 },
    { k: "prevAddress", l: "Bisherige Anschrift (vor Einzug)", full: 1 },
    { k: "notes", l: "Notizen", t: "textarea" },
  ],
  contract: [
    { k: "unitId", l: "Einheit", t: "select", opts: () => unitOpts((u) => u.type !== "ferienwohnung"), req: 1, full: 1 },
    { k: "tenantIds", l: "Mieter", t: "checks", opts: () => state.tenants.map((t) => [t.id, t.name]) },
    { k: "start", l: "Mietbeginn", t: "date", req: 1 }, { k: "end", l: "Mietende (leer = unbefristet)", t: "date" },
    { k: "kalt", l: "Kaltmiete (€/Monat)", t: "money" }, { k: "nk", l: "NK-/Heizkosten-Vorauszahlung (€/Monat)", t: "money" },
    { k: "extra", l: "Zuschläge (Stellplatz, Möblierung …)", t: "money" }, { k: "kaution", l: "Kaution (€)", t: "money" },
    { k: "ustRate", l: "Umsatzsteuer", t: "select", opts: [["", "keine (Wohnraum / privater Mieter)"], ["19", "zzgl. 19 % USt (gewerblicher Mieter)"], ["7", "zzgl. 7 % USt"]], hint: "Bei USt: Miete und Nebenkosten oben netto eintragen – die App rechnet die USt obendrauf." },
    { k: "persons", l: "Personen im Haushalt (für Umlage nach Personen)", t: "number" },
    { k: "kleinRepCase", l: "Kleinreparaturen: Grenze je Fall (€)", t: "money", hint: "Nur wenn im Vertrag vereinbart – üblich bis ca. 100–120 €" },
    { k: "kleinRepYear", l: "Kleinreparaturen: Höchstbetrag pro Jahr (€)", t: "money", hint: "Pflicht für eine wirksame Klausel – üblich 6–8 % der Jahreskaltmiete" },
    { k: "mietart", l: "Mietart", t: "select", opts: [["standard", "Normale Miete (Erhöhung nach § 558 BGB)"], ["staffel", "Staffelmiete (§ 557a BGB)"], ["index", "Indexmiete (§ 557b BGB)"]] },
    { k: "notes", l: "Notizen (Kündigungsfrist, Sondervereinbarungen …)", t: "textarea" },
  ],
  step: [
    { k: "from", l: "Gültig ab Monat", t: "month", req: 1 },
    { k: "kalt", l: "Neue Kaltmiete", t: "money" }, { k: "nk", l: "Neue NK-Vorauszahlung", t: "money" }, { k: "extra", l: "Neue Zuschläge", t: "money" },
  ],
  expense: [
    { k: "date", l: "Datum", t: "date", req: 1 }, { k: "amount", l: "Betrag brutto (€)", t: "money", req: 1 },
    { k: "category", l: "Kategorie", t: "select", opts: Object.entries(C.EXPENSE_CATEGORIES).map(([k, v]) => [k, v.label]) },
    { k: "objectId", l: "Objekt", t: "select", opts: () => objectOpts() },
    { k: "betrkv", l: "Betriebskostenart (für NK-Abrechnung)", t: "select", opts: () => [["", "– automatisch / keine –"], ...C.BETRKV.map(([k, l]) => [k, l])] },
    { k: "umlageAmount", l: "davon umlagefähig (€, leer = ganzer Betrag)", t: "moneyOpt", hint: "z. B. nur Pflege-/Wartungsanteil einer Hausmeister- oder Heizungsrechnung" },
    { k: "distribute", l: "Erhaltungsaufwand steuerlich verteilen", t: "select", opts: [["1", "sofort im Zahlungsjahr abziehen"], ["2", "auf 2 Jahre verteilen (§ 82b EStDV)"], ["3", "auf 3 Jahre"], ["4", "auf 4 Jahre"], ["5", "auf 5 Jahre"]], hint: "Nur bei Erhaltungsaufwand an Wohngebäuden" },
    { k: "vorsteuer", l: "darin enthaltene Vorsteuer (€)", t: "moneyOpt", hint: "Nur bei Regelbesteuerung (z. B. Ferienwohnung) – für die Umsatzsteuer-Voranmeldung" },
    { k: "vendor", l: "Empfänger / Firma" }, { k: "belegNr", l: "Belegnummer / Rechnungsnr." },
    { k: "note", l: "Notiz", t: "textarea" },
  ],
  payment: [
    { k: "date", l: "Zahlungsdatum", t: "date", req: 1 }, { k: "amount", l: "Betrag (€)", t: "money", req: 1 },
    { k: "kind", l: "Art", t: "select", opts: Object.entries(C.INCOME_KINDS).filter(([k]) => k !== "fewo") },
    { k: "contractId", l: "Mietvertrag", t: "select", opts: () => [["", "–"], ...contractOpts()] },
    { k: "period", l: "Für Monat", t: "month" }, { k: "note", l: "Notiz (z. B. bar erhalten)" },
  ],
  booking: [
    { k: "unitId", l: "Ferienwohnung", t: "select", opts: () => unitOpts((u) => u.type === "ferienwohnung"), req: 1, full: 1 },
    { k: "from", l: "Anreise", t: "date", req: 1 }, { k: "to", l: "Abreise", t: "date", req: 1 },
    { k: "guest", l: "Gast (Rechnungsempfänger)", req: 1 }, { k: "email", l: "E-Mail", t: "email" },
    { k: "nationality", l: "Staatsangehörigkeit", ph: "deutsch", hint: "Ausländische Gäste: Meldeschein ausfüllen und 12 Monate aufbewahren" },
    { k: "guestStreet", l: "Straße" }, { k: "guestZip", l: "PLZ" }, { k: "guestCity", l: "Ort" }, { k: "phone", l: "Telefon" },
    { k: "adults", l: "Erwachsene", t: "number" }, { k: "children", l: "Kinder", t: "number" },
    { k: "total", l: "Übernachtungspreis gesamt brutto (€)", t: "money" }, { k: "cleaning", l: "Endreinigung brutto (€)", t: "money" },
    { k: "kurtaxe", l: "Kurtaxe pro Erwachsenem & Nacht (€)", t: "money" },
    { k: "channel", l: "Kanal", t: "select", opts: ["Direkt", "Airbnb", "Booking.com", "FeWo-direkt / Vrbo", "Traum-Ferienwohnungen", "Sonstige"].map((x) => [x, x]) },
    { k: "status", l: "Status", t: "select", opts: [["bestaetigt", "bestätigt"], ["angefragt", "angefragt / Option"], ["storniert", "storniert"], ["eigennutzung", "Eigennutzung / gesperrt"]] },
    { k: "note", l: "Notiz", t: "textarea" },
  ],
  account: [
    { k: "name", l: "Bezeichnung", req: 1, ph: "Mietkonto Sparkasse" }, { k: "bank", l: "Bank" },
    { k: "iban", l: "IBAN", full: 1 },
  ],
};

function editObject(id) {
  const o = byId("objects", id) || { id: C.uid("o_"), type: "mfh", afaRate: 2 };
  formDialog({
    title: id ? "Objekt bearbeiten" : "Neues Objekt", spec: SPEC.object, data: o,
    onSave: (v) => { upsert("objects", { ...o, ...v }); commit("Objekt gespeichert"); },
    onDelete: id && (() => {
      if (state.units.some((u) => u.objectId === id)) return alert("Bitte zuerst die Einheiten dieses Objekts löschen.");
      state.objects = state.objects.filter((x) => x.id !== id); commit("Objekt gelöscht");
    }),
  });
}

function editUnit(id, objectId) {
  if (!state.objects.length) return toast("Bitte zuerst ein Objekt anlegen.");
  const lim = planOf()?.max_units;
  if (!id && isCloud() && isOwnWs() && lim && state.units.length >= lim) return alert(`Dein Tarif „${planOf().name}“ umfasst bis zu ${lim} Einheiten. Unter „Mein Konto“ kannst du auf einen größeren Tarif wechseln.`);
  const u = byId("units", id) || { id: C.uid("u_"), objectId: objectId || state.objects[0].id, type: "wohnung", vat: "0" };
  formDialog({
    title: id ? "Einheit bearbeiten" : "Neue Einheit", spec: SPEC.unit, data: { ...u, vat: String(u.vat ?? 0), nkUmlage: u.nkUmlage === true ? "ja" : u.nkUmlage === false ? "nein" : "" },
    onSave: (v) => {
      if (v.type === "ferienwohnung" && !id && v.vat === "0") v.vat = "7";
      if (Number(v.vat) === 19 && R.WOHNRAUM.includes(v.type) && !confirm("Wohnraumvermietung ist zwingend umsatzsteuerfrei (§ 4 Nr. 12 UStG, keine Option nach § 9 UStG möglich). Trotzdem 19 % setzen?")) return false;
      upsert("units", { ...u, ...v, vat: Number(v.vat), nkUmlage: v.nkUmlage === "ja" ? true : v.nkUmlage === "nein" ? false : undefined }); commit("Einheit gespeichert");
    },
    onDelete: id && (() => {
      if (state.contracts.some((c) => c.unitId === id) || state.bookings.some((b) => b.unitId === id)) return alert("Die Einheit hat noch Mietverträge oder Buchungen.");
      state.units = state.units.filter((x) => x.id !== id); commit("Einheit gelöscht");
    }),
  });
}

function editTenant(id) {
  const t = byId("tenants", id) || { id: C.uid("t_"), ibans: [] };
  formDialog({
    title: id ? "Mieter bearbeiten" : "Neuer Mieter", spec: SPEC.tenant, data: t,
    onSave: (v) => { upsert("tenants", { ...t, ...v, ibans: v.ibans.map(C.normIban) }); commit("Mieter gespeichert"); },
    onDelete: id && (() => deleteTenantAll(id, true)),
  });
}

// Mieter löschen (z. B. falsch angelegt): eigene Verträge und deren Zahlungen mit entfernen,
// Bank-Buchungen werden wieder „offen“ und können neu zugeordnet werden.
function deleteTenantAll(id, confirmed) {
  const t = byId("tenants", id); if (!t) return;
  const own = state.contracts.filter((c) => c.tenantIds.includes(id) && c.tenantIds.length === 1);
  const shared = state.contracts.filter((c) => c.tenantIds.includes(id) && c.tenantIds.length > 1);
  const cIds = new Set(own.map((c) => c.id));
  const pays = state.payments.filter((p) => cIds.has(p.contractId));
  const payIds = new Set(pays.map((p) => p.id));
  const txs = state.transactions.filter((tx) => tx.link?.type === "payment" && (tx.link.ids || [tx.link.id]).some((x) => payIds.has(x)));
  const msg = `„${t.name}“ wirklich löschen?\n\n` + [
    own.length ? `• ${own.length} Mietvertrag/-verträge (${own.map((c) => unitLabel(byId("units", c.unitId))).join(", ")}) werden gelöscht.` : "",
    pays.length ? `• ${pays.length} Zahlung(en) werden gelöscht${txs.length ? `; ${txs.length} Bank-Buchung(en) erscheinen wieder unter „Konto & Zahlungen → Offen“` : ""}.` : "",
    shared.length ? `• Aus ${shared.length} gemeinsamen Vertrag/Verträgen wird nur dieser Mieter entfernt.` : "",
    "• Dokumente bleiben unter „Belege & Dokumente“ erhalten.",
  ].filter(Boolean).join("\n") + "\n\nDas lässt sich nicht rückgängig machen.";
  if (!confirmed && !confirm(msg)) return false;
  if (confirmed && (own.length || pays.length) && !confirm(msg)) return false;
  for (const tx of txs) { const ids = tx.link.ids || [tx.link.id]; state.payments = state.payments.filter((p) => !ids.includes(p.id)); tx.link = null; }
  state.payments = state.payments.filter((p) => !payIds.has(p.id));
  state.contracts = state.contracts.filter((c) => !cIds.has(c.id));
  for (const c of shared) c.tenantIds = c.tenantIds.filter((x) => x !== id);
  state.meterReadings = (state.meterReadings || []).filter((r) => !cIds.has(r.contractId));
  state.tenants = state.tenants.filter((x) => x.id !== id);
  commit("Mieter gelöscht");
  if (location.hash.startsWith("#/mieter/")) location.hash = "#/mieter";
}

const legalNotes = (list) => list.length ? `<div class="legal">${list.map((x) => `<div class="note small ${x.level === "bad" ? "warn" : ""}">${x.level === "bad" ? "⚠️" : "§"} ${esc(x.text)}</div>`).join("")}</div>` : "";

// Zeigt rechtliche Warnungen und lässt den Nutzer bewusst entscheiden (nichts wird stillschweigend blockiert)
function confirmLegal(list) {
  const bad = list.filter((x) => x.level === "bad");
  return !bad.length || confirm(`Rechtlicher Hinweis:\n\n${bad.map((x) => "• " + x.text).join("\n\n")}\n\nTrotzdem speichern?`);
}

function contractLegal(c) {
  const u = byId("units", c.unitId);
  const list = [...R.depositCheck(u, c)];
  if (R.isParking(u)) { const v = R.vatFor(state, c); list.push({ level: "info", text: `Umsatzsteuer: ${v.reason}` }); }
  if (Number(c.ustRate) && R.isWohnraum(u)) list.push({ level: "bad", text: "Wohnraum ist zwingend umsatzsteuerfrei (§ 4 Nr. 12 UStG) – Umsatzsteuer nur bei gewerblich genutzten Räumen (Laden, Büro, Praxis, Lager) und nur, wenn der Mieter selbst vorsteuerabzugsberechtigt ist (§ 9 UStG)." });
  else if (Number(c.ustRate)) list.push({ level: "info", text: "Umsatzsteuer-Option (§ 9 UStG): nur zulässig, wenn der Mieter die Räume für sein umsatzsteuerpflichtiges Unternehmen nutzt. Die USt muss im Mietvertrag ausgewiesen sein (Vertrag gilt dann als Rechnung) und wird in der Umsatzsteuer-Voranmeldung abgeführt." });
  if (!R.isWohnraum(u) && u && u.type !== "ferienwohnung") list.push({ level: "info", text: "Kein Wohnraum: Kündigungsfristen und Mieterhöhung richten sich nach dem Vertrag (§ 580a BGB für Garagen/Stellplätze); Wohnraum-Schutzvorschriften gelten nicht." });
  return list;
}

function editContract(id, unitId) {
  if (!state.units.some((u) => u.type !== "ferienwohnung")) return toast("Bitte zuerst eine Einheit (Wohnung, Garage …) anlegen.");
  const c = byId("contracts", id) || { id: C.uid("c_"), unitId: unitId || "", tenantIds: [], steps: [], start: today().slice(0, 8) + "01" };
  formDialog({
    title: id ? "Mietvertrag bearbeiten" : "Neuer Mietvertrag", spec: SPEC.contract, data: c,
    intro: (id ? "" : `<div class="note">Tipp: Für einen <b>neuen Mieter</b> ist <button type="button" class="btn sm primary" data-act="moveWizardFromContract" data-id="${esc(unitId || "")}">+ Neuer Mieter / Einzug</button> einfacher – Mieter und Vertrag werden dort zusammen angelegt.</div>`) + (id ? legalNotes(contractLegal(c)) : ""),
    onSave: (v) => {
      if (!v.tenantIds.length) { toast("Bitte einen Mieter auswählen. Neuer Mieter? Dann „+ Neuer Mieter / Einzug“ nutzen – dort legst du Mieter und Vertrag in einem Schritt an."); return false; }
      if (!confirmLegal(contractLegal({ ...c, ...v }))) return false;
      upsert("contracts", { ...c, ...v }); commit("Mietvertrag gespeichert");
    },
    onDelete: id && (() => {
      if (state.payments.some((p) => p.contractId === id)) return alert("Zu diesem Vertrag gibt es Zahlungen. Bitte Vertrag stattdessen mit Mietende beenden.");
      state.contracts = state.contracts.filter((x) => x.id !== id); commit("Mietvertrag gelöscht");
    }),
  });
}

function addStep(id) {
  const c = byId("contracts", id);
  const r = C.rentForMonth(c, C.addMonths(ui.month, 1));
  formDialog({
    title: "Mietanpassung (Erhöhung, Staffel, Index, NK-Anpassung)", spec: SPEC.step,
    data: { from: C.addMonths(ui.month, 1), kalt: r.kalt, nk: r.nk, extra: r.extra },
    intro: `<p class="muted" style="margin-bottom:10px">${esc(contractLabel(c))} · ${esc({ standard: "normale Miete", staffel: "Staffelmiete", index: "Indexmiete" }[c.mietart || "standard"])}</p>
      ${R.isWohnraum(byId("units", c.unitId)) ? `<div class="note small">§ Wohnraum: Erhöhung frühestens 15 Monate nach Einzug/letzter Erhöhung wirksam, max. ${byId("objects", byId("units", c.unitId)?.objectId)?.kappung15 ? 15 : 20} % in 3 Jahren, nicht über der ortsüblichen Vergleichsmiete. Die App prüft das beim Speichern.</div>` : ""}`,
    onSave: (v) => {
      const u = byId("units", c.unitId);
      if (!confirmLegal(R.rentIncreaseCheck(u, byId("objects", u?.objectId), c, v))) return false;
      c.steps = [...(c.steps || []).filter((s) => s.from !== v.from), v]; commit("Mietanpassung gespeichert");
    },
  });
}

// ---------------------------------------------------------------- Bank: Zuordnung

function applyAssignment(tx, a, learn) {
  unlink(tx, true);
  if (a.kind === "ignorieren") tx.link = { type: "ignore" };
  else if (a.kind === "ausgabe") {
    const e = { id: C.uid("e_"), date: tx.date, amount: -tx.amount, category: a.category || "sonstiges", objectId: a.objectId || null, vendor: tx.name, note: tx.purpose, belegNr: "", txId: tx.id };
    state.expenses.push(e);
    tx.link = { type: "expense", id: e.id };
  } else if (a.kind === "miete" && a.splits?.length > 1) {
    const period = a.period || C.periodForPayment(tx.date, tx.purpose);
    const ps = a.splits.map((x) => ({ id: C.uid("p_"), date: tx.date, amount: x.amount, kind: "miete", contractId: x.contractId, period, invoiceId: null, objectId: null, txId: tx.id, note: `${tx.name} (Teil einer Sammelüberweisung)` }));
    state.payments.push(...ps);
    tx.link = { type: "payment", id: ps[0].id, ids: ps.map((x) => x.id) };
  } else {
    const p = { id: C.uid("p_"), date: tx.date, amount: tx.amount, kind: a.kind, contractId: a.contractId || null, period: a.kind === "miete" ? a.period || C.periodForPayment(tx.date, tx.purpose) : null, invoiceId: a.invoiceId || null, objectId: a.objectId || null, txId: tx.id, note: tx.name };
    state.payments.push(p);
    tx.link = { type: "payment", id: p.id };
    if (p.invoiceId) refreshInvoiceStatus(p.invoiceId);
  }
  if (learn && a.kind !== "fewo") {
    const r = { kind: a.kind };
    if (a.splits?.length > 1) r.contractIds = a.splits.map((x) => x.contractId);
    else if (a.contractId) r.contractId = a.contractId;
    if (a.category) r.category = a.category;
    if (a.objectId) r.objectId = a.objectId;
    state.rules[C.ruleKey(tx)] = r;
  }
}

function unlink(tx, silent) {
  if (!tx.link) return;
  if (tx.link.type === "payment") {
    const p = byId("payments", tx.link.id), ids = tx.link.ids || [tx.link.id];
    state.payments = state.payments.filter((x) => !ids.includes(x.id));
    if (p?.invoiceId) refreshInvoiceStatus(p.invoiceId);
  }
  if (tx.link.type === "expense") state.expenses = state.expenses.filter((x) => x.id !== tx.link.id);
  tx.link = null;
  if (!silent) commit("Zuordnung gelöst");
}

function refreshInvoiceStatus(invoiceId) {
  const inv = byId("invoices", invoiceId);
  if (!inv || ["storniert", "entwurf"].includes(inv.status) || inv.type === "storno") return;
  const paid = C.paidForInvoice(state, inv.id);
  inv.status = paid >= C.invoiceTotals(inv).gross ? "bezahlt" : paid > 0 ? "teilbezahlt" : "offen";
}

function autoAssign(txs) {
  let n = 0;
  const min = Number(state.settings.autoAssignScore) || 80;
  for (const tx of txs) {
    if (tx.link) continue;
    const s = C.suggestAssignment(tx, state);
    if (s && s.score >= min) { applyAssignment(tx, s, false); n++; }
  }
  return n;
}

function assignDialog(txId) {
  const tx = byId("transactions", txId);
  const sug = C.suggestAssignment(tx, state) || {};
  const credit = tx.amount > 0;
  const kinds = credit
    ? [["miete", "Miete"], ["fewo", "Ferienwohnung-Rechnung"], ["nk_nachzahlung", "Nebenkosten-Nachzahlung"], ["kaution", "Kaution"], ["sonstige", "Sonstige Einnahme"], ["ignorieren", "Ignorieren (privat / Umbuchung)"]]
    : [["ausgabe", "Ausgabe / Werbungskosten"], ["ignorieren", "Ignorieren (privat / Umbuchung)"], ["miete", "Mietrückzahlung (negativ)"]];
  const kind = sug.kind || kinds[0][0];
  const invOpts = state.invoices.filter((i) => i.type !== "storno" && !["storniert", "entwurf"].includes(i.status)).map((i) => [i.id, `${i.number} · ${C.recipientName(i.recipient)} · ${eur(C.invoiceTotals(i).gross)} (${i.status})`]);
  const body = `
    <div class="note"><b>${eur(tx.amount)}</b> · ${d(tx.date)} · ${esc(tx.name)}<br><span class="small">${esc(tx.purpose)}</span>${tx.iban ? `<br><span class="small muted">${esc(tx.iban)}</span>` : ""}</div>
    <div class="fgrid">
      <label class="f full"><span>Zuordnen als</span><select name="kind">${opt(kinds, kind)}</select></label>
      <label class="f full" data-for="miete nk_nachzahlung kaution"><span>Mietvertrag</span><select name="contractId">${opt([["", "–"], ...contractOpts()], sug.contractId)}</select></label>
      <div class="f full" data-for="miete"><details ${sug.splits ? "open" : ""}><summary class="small" style="cursor:pointer">Auf mehrere Verträge aufteilen (z. B. 2 Garagen mit einer Überweisung)${sug.splits ? " – <b>vorgeschlagen</b>" : ""}</summary>
        <div class="checks" style="flex-direction:column;align-items:flex-start;margin-top:6px">${state.contracts.filter((c) => C.contractActiveIn(c, sug.period || C.periodForPayment(tx.date, tx.purpose)) || C.contractActiveIn(c, C.monthKey(tx.date))).map((c) => `<label><input type="checkbox" name="split" value="${esc(c.id)}" ${sug.splits?.some((x) => x.contractId === c.id) ? "checked" : ""}> ${esc(contractLabel(c))} <span class="muted small">${eur(C.rentForMonth(c, sug.period || C.periodForPayment(tx.date, tx.purpose)).total)}</span></label>`).join("")}</div>
        <p class="small muted">Ab 2 Häkchen wird der Betrag nach den Warmmieten auf die Verträge verteilt. Das Feld „Mietvertrag“ oben wird dann nicht verwendet.</p></details></div>
      <label class="f" data-for="miete"><span>Für Monat (Soll)</span><input type="month" name="period" value="${esc(sug.period || C.periodForPayment(tx.date, tx.purpose))}"></label>
      <label class="f full" data-for="fewo"><span>Rechnung</span><select name="invoiceId">${opt([["", "–"], ...invOpts], sug.invoiceId)}</select></label>
      <label class="f" data-for="ausgabe"><span>Kategorie</span><select name="category">${opt(Object.entries(C.EXPENSE_CATEGORIES).map(([k, v]) => [k, v.label]), sug.category || "sonstiges")}</select></label>
      <label class="f" data-for="ausgabe sonstige"><span>Objekt</span><select name="objectId">${opt(objectOpts(), sug.objectId)}</select></label>
      <label class="f inline full" data-for="miete nk_nachzahlung kaution sonstige ausgabe ignorieren"><input type="checkbox" name="learn" checked> Regel merken: künftige Umsätze von „${esc(tx.name || tx.iban)}“ automatisch so zuordnen</label>
    </div>`;
  dialog({
    title: "Bankumsatz zuordnen", body, submit: "Zuordnen",
    onOpen: (form) => {
      const sync = () => form.querySelectorAll("[data-for]").forEach((el) => { el.style.display = el.dataset.for.split(" ").includes(form.kind.value) ? "" : "none"; });
      form.kind.addEventListener("change", sync); sync();
    },
    onSubmit: (form) => {
      const a = { kind: form.kind.value, contractId: form.contractId.value, period: form.period.value, invoiceId: form.invoiceId.value, category: form.category.value, objectId: form.objectId.value };
      const split = [...form.querySelectorAll("input[name=split]:checked")].map((el) => el.value);
      if (a.kind === "miete" && split.length > 1) {
        const parts = C.splitAmount(tx.amount, split.map((id) => C.rentForMonth(byId("contracts", id), a.period).total));
        a.splits = split.map((contractId, i) => ({ contractId, amount: parts[i] }));
        a.contractId = split[0];
      }
      if (["miete", "nk_nachzahlung"].includes(a.kind) && !a.contractId) { toast("Bitte Mietvertrag wählen."); return false; }
      if (a.kind === "fewo" && !a.invoiceId) { toast("Bitte Rechnung wählen."); return false; }
      applyAssignment(tx, a, form.learn.checked);
      commit("Zugeordnet");
    },
  });
}

// ---------------------------------------------------------------- Bank: Import

async function importFile(file, accountId) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buf); // viele Banken liefern ANSI
  if (/<(\w+:)?Document[\s>]/.test(text) && /Ntry/.test(text)) return finishImport(C.parseCamt(text, accountId));
  const rows = C.parseCsv(text);
  if (rows.length < 2) return toast("Datei enthält keine Umsätze.");
  const det = C.detectCsv(rows);
  csvMappingDialog(rows, det, accountId);
}

function csvMappingDialog(rows, det, accountId) {
  const cols = [["", "– nicht vorhanden –"], ...det.headers.map((h, i) => [String(i), h || `Spalte ${i + 1}`])];
  const fields = [["date", "Buchungsdatum *"], ["amount", "Betrag (±)"], ["credit", "…oder: Haben / Eingang"], ["debit", "…und: Soll / Ausgang"], ["name", "Name Auftraggeber/Empfänger"], ["iban", "IBAN Gegenkonto"], ["purpose", "Verwendungszweck"]];
  const preview = rows.slice(det.headerIdx + 1, det.headerIdx + 4);
  const body = `<p class="muted" style="margin-bottom:10px">Spalten wurden automatisch erkannt – bitte kurz prüfen.</p>
    <div class="fgrid">${fields.map(([k, l]) => `<label class="f"><span>${l}</span><select name="${k}">${opt(cols, det.mapping[k] ?? "")}</select></label>`).join("")}
    <label class="f"><span>Kopfzeile in Zeile</span><input type="number" name="headerIdx" min="1" value="${det.headerIdx + 1}"></label></div>
    <h3>Vorschau</h3><div class="table-wrap"><table><tr>${det.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
    ${preview.map((r) => `<tr>${r.map((c) => `<td class="small">${esc(c)}</td>`).join("")}</tr>`).join("")}</table></div>`;
  dialog({
    title: "CSV-Import: Spalten zuordnen", body, wide: true, submit: "Importieren",
    onSubmit: (form) => {
      const m = {};
      for (const [k] of fields) if (form[k].value !== "") m[k] = Number(form[k].value);
      if (m.date === undefined || (m.amount === undefined && m.credit === undefined)) { toast("Datum und Betrag müssen zugeordnet sein."); return false; }
      finishImport(C.txFromCsv(rows, Number(form.headerIdx.value) - 1, m, accountId));
    },
  });
}

function finishImport(txs) {
  const known = new Set(state.transactions.map((t) => t.hash));
  const fresh = txs.filter((t) => !known.has(t.hash) && (known.add(t.hash), true));
  state.transactions.push(...fresh);
  const n = autoAssign(fresh);
  commit(`${fresh.length} neue Umsätze importiert (${txs.length - fresh.length} Duplikate übersprungen), ${n} automatisch zugeordnet.`);
}

// ---------------------------------------------------------------- Ferienwohnung & Rechnungen

function editBooking(id, preset = {}) {
  if (!fewoUnits().length) return toast("Bitte zuerst eine Einheit vom Typ „Ferienwohnung“ anlegen.");
  const b = byId("bookings", id) || { id: C.uid("b_"), unitId: fewoUnits()[0].id, adults: 2, children: 0, channel: "Direkt", status: "bestaetigt", kurtaxe: state.settings.defaultKurtaxe || 0, cleaning: state.settings.defaultCleaning || 0, ...preset };
  formDialog({
    title: id ? "Buchung bearbeiten" : "Neue Buchung", spec: SPEC.booking, data: b, wide: true,
    onSave: (v) => {
      if (v.to <= v.from) { toast("Abreise muss nach der Anreise liegen."); return false; }
      const nb = { ...b, ...v };
      const clash = state.bookings.find((x) => C.bookingsOverlap(nb, x));
      if (clash && !confirm(`Überschneidung mit Buchung „${clash.guest}“ (${d(clash.from)}–${d(clash.to)}). Trotzdem speichern?`)) return false;
      upsert("bookings", nb); commit("Buchung gespeichert");
    },
    onDelete: id && (() => {
      if (b.invoiceId) return alert("Zu dieser Buchung existiert eine Rechnung. Bitte Buchung stornieren statt löschen.");
      state.bookings = state.bookings.filter((x) => x.id !== id); commit("Buchung gelöscht");
    }),
  });
}

function takeInvoiceNumber(dateIso) {
  const n = C.nextInvoiceNumber(state.settings, dateIso);
  state.settings.invoiceCounters = { ...(state.settings.invoiceCounters || {}), [n.year]: n.n };
  return n.number;
}

// Rechnungsentwurf aus einer Buchung (auch Booking.com/Airbnb über Smoobu): Gast, Anschrift, Kanal und Buchungsnr. werden übernommen
function createInvoiceDraft(b) {
  const u = byId("units", b.unitId);
  const inv = {
    id: C.uid("i_"), number: "", date: today(), serviceFrom: b.from, serviceTo: b.to, bookingId: b.id, unitId: b.unitId,
    recipient: C.recipientFromBooking(b), guestName: b.guest || "",
    lines: C.linesFromBooking(b, u), kleinunternehmer: !!state.settings.kleinunternehmer, status: "entwurf", type: "rechnung",
    note: C.channelNote(b), paidVia: /airbnb/i.test(b.channel || "") ? "portal" : "",
  };
  state.invoices.push(inv);
  b.invoiceId = inv.id;
  return inv;
}

function invoiceFromBooking(bookingId) {
  const b = byId("bookings", bookingId);
  if (b.invoiceId && byId("invoices", b.invoiceId)) { location.hash = `#/rechnung/${b.invoiceId}`; return; }
  if (blockedWrite()) return;
  const inv = createInvoiceDraft(b);
  persist();
  location.hash = `#/rechnung/${inv.id}`;
  toast("Rechnungsentwurf erstellt – Empfänger prüfen (z. B. Firma statt Gast) und dann festschreiben");
}

// Buchungen, für die noch eine Rechnung fehlt (Portal- und Direktbuchungen)
const bookingsWithoutInvoice = () => state.bookings
  .filter((b) => !["storniert", "eigennutzung"].includes(b.status) && !(b.invoiceId && byId("invoices", b.invoiceId)) && b.from >= `${Number(today().slice(0, 4)) - 1}-01-01` && b.from <= addDays(today(), 60))
  .sort((a, b) => (a.from < b.from ? -1 : 1));

// ---- Empfängerfelder (Gast oder Firma)
function recipientFieldsHtml(r0 = {}) {
  const r = { ...r0 };
  if (!(r.street || r.zip || r.city) && r.address) { // Altformat (Freitext) in Felder aufteilen
    const lines = String(r.address).split(/\n/).map((x) => x.trim()).filter(Boolean);
    const m = (lines[lines.length - 1] || "").match(/^(\d{4,5})\s+(.+)$/);
    if (m) { r.zip = m[1]; r.city = m[2]; r.street = lines.slice(0, -1).join(", "); } else r.street = lines.join(", ");
  }
  return `<div class="fgrid">
      <label class="f"><span>Firma <small class="muted">(leer lassen bei Privatgast)</small></span><input name="rcompany" value="${esc(r.company || "")}" placeholder="z. B. Muster GmbH"></label>
      <label class="f"><span>Name (Gast bzw. Ansprechpartner) *</span><input name="rname" value="${esc(r.name || "")}"></label>
      <label class="f"><span>Straße & Hausnummer</span><input name="rstreet" value="${esc(r.street || "")}"></label>
      <label class="f"><span>PLZ / Ort</span><span class="inline"><input name="rzip" value="${esc(r.zip || "")}" style="max-width:90px"><input name="rcity" value="${esc(r.city || "")}"></span></label>
      <label class="f"><span>Land <small class="muted">(leer = Deutschland)</small></span><input name="rcountry" value="${esc(r.country || "")}" placeholder="z. B. AT, NL"></label>
      <label class="f"><span>USt-IdNr. der Firma (optional)</span><input name="rvat" value="${esc(r.vatId || "")}"></label>
      <label class="f full"><span>E-Mail für den Rechnungsversand</span><input name="remail" type="email" value="${esc(r.email || "")}" placeholder="z. B. buchhaltung@firma.de"></label>
    </div>`;
}
function readRecipient(form) {
  const v = (k) => (form[k]?.value || "").trim();
  return { name: v("rname"), company: v("rcompany"), attn: "", street: v("rstreet"), zip: v("rzip"), city: v("rcity"), country: v("rcountry"), vatId: v("rvat"), email: v("remail"), business: !!v("rcompany") };
}

function recipientDialog(id) {
  const inv = byId("invoices", id);
  const final = inv.status !== "entwurf";
  dialog({
    title: final ? `Empfänger ändern – Rechnung ${inv.number}` : "Rechnungsempfänger",
    submit: final ? "Korrigierte Rechnung erstellen" : "Übernehmen",
    body: `${final ? `<div class="note">Festgeschriebene Rechnungen dürfen nicht überschrieben werden (GoBD, § 14 UStG). Deshalb erstellt die App automatisch eine <b>Stornorechnung</b> zu ${esc(inv.number)} und eine <b>neue Rechnung mit neuer Nummer</b> an den geänderten Empfänger – mit Hinweis „ersetzt Rechnung ${esc(inv.number)}“. Bereits erfasste Zahlungen werden übernommen; beide PDFs werden abgelegt.</div>` : ""}
      ${inv.guestName ? `<p class="small muted" style="margin-bottom:8px">Gast laut Buchung: <b>${esc(inv.guestName)}</b>${byId("bookings", inv.bookingId)?.channel ? ` · ${esc(byId("bookings", inv.bookingId).channel)}` : ""}</p>` : ""}
      ${recipientFieldsHtml(inv.recipient)}`,
    onSubmit: (form) => {
      const r = readRecipient(form);
      if (!r.name && !r.company) { toast("Bitte Name oder Firma angeben."); return false; }
      if (!final) { if (blockedWrite()) return; inv.recipient = r; commit("Empfänger übernommen"); return; }
      correctInvoiceRecipient(id, r);
    },
  });
}

function editInvoice(id) {
  const isNew = !id;
  const inv = byId("invoices", id) || { id: C.uid("i_"), number: "", date: today(), recipient: { name: "", address: "" }, lines: [{ desc: "Übernachtung", qty: 1, price: 0, vat: 7 }], kleinunternehmer: !!state.settings.kleinunternehmer, status: "entwurf", type: "rechnung", unitId: fewoUnits()[0]?.id || "" };
  if (inv.status !== "entwurf") return alert("Festgeschriebene Rechnungen dürfen nicht mehr geändert werden (GoBD). Bitte stornieren und eine neue Rechnung erstellen.");
  const lineRow = (l = {}) => `<tr>
    <td><input name="desc" value="${esc(l.desc || "")}"></td>
    <td style="width:80px"><input name="qty" type="number" step="0.01" value="${esc(l.qty ?? 1)}"></td>
    <td style="width:110px"><input name="price" inputmode="decimal" value="${esc(C.fmtNum(l.price || 0))}"></td>
    <td style="width:90px"><select name="vat">${opt([["7", "7 %"], ["19", "19 %"], ["0", "0 %"]], String(l.vat ?? 7))}</select></td>
    <td style="width:60px;text-align:center"><input type="checkbox" name="pt" ${l.passThrough ? "checked" : ""} title="durchlaufender Posten (z. B. Kurtaxe)"></td>
    <td style="width:36px"><button type="button" class="btn sm link" data-del-line>✕</button></td></tr>`;
  const body = `<div class="fgrid">
      <label class="f"><span>Rechnungsdatum</span><input type="date" name="date" value="${esc(inv.date)}" required></label>
      <label class="f"><span>Ferienwohnung / Einheit</span><select name="unitId">${opt([["", "–"], ...unitOpts()], inv.unitId)}</select></label>
      <label class="f"><span>Leistungszeitraum von</span><input type="date" name="serviceFrom" value="${esc(inv.serviceFrom || "")}"></label>
      <label class="f"><span>bis</span><input type="date" name="serviceTo" value="${esc(inv.serviceTo || "")}"></label>
    </div>
    <h3 style="margin:6px 0">Rechnungsempfänger</h3>
    ${recipientFieldsHtml(inv.recipient)}
    <div class="table-wrap"><table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Einzelpreis brutto</th><th>USt</th><th>durchl.</th><th></th></tr></thead>
    <tbody id="lines">${inv.lines.map(lineRow).join("")}</tbody></table></div>
    <button type="button" class="btn sm" id="addLine" style="margin:8px 0 12px">+ Position</button>
    <label class="f inline"><input type="checkbox" name="ku" ${inv.kleinunternehmer ? "checked" : ""}> Kleinunternehmer (§ 19 UStG) – keine Umsatzsteuer ausweisen</label>
    <label class="f"><span>Zahlung</span><select name="paidVia">${opt(PAID_VIA(byId("bookings", inv.bookingId)?.channel), inv.paidVia || "")}</select></label>
    <label class="f"><span>Hinweis auf der Rechnung</span><textarea name="note">${esc(inv.note || "")}</textarea></label>`;
  dialog({
    title: isNew ? "Neuer Rechnungsentwurf" : "Rechnungsentwurf bearbeiten", body, wide: true,
    onOpen: (form) => {
      form.querySelector("#addLine").onclick = () => form.querySelector("#lines").insertAdjacentHTML("beforeend", lineRow({ vat: 19 }));
      form.addEventListener("click", (e) => { if (e.target.matches("[data-del-line]")) e.target.closest("tr").remove(); });
    },
    onSubmit: (form) => {
      const lines = [...form.querySelectorAll("#lines tr")].map((tr) => ({
        desc: tr.querySelector("[name=desc]").value.trim(), qty: Number(tr.querySelector("[name=qty]").value) || 0,
        price: C.parseAmount(tr.querySelector("[name=price]").value), vat: Number(tr.querySelector("[name=vat]").value),
        passThrough: tr.querySelector("[name=pt]").checked,
      })).filter((l) => l.desc || l.price);
      if (!lines.length) { toast("Mindestens eine Position angeben."); return false; }
      if (!form.rname.value.trim() && !form.rcompany.value.trim()) { toast("Bitte Name oder Firma des Empfängers angeben."); return false; }
      Object.assign(inv, {
        date: form.date.value, unitId: form.unitId.value, serviceFrom: form.serviceFrom.value, serviceTo: form.serviceTo.value,
        recipient: readRecipient(form), lines, kleinunternehmer: form.ku.checked, note: form.note.value.trim(), paidVia: form.paidVia.value,
      });
      if (isNew) state.invoices.push(inv);
      refreshInvoiceStatus(inv.id);
      persist();
      location.hash = `#/rechnung/${inv.id}`;
      render();
    },
  });
}

// Festschreiben: Pflichtangaben (§ 14 Abs. 4 UStG) prüfen, fortlaufende Nummer vergeben, danach unveränderbar
function invoiceMissing(inv) {
  const s = state.settings, t = C.invoiceTotals(inv);
  return [
    !s.ownerName && "Name des Vermieters (Einstellungen)", !(s.ownerStreet && s.ownerCity) && "Anschrift des Vermieters (Einstellungen)",
    !s.taxNumber && !s.vatId && "Steuernummer oder USt-IdNr. (Einstellungen)", !C.recipientName(inv.recipient) && "Name des Empfängers",
    t.gross > 25000 && !C.recipientHasAddress(inv.recipient) && "Anschrift des Empfängers (Pflicht ab 250 € brutto)",
    !inv.serviceFrom && "Leistungszeitraum", !(inv.lines || []).length && "Positionen",
  ].filter(Boolean);
}

async function finalizeInvoice(id) {
  let inv = byId("invoices", id);
  const miss = invoiceMissing(inv);
  if (miss.length) return alert(`Für eine ordnungsgemäße Rechnung fehlt noch:\n• ${miss.join("\n• ")}`);
  if (!confirm("Rechnung festschreiben? Sie erhält eine fortlaufende Rechnungsnummer und kann danach nicht mehr geändert, sondern nur noch storniert werden (GoBD).")) return;
  if (blockedWrite()) return;
  await freshForNumbering();
  inv = byId("invoices", id);
  if (!inv || inv.status !== "entwurf") { render(); return toast("Diese Rechnung wurde inzwischen von jemand anderem bearbeitet."); }
  inv.date = today();
  inv.number = takeInvoiceNumber(inv.date);
  inv.status = "offen";
  inv.finalizedAt = new Date().toISOString();
  refreshInvoiceStatus(inv.id);
  commit(`Rechnung ${inv.number} festgeschrieben`);
  if (isCloud()) { clearTimeout(auth.syncTimer); syncNow(); }
  await archiveInvoicePdf(inv.id);
}

// Im Team: vor dem Vergeben einer Rechnungsnummer den neuesten Stand holen (keine doppelten Nummern)
async function freshForNumbering() {
  if (!isCloud()) return;
  clearTimeout(auth.syncTimer); await syncNow(); await pullRemote({ force: true });
}

function makeStorno(inv) {
  const st = { ...structuredClone(inv), id: C.uid("i_"), number: takeInvoiceNumber(today()), date: today(), type: "storno", refNumber: inv.number, status: "storno",
    lines: inv.lines.map((l) => ({ ...l, price: -l.price })), note: `Storno zu Rechnung ${inv.number} vom ${d(inv.date)}.`, pdfDocId: null, sentLog: [], finalizedAt: new Date().toISOString() };
  inv.status = "storniert";
  state.invoices.push(st);
  return st;
}

// Empfänger einer festgeschriebenen Rechnung ändern: Storno + neue Rechnung (GoBD-konform)
async function correctInvoiceRecipient(id, r) {
  if (blockedWrite()) return;
  await freshForNumbering();
  const inv = byId("invoices", id);
  if (!inv || inv.type === "storno" || ["storniert", "entwurf"].includes(inv.status)) return toast("Diese Rechnung kann nicht (mehr) korrigiert werden.");
  const st = makeStorno(inv);
  const neu = { ...structuredClone(inv), id: C.uid("i_"), recipient: r, date: today(), status: "offen", type: "rechnung", finalizedAt: new Date().toISOString(),
    replaces: inv.number, pdfDocId: null, sentLog: [],
    note: [`Diese Rechnung ersetzt Rechnung ${inv.number} vom ${d(inv.date)} (geänderter Rechnungsempfänger).`, (inv.note || "").replace(/^Diese Rechnung ersetzt.*\n?/, "")].filter(Boolean).join("\n") };
  neu.number = takeInvoiceNumber(neu.date);
  state.invoices.push(neu);
  for (const pay of state.payments) if (pay.invoiceId === inv.id) pay.invoiceId = neu.id;
  const b = byId("bookings", inv.bookingId); if (b) b.invoiceId = neu.id;
  refreshInvoiceStatus(neu.id);
  commit(`Storno ${st.number} und neue Rechnung ${neu.number} erstellt`);
  if (isCloud()) { clearTimeout(auth.syncTimer); syncNow(); }
  await archiveInvoicePdf(st.id, { quiet: true });
  await archiveInvoicePdf(neu.id);
  location.hash = `#/rechnung/${neu.id}`;
}

function deleteDraft(id) {
  const inv = byId("invoices", id);
  if (inv.status !== "entwurf" || !confirm("Entwurf löschen?")) return;
  state.invoices = state.invoices.filter((x) => x.id !== id);
  const b = byId("bookings", inv.bookingId); if (b) b.invoiceId = null;
  location.hash = "#/rechnungen"; commit("Entwurf gelöscht");
}

async function cancelInvoice(id) {
  let inv = byId("invoices", id);
  if (!confirm(`Rechnung ${inv.number} stornieren? Es wird eine Stornorechnung mit eigener Nummer erstellt.`)) return;
  if (blockedWrite()) return;
  await freshForNumbering();
  inv = byId("invoices", id);
  if (!inv || inv.status === "storniert") { render(); return toast("Diese Rechnung wurde bereits storniert."); }
  const st = makeStorno(inv);
  const b = byId("bookings", inv.bookingId);
  if (b) b.invoiceId = null;
  commit(`Stornorechnung ${st.number} erstellt`);
  if (isCloud()) { clearTimeout(auth.syncTimer); syncNow(); }
  location.hash = `#/rechnung/${st.id}`;
  await archiveInvoicePdf(st.id);
}

function markPaid(id) {
  const inv = byId("invoices", id);
  const open = C.invoiceTotals(inv).gross - C.paidForInvoice(state, id);
  formDialog({
    title: `Zahlung zu ${inv.number} erfassen`, data: { date: today(), amount: open },
    spec: [{ k: "date", l: "Datum", t: "date", req: 1 }, { k: "amount", l: "Betrag", t: "money", req: 1 }, { k: "via", l: "Zahlweg", t: "select", opts: [["kasse", "Bar / Kasse"], ["bank", "Überweisung (ohne Kontoimport)"]] }],
    intro: `<div class="note">Tipp: Bei importierten Kontoumsätzen die Zahlung lieber unter „Bank“ zuordnen – dann ist sie automatisch verknüpft.</div>`,
    onSave: (v) => {
      state.payments.push({ id: C.uid("p_"), date: v.date, amount: v.amount, kind: "fewo", invoiceId: id, txId: v.via === "bank" ? "manuell" : null, note: C.recipientName(inv.recipient) });
      refreshInvoiceStatus(id); commit("Zahlung erfasst");
    },
  });
}

async function smoobuImport({ silent = false } = {}) {
  try {
    if (!silent) toast("Hole Buchungen von Smoobu …");
    let data;
    if (isCloud()) data = await callFn("immo-smoobu", { owner: wsId() });
    else {
      const res = await fetch("/.netlify/functions/smoobu-sync?gaeste=1");
      data = await res.json().catch(() => ({ success: false, error: `Smoobu-Funktion nicht erreichbar (${res.status})` }));
      if (!data.success) throw new Error(data.error || "Unbekannter Fehler");
    }
    let added = 0, updated = 0, drafts = 0, unknown = new Set();
    for (const sb of data.buchungen) {
      const unit = fewoUnits().find((u) => C.normalize(u.smoobuName || u.name) === C.normalize(sb.einheit_name));
      if (!unit) { unknown.add(sb.einheit_name); continue; }
      const existing = state.bookings.find((b) => b.smoobuId === sb.smoobu_id);
      const v = { unitId: unit.id, guest: sb.gast_name, from: sb.start_datum, to: sb.end_datum, adults: sb.erwachsene || sb.personen, children: sb.kinder || 0, total: Math.round((sb.preis || 0) * 100), channel: sb.kanal, status: sb.status === "cancelled" ? "storniert" : "bestaetigt", smoobuId: sb.smoobu_id,
        ...(sb.email ? { email: sb.email } : {}), ...(sb.telefon ? { phone: sb.telefon } : {}),
        ...(sb.adresse?.street || sb.adresse?.location ? { guestStreet: sb.adresse.street || "", guestZip: sb.adresse.postalCode || "", guestCity: sb.adresse.location || "", guestCountry: sb.adresse.country || "" } : {}),
        ...(sb.firma ? { guestCompany: sb.firma } : {}), ...(sb.referenz ? { channelRef: String(sb.referenz) } : {}) };
      if (existing) { const changed = ["from", "to", "status", "total", "guest"].some((k) => existing[k] !== v[k]); Object.assign(existing, v); if (changed) updated++; }
      else {
        const nb = { id: C.uid("b_"), children: 0, cleaning: 0, kurtaxe: state.settings.defaultKurtaxe || 0, note: "", ...v };
        state.bookings.push(nb); added++;
        if (state.settings.autoInvoiceDrafts && nb.status !== "storniert") { createInvoiceDraft(nb); drafts++; }
      }
    }
    ui.smoobuUnknown = [...unknown];
    if (silent) return { added, updated, drafts, unknown: [...unknown] };
    commit(`Smoobu: ${added} neu, ${updated} aktualisiert${drafts ? `, ${drafts} Rechnungsentwürfe` : ""}`);
    if (unknown.size) smoobuMapDialog([...unknown]);
  } catch (e) {
    if (silent) throw e;
    if (isCloud()) { if (/nicht verbunden/.test(e.message)) smoobuConnect(); else alert(`Smoobu-Abruf fehlgeschlagen: ${e.message}`); }
    else alert(`Smoobu-Import fehlgeschlagen: ${e.message}\n\nIm lokalen Modus funktioniert der Import nur mit SMOOBU_API_KEY + SMOOBU_API_SECRET in Netlify. Mit Konto (Anmeldung) trägst du den Smoobu-Zugang einfach in der App ein.`);
  }
}

// Smoobu-Wohnungen, die es in Homevio noch nicht gibt: zuordnen oder als Ferienwohnung anlegen
function smoobuMapDialog(names) {
  if (!state.objects.length) return alert(`Smoobu meldet die Wohnung(en) ${names.join(", ")}. Lege zuerst unter „Häuser & Wohnungen“ das Objekt an, danach kannst du sie zuordnen.`);
  const choices = [["", "– nicht übernehmen –"], ...fewoUnits().map((u) => [`u:${u.id}`, `ist: ${unitLabel(u)}`]), ...state.objects.map((o) => [`o:${o.id}`, `neu als Ferienwohnung in „${o.name}“`])];
  dialog({
    title: "Smoobu-Wohnungen zuordnen", submit: "Übernehmen und Buchungen holen",
    body: `<p class="muted" style="margin-bottom:10px">Diese Wohnungen kommen aus Smoobu und sind in Homevio noch nicht bekannt. Einmal zuordnen – danach geht es automatisch.</p>
      ${names.map((n, i) => `<label class="f"><span>🏖 ${esc(n)}</span><select name="m${i}">${opt(choices, fewoUnits().length ? "" : `o:${state.objects[0].id}`)}</select></label>`).join("")}`,
    onSubmit: (form) => {
      let n = 0;
      names.forEach((name, i) => {
        const v = form[`m${i}`].value;
        if (v.startsWith("u:")) { const u = byId("units", v.slice(2)); if (u) { u.smoobuName = name; n++; } }
        else if (v.startsWith("o:")) { state.units.push({ id: C.uid("u_"), objectId: v.slice(2), type: "ferienwohnung", name, smoobuName: name, vat: 7 }); n++; }
      });
      commit(`${n} Wohnung(en) zugeordnet`);
      if (n) setTimeout(() => smoobuImport(), 50);
    },
  });
}

// Smoobu verbinden: API-Key und API-Secret einmal eintragen (gilt für diesen Bestand, bleibt auf dem Server)
function smoobuConnect() {
  if (!isCloud()) return alert("Smoobu verbinden geht im Konto-Modus (mit Anmeldung).");
  if (!isOwnWs()) return alert("Smoobu kann nur der Inhaber des Bestands verbinden.");
  dialog({
    title: "Smoobu verbinden", submit: "Verbinden & testen",
    body: `<ol class="steps small" style="margin-bottom:12px">
        <li>In Smoobu anmelden → <b>Einstellungen</b> → <b>Erweitert</b> bzw. <b>Entwickler</b> → <b>API-Schlüssel</b>.</li>
        <li><b>API-Key</b> und <b>API-Secret</b> kopieren (bei neuen Schlüsseln zeigt Smoobu das Secret nur einmal an).</li>
        <li>Hier einfügen und auf „Verbinden & testen“ klicken.</li></ol>
      <label class="f"><span>API-Key</span><input name="key" autocomplete="off" required></label>
      <label class="f"><span>API-Secret</span><input name="secret" type="password" autocomplete="new-password"></label>
      <p class="small muted">Der Zugang wird verschlüsselt übertragen und nur auf dem Server gespeichert – die App selbst und Team-Mitglieder können ihn nicht auslesen. Jeder Homevio-Nutzer verbindet sein eigenes Smoobu-Konto.</p>`,
    onSubmit: (form) => {
      const key = form.key.value.trim(), secret = form.secret.value.trim();
      (async () => {
        try {
          await Cloud.smoobuSet(key, secret);
          const t = await callFn("immo-smoobu", { owner: wsId(), action: "test" });
          ui.smoobu = await Cloud.smoobuStatus(wsId()).catch(() => null);
          state.settings.smoobuAuto = true; commit(`✓ Smoobu verbunden – ${t.count} Buchungen in den letzten/nächsten 30 Tagen gefunden`);
          await smoobuImport();
        } catch (e) { alert(`Smoobu-Verbindung fehlgeschlagen: ${e.message}`); ui.smoobu = await Cloud.smoobuStatus(wsId()).catch(() => null); render(); }
      })();
    },
  });
}

function smoobuBox() {
  if (!isCloud()) return "";
  if (ui.smoobu === undefined) { ui.smoobu = null; Cloud.smoobuStatus(wsId()).then((s) => { ui.smoobu = s || false; render(); }, () => { ui.smoobu = false; }); }
  const s = ui.smoobu;
  return s?.connected
    ? `<div class="kv"><span>🏖 <b>Smoobu verbunden</b> <span class="small muted">Schlüssel …${esc(s.hint || "")}</span></span><span class="toolbar">${btn("smoobu", "Jetzt abrufen", "sm primary")}${isOwnWs() ? btn("smoobuConnect", "ändern", "sm link") + btn("smoobuDisconnect", "trennen", "sm link") : ""}</span></div>`
    : `<div class="note"><b>Smoobu verbinden</b> – holt alle Buchungen aus Airbnb, Booking.com & Co. mit Gastname, Anschrift, Firma, E-Mail und Preis. Daraus erstellst du mit einem Klick die Rechnung. ${isOwnWs() ? btn("smoobuConnect", "🔗 Smoobu verbinden", "sm primary") : '<span class="small muted">(kann nur der Inhaber des Bestands)</span>'}</div>`;
}

// ---------------------------------------------------------------- Exporte

function datevExport(from, to) {
  const csv = C.datevCsv(state, from, to);
  download(`EXTF_Buchungsstapel_${from}_${to}.csv`, new Blob([C.toWin1252(csv)], { type: "text/csv;charset=windows-1252" }));
}

function journalCsv(from, to) {
  const acc = C.accountsFor(state.settings);
  const rows = C.datevRows(state, from, to);
  const lines = [["Datum", "Betrag", "Soll", "Haben", "Belegnr.", "Buchungstext"].join(";")];
  for (const r of rows) {
    const [soll, haben] = r.sh === "S" ? [r.konto, r.gegen] : [r.gegen, r.konto];
    lines.push([d(r.date), C.fmtNum(r.amount).replace(/\./g, ""), soll, haben, r.beleg, `"${r.text.replace(/"/g, '""')}"`].join(";"));
  }
  lines.push("", `Konten: Bank ${acc.bank}, Kasse ${acc.kasse} (SKR ${state.settings.skr})`);
  download(`Buchungsliste_${from}_${to}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
}

// ---------------------------------------------------------------- Ansichten


function head(title, sub, actions = "") {
  return `<div class="head"><div><h1>${esc(title)}</h1>${sub ? `<div class="muted">${sub}</div>` : ""}</div><div class="toolbar noprint">${actions}</div></div>`;
}
const btn = (act, label, cls = "", id = "") => `<button class="btn ${cls}" data-act="${act}" ${id !== "" ? `data-id="${esc(id)}"` : ""}>${label}</button>`;
const statusBadge = (diff, soll) => diff >= 0 ? (diff > 0 ? `<span class="badge">+${eur(diff)}</span>` : `<span class="badge ok">bezahlt</span>`) : (diff === -soll ? `<span class="badge bad">offen</span>` : `<span class="badge warn">teilweise</span>`);

function viewDashboard() {
  if (!state.objects.length) {
    return head(`Willkommen bei ${productName()}`) + `<div class="card empty"><div class="big">🏠</div>
      <p style="margin-bottom:14px">Verwalte Wohnungen, Häuser, Garagen, Stellplätze und Ferienwohnungen – mit Bankabgleich, Rechnungen und DATEV-Export.</p>
      <div class="toolbar" style="justify-content:center">${btn("newObject", "+ Erstes Objekt anlegen", "primary")}${btn("loadDemo", "Demo-Daten ansehen")}</div></div>`;
  }
  const key = C.monthKey(today());
  const rows = C.sollIst(state, key, key);
  const soll = sum(rows, (r) => r.soll), ist = sum(rows, (r) => r.ist);
  const back = C.sollIst(state, C.addMonths(key, -11), key).filter((r) => r.diff < 0);
  const backBy = {};
  for (const r of back) backBy[r.contractId] = (backBy[r.contractId] || 0) - r.diff;
  const rentable = state.units.filter((u) => u.type !== "ferienwohnung");
  const vacant = rentable.filter((u) => !activeContract(u.id, key));
  const openTx = state.transactions.filter((t) => !t.link).length;
  const fewo = fewoUnits();
  const days = C.daysInMonth(key);
  const nights = sum(state.bookings.filter((b) => b.status !== "storniert"), (b) => overlapNights(b, `${key}-01`, `${C.addMonths(key, 1)}-01`));
  const upcoming = state.bookings.filter((b) => b.status !== "storniert" && b.from >= today()).sort((a, b) => (a.from < b.from ? -1 : 1)).slice(0, 5);
  const openInv = state.invoices.filter((i) => ["offen", "teilbezahlt"].includes(i.status));
  const ending = state.contracts.filter((c) => c.end && c.end >= today() && c.end <= addDays(today(), 90));
  return head("Übersicht", C.fmtMonth(key)) + `
    <div class="kpis">
      <div class="kpi"><div class="l">Einheiten</div><div class="v">${state.units.length}</div><div class="s">${rentable.length - vacant.length} vermietet · ${vacant.length} frei · ${fewo.length} FeWo</div></div>
      <div class="kpi"><div class="l">Soll-Miete ${C.MONTHS_DE[Number(key.slice(5)) - 1]}</div><div class="v">${eur(soll)}</div><div class="s">${eur(ist)} eingegangen</div></div>
      <div class="kpi"><div class="l">Mietrückstände (12 Mon.)</div><div class="v ${back.length ? "neg" : ""}">${eur(sum(Object.values(backBy)))}</div><div class="s">${Object.keys(backBy).length} Verträge</div></div>
      <div class="kpi"><div class="l">Offene Bankumsätze</div><div class="v">${openTx}</div><div class="s"><a href="#/bank">zuordnen →</a></div></div>
      ${fewo.length ? `<div class="kpi"><div class="l">FeWo-Auslastung</div><div class="v">${Math.round((nights / (days * fewo.length)) * 100)} %</div><div class="s">${nights} von ${days * fewo.length} Nächten</div></div>` : ""}
    </div>
    <div class="grid g2">
      <div class="card"><h2>Mietrückstände</h2>${Object.keys(backBy).length ? `<table>${Object.entries(backBy).map(([cid, v]) => `<tr><td>${esc(contractLabel(byId("contracts", cid)))}</td><td class="num neg">${eur(v)}</td></tr>`).join("")}</table>` : '<p class="muted">Keine Rückstände 🎉</p>'}</div>
      <div class="card"><h2>Nächste Anreisen</h2>${upcoming.length ? `<table>${upcoming.map((b) => `<tr class="click" data-act="editBooking" data-id="${b.id}"><td class="nowrap">${d(b.from)}</td><td>${esc(b.guest)}<div class="small muted">${esc(byId("units", b.unitId)?.name)} · ${C.nightsBetween(b.from, b.to)} N · ${esc(b.channel)}</div></td></tr>`).join("")}</table>` : '<p class="muted">Keine anstehenden Buchungen.</p>'}</div>
      <div class="card"><h2>Offene Rechnungen</h2>${openInv.length ? `<table>${openInv.map((i) => `<tr class="click" data-go="#/rechnung/${i.id}"><td>${esc(i.number)}</td><td>${esc(C.recipientName(i.recipient))}</td><td class="num">${eur(C.invoiceTotals(i).gross - C.paidForInvoice(state, i.id))}</td></tr>`).join("")}</table>` : '<p class="muted">Alle Rechnungen bezahlt.</p>'}</div>
      ${(() => { const opp = R.increaseOpportunities(state, today()); return opp.length ? `<div class="card"><h2>💶 Mieterhöhung möglich</h2>${opp.map((o) => `<div class="small" style="margin-bottom:6px"><b>${esc(contractLabel(byId("contracts", o.contractId)))}</b><br>Kaltmiete ${eur(o.now)} → bis zu ${eur(o.maxByCap)} (Kappungsgrenze ${o.cap} %), wirksam frühestens ${C.fmtMonth(o.effective)}. Ortsübliche Vergleichsmiete beachten. ${btn("letterFor", "Erhöhungsverlangen", "sm link", `mieterhoehung|${o.contractId}`)}</div>`).join("")}</div>` : ""; })()}
      ${(() => { const tasks = openTasks(); return tasks.length ? `<div class="card"><h2>📌 Offene Vorgänge & Wiedervorlagen</h2>${tasks.slice(0, 8).map((n) => `<div class="small click" data-go="#/mieter/${n.tenantId}" data-folder-tab="vorgaenge" style="margin-bottom:4px">${NOTE_TYPES[n.type]?.split(" ")[0] || ""} <b>${esc(n.title)}</b> – ${esc(byId("tenants", n.tenantId)?.name || "")}${n.due ? ` <span class="${n.due < today() ? "neg" : "muted"}">fällig ${d(n.due)}</span>` : ""}</div>`).join("")}</div>` : ""; })()}
      ${(() => { const inc = state.contracts.filter((c) => c.start <= today() && (!c.end || c.end >= today())).filter((c) => folderChecklist(c).missing.length); return inc.length ? `<div class="card"><h2>📁 Unvollständige Mieterakten</h2>${inc.slice(0, 8).map((c) => `<div class="small click" data-go="#/mieter/${c.tenantIds[0]}" style="margin-bottom:4px"><b>${esc(tenantNames(c))}</b> – fehlt: ${folderChecklist(c).missing.map((m) => esc(m.label.split(" (")[0])).join(", ")}</div>`).join("")}</div>` : ""; })()}
      <div class="card"><h2>Leerstand & auslaufende Verträge</h2>
        ${vacant.length ? vacant.map((u) => `<div>${esc(unitLabel(u))} <span class="badge warn">frei</span></div>`).join("") : '<p class="muted">Kein Leerstand.</p>'}
        ${ending.map((c) => `<div>${esc(contractLabel(c))} <span class="badge">endet ${d(c.end)}</span></div>`).join("")}
      </div>
    </div>`;
}

const addDays = C.addDaysIso;
const overlapNights = C.overlapNights;

function viewObjects() {
  const key = C.monthKey(today());
  return head("Objekte & Einheiten", `${state.objects.length} Objekte · ${state.units.length} Einheiten`, btn("newObject", "+ Objekt", "primary") + btn("newUnit", "+ Einheit")) +
    (state.objects.length ? "" : `<div class="card empty"><div class="big">🏢</div>Noch keine Objekte. Lege dein erstes Haus oder deine erste Wohnung an.</div>`) +
    state.objects.map((o) => {
      const units = state.units.filter((u) => u.objectId === o.id);
      const monthly = sum(units, (u) => { const c = activeContract(u.id, key); return c ? C.rentForMonth(c, key).total : 0; });
      return `<div class="card">
        <div class="head" style="margin-bottom:10px"><div><h2 style="margin:0">${esc(o.name)} ${o.short ? `<span class="badge grey">${esc(o.short)}</span>` : ""}</h2>
          <div class="muted">${esc([o.street, [o.zip, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", "))} · ${esc(C.OBJECT_TYPES[o.type] || "")}${o.year ? ` · Baujahr ${o.year}` : ""}</div>
          <div class="small muted">Soll-Miete/Monat ${eur(monthly)} · Fläche ${sum(units, (u) => Number(u.area))} m² · AfA ${C.afaForYear(o, ui.year) ? eur(C.afaForYear(o, ui.year)) + " (" + ui.year + ")" : "–"}</div></div>
          <div class="toolbar"><a class="btn sm" href="#/ablage/${o.id}">📂 Ablage (${state.documents.filter((x) => x.objectId === o.id).length})</a>${btn("editObject", "Bearbeiten", "sm", o.id)}${btn("newUnit", "+ Einheit", "sm", o.id)}</div></div>
        ${units.length ? `<div class="table-wrap"><table><thead><tr><th>Einheit</th><th>Art</th><th>Lage</th><th class="num">m²</th><th class="num">Zi.</th><th>Mieter / Status</th><th class="num">Miete warm</th></tr></thead><tbody>
          ${units.map((u) => {
            const c = activeContract(u.id, key);
            const status = u.type === "ferienwohnung" ? `<span class="badge">Ferienvermietung</span>` : c ? esc(tenantNames(c)) : `<span class="badge warn">frei</span> ${btn("moveWizard", "+ Mieter eintragen", "sm primary", u.id)}`;
            return `<tr class="click" data-act="editUnit" data-id="${u.id}"><td><b>${esc(u.name)}</b>${u.features ? `<div class="small muted">${esc(u.features.slice(0, 80))}</div>` : ""}</td><td>${esc(C.UNIT_TYPES[u.type])}</td><td>${esc(u.floor || "")}</td><td class="num">${u.area || ""}</td><td class="num">${u.rooms || ""}</td><td>${status}</td><td class="num">${c ? eur(C.rentForMonth(c, key).total) : ""}</td></tr>`;
          }).join("")}</tbody></table></div>` : '<p class="muted">Noch keine Einheiten.</p>'}
        ${o.notes ? `<div class="note small">${esc(o.notes)}</div>` : ""}
      </div>`;
    }).join("");
}

function viewRents() {
  const key = ui.month;
  const rows = C.sollIst(state, key, key);
  const months = C.monthRange(`${ui.year}-01`, `${ui.year}-12`);
  const year = C.sollIst(state, months[0], months[11]);
  const cell = {};
  for (const r of year) cell[`${r.contractId}|${r.key}`] = r;
  const yContracts = state.contracts.filter((c) => months.some((m) => C.contractActiveIn(c, m)));
  return head("Mieteingänge", "Soll/Ist-Abgleich je Mietvertrag", `<input type="month" value="${key}" data-change="month" style="width:auto">` + btn("backfill", "⧉ Vergangene Monate nachtragen", "primary") + btn("newPayment", "+ Zahlung manuell")) + `
    ${ui.lastBatch ? `<div class="note">✓ ${ui.lastBatch.n} Zahlungen nachgetragen (${eur(ui.lastBatch.sum)}). ${btn("undoBackfill", "↶ Rückgängig machen", "sm")}</div>` : ""}
    <div class="kpis">
      <div class="kpi"><div class="l">Soll ${C.fmtMonth(key)}</div><div class="v">${eur(sum(rows, (r) => r.soll))}</div></div>
      <div class="kpi"><div class="l">Ist</div><div class="v">${eur(sum(rows, (r) => r.ist))}</div></div>
      <div class="kpi"><div class="l">Differenz</div><div class="v ${sum(rows, (r) => r.diff) < 0 ? "neg" : "pos"}">${eur(sum(rows, (r) => r.diff))}</div></div>
    </div>
    <div class="card"><h2>${C.fmtMonth(key)}</h2>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Einheit · Mieter</th><th class="num">Soll</th><th class="num">Ist</th><th class="num">Differenz</th><th>Status</th><th>Zahlungen</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const ps = state.payments.filter((p) => p.kind === "miete" && p.contractId === r.contractId && p.period === key);
        const rc = byId("contracts", r.contractId), noTenant = !(rc?.tenantIds || []).some((id) => byId("tenants", id));
        return `<tr><td><button class="btn link" style="padding:0;text-align:left" data-act="editContract" data-id="${esc(r.contractId)}" title="Vertrag ansehen, ändern oder löschen">${esc(contractLabel(rc))}</button>${noTenant ? ` <span class="badge warn">ohne Mieter</span> ${btn("deleteContract", "🗑 Löschen", "sm danger", r.contractId)}` : ""}</td><td class="num">${eur(r.soll)}</td><td class="num">${eur(r.ist)}</td><td class="num ${r.diff < 0 ? "neg" : ""}">${eur(r.diff)}</td><td>${statusBadge(r.diff, r.soll)}</td>
        <td class="small">${ps.map((p) => `${d(p.date)} ${eur(p.amount)} ${p.txId ? `🏦 <button class="btn sm link" data-act="unlinkPayment" data-id="${p.id}" title="Zuordnung zur Bank-Buchung lösen">✕</button>` : `💶 <button class="btn sm link" data-act="editPayment" data-id="${p.id}" title="Zahlung bearbeiten oder löschen">✎</button>`}`).join("<br>")}</td>
        <td class="right nowrap">${btn("editContract", "✎ Bearbeiten", "sm", r.contractId)}</td></tr>`; }).join("")}
      </tbody></table></div>` : '<p class="muted">Keine aktiven Mietverträge in diesem Monat.</p>'}</div>
    <div class="card"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">Jahresübersicht ${ui.year}</h2><div class="toolbar noprint">${btn("year", "‹", "sm", ui.year - 1)}${btn("year", "›", "sm", ui.year + 1)}</div></div>
      <div class="table-wrap"><table class="matrix"><thead><tr><th>Vertrag</th>${months.map((m) => `<th class="m">${C.MONTHS_DE[Number(m.slice(5)) - 1].slice(0, 3)}</th>`).join("")}<th class="num">Saldo</th></tr></thead><tbody>
      ${yContracts.map((c) => `<tr><td class="small">${esc(contractLabel(c))}</td>${months.map((m) => { const r = cell[`${c.id}|${m}`]; if (!r) return '<td class="m"></td>';
        const cls = r.diff === 0 ? "ok" : r.diff > 0 ? "over" : r.ist === 0 ? (m > C.monthKey(today()) ? "" : "no") : "part";
        return `<td class="m"><span class="dot ${cls}" title="Soll ${eur(r.soll)} · Ist ${eur(r.ist)}">${cls === "ok" ? "✓" : cls === "no" ? "✗" : cls === "part" ? "½" : cls === "over" ? "+" : "·"}</span></td>`; }).join("")}
        <td class="num ${sum(year.filter((r) => r.contractId === c.id && r.key <= C.monthKey(today())), (r) => r.diff) < 0 ? "neg" : ""}">${eur(sum(year.filter((r) => r.contractId === c.id && r.key <= C.monthKey(today())), (r) => r.diff))}</td></tr>`).join("")}
      </tbody></table></div><p class="small muted" style="margin-top:6px">✓ bezahlt · ½ teilweise · ✗ offen · + Überzahlung · Saldo bis heute</p></div>`;
}

// Mehrere vergangene Monate auf einmal als bezahlt eintragen (nur der noch fehlende Betrag je Monat)
function backfillDialog() {
  const now = C.monthKey(today());
  const to0 = C.addMonths(now, -1), from0 = C.addMonths(now, -3);
  const cs = state.contracts.filter((c) => (c.tenantIds || []).length);
  if (!cs.length) return toast("Noch keine Mietverträge.");
  const body = `<p class="muted" style="margin-bottom:10px">Die App trägt für jeden gewählten Monat die vereinbarte Miete als erhalten ein – nur dort, wo noch etwas fehlt. Bereits erfasste Zahlungen bleiben unverändert.</p>
    <div class="fgrid">
      <label class="f"><span>Von Monat</span><input type="month" name="from" value="${from0}"></label>
      <label class="f"><span>Bis Monat</span><input type="month" name="to" value="${to0}"></label>
      <label class="f"><span>Zahlungseingang jeweils am</span><select name="day">${opt([1, 3, 5, 10, 15, 28].map((x) => [x, `${x}. des Monats`]), 3)}</select></label>
      <div class="f"><span class="small muted">Schnellwahl</span><div class="toolbar">
        <button type="button" class="btn sm" data-bf="1">letzter Monat</button><button type="button" class="btn sm" data-bf="2">2 Monate</button><button type="button" class="btn sm" data-bf="3">3 Monate</button><button type="button" class="btn sm" data-bf="year">ganzes Jahr</button></div></div>
    </div>
    <div class="head" style="margin:8px 0 4px"><b>Für welche Mieter?</b><span class="small"><a href="#" data-bfall="1">alle</a> · <a href="#" data-bfall="0">keine</a></span></div>
    <div class="checks" style="flex-direction:column;align-items:flex-start">${cs.map((c) => `<label><input type="checkbox" name="cid" value="${esc(c.id)}" ${C.contractActiveIn(c, to0) || C.contractActiveIn(c, from0) ? "checked" : ""}> ${esc(contractLabel(c))} <span class="muted small">${eur(C.rentForMonth(c, to0).total)}/Monat</span></label>`).join("")}</div>
    <div id="bfPreview" class="note" style="margin-top:12px"></div>`;
  dialog({
    title: "Vergangene Monate nachtragen", wide: true, submit: "Nachtragen", body,
    onOpen: (form) => {
      const calc = () => C.backfillPayments(state, { from: form.from.value, to: form.to.value, contractIds: [...form.querySelectorAll("input[name=cid]:checked")].map((x) => x.value), day: form.day.value });
      const show = () => { const ps = calc(); $("#bfPreview", form).innerHTML = ps.length ? `Es werden <b>${ps.length} Zahlungen</b> über zusammen <b>${eur(sum(ps, (p) => p.amount))}</b> eingetragen (${C.fmtMonth(form.from.value)} bis ${C.fmtMonth(form.to.value)}).` : "Für diese Auswahl fehlt nichts – alles ist schon erfasst."; };
      form.addEventListener("input", show); form.addEventListener("change", show);
      form.addEventListener("click", (e) => {
        const q = e.target.dataset.bf, all = e.target.dataset.bfall;
        if (q) { form.to.value = to0; form.from.value = q === "year" ? `${now.slice(0, 4)}-01` : C.addMonths(now, -Number(q)); if (form.from.value > form.to.value) form.from.value = form.to.value; show(); }
        if (all != null) { e.preventDefault(); form.querySelectorAll("input[name=cid]").forEach((x) => (x.checked = all === "1")); show(); }
      });
      show();
    },
    onSubmit: (form) => {
      const batch = C.uid("b_");
      const ps = C.backfillPayments(state, { from: form.from.value, to: form.to.value, contractIds: [...form.querySelectorAll("input[name=cid]:checked")].map((x) => x.value), day: form.day.value, batch });
      if (!ps.length) { toast("Für diese Auswahl fehlt nichts."); return false; }
      state.payments.push(...ps);
      // Abgleich so weit zurück anzeigen, wie jetzt Zahlungen erfasst sind
      if (state.settings.sollStart && form.from.value < state.settings.sollStart) state.settings.sollStart = form.from.value;
      ui.lastBatch = { id: batch, n: ps.length, sum: sum(ps, (p) => p.amount) };
      if (ui.month > form.to.value || ui.month < form.from.value) ui.month = form.to.value;
      commit(`${ps.length} Zahlungen nachgetragen`);
    },
  });
}

function editPayment(id) {
  const p = byId("payments", id) || { id: C.uid("p_"), date: today(), kind: "miete", period: ui.month, txId: null };
  formDialog({
    title: id ? "Zahlung bearbeiten" : "Zahlung manuell erfassen (bar / ohne Kontoimport)", spec: SPEC.payment, data: p,
    onSave: (v) => {
      if (v.kind === "miete" && (!v.contractId || !v.period)) { toast("Bitte Vertrag und Monat angeben."); return false; }
      upsert("payments", { ...p, ...v }); commit("Zahlung gespeichert");
    },
    onDelete: id && (() => { state.payments = state.payments.filter((x) => x.id !== id); commit("Zahlung gelöscht"); }),
  });
}

function viewBank() {
  const f = ui.bankFilter, q = C.normalize(ui.bankSearch);
  let txs = [...state.transactions].sort((a, b) => (a.date < b.date ? 1 : -1));
  if (f === "offen") txs = txs.filter((t) => !t.link);
  if (f === "zugeordnet") txs = txs.filter((t) => t.link);
  if (q) txs = txs.filter((t) => C.normalize(`${t.name} ${t.purpose} ${t.iban} ${C.fmtNum(Math.abs(t.amount))}`).includes(q));
  const shown = txs.slice(0, 300);
  const sugs = Object.fromEntries(shown.filter((t) => !t.link).map((t) => [t.id, C.suggestAssignment(t, state)]));
  const good = Object.values(sugs).filter((s) => s && s.score >= 60).length;
  const accOpts = state.accounts.map((a) => [a.id, `${a.name}${a.iban ? " · " + a.iban.slice(-4) : ""}`]);
  return head("Bank", "Live mit der Bank verbunden oder per Kontoauszug-Import – Mieten & Kosten werden automatisch zugeordnet", btn("newAccount", "+ Bankkonto")) + bankLiveCard() + `
    <div class="card noprint"><h2>Kontoauszug importieren</h2>
      ${state.accounts.length ? `<div class="inline"><select id="impAcc">${opt(accOpts, state.accounts[0].id)}</select>
        <label class="btn primary">Datei wählen (CSV / CAMT.053 XML)<input type="file" accept=".csv,.txt,.xml,.camt" data-change="importFile" hidden></label></div>
        <p class="small muted" style="margin-top:8px">Funktioniert mit allen deutschen Banken: Im Online-Banking „Umsätze exportieren“ als CSV oder CAMT.053 wählen. Doppelte Umsätze werden erkannt. Bekannte Mieter-IBANs, Beträge, Namen und gelernte Regeln werden automatisch zugeordnet.</p>`
        : `<p class="muted">Lege zuerst dein Mietkonto an.</p>${btn("newAccount", "+ Bankkonto anlegen", "primary")}`}
      ${state.accounts.length ? `<div class="small" style="margin-top:8px">${state.accounts.map((a) => `<span class="badge grey" style="margin-right:6px">${esc(a.name)} ${esc(a.iban || "")} · ${state.transactions.filter((t) => t.accountId === a.id).length} Umsätze</span> <button class="btn sm link" data-act="editAccount" data-id="${a.id}">✎</button>`).join(" ")}</div>` : ""}
    </div>
    <div class="card">
      <div class="tabs">${[["offen", `Offen (${state.transactions.filter((t) => !t.link).length})`], ["zugeordnet", "Zugeordnet"], ["alle", "Alle"]].map(([k, l]) => `<button data-act="bankFilter" data-id="${k}" class="${f === k ? "active" : ""}">${l}</button>`).join("")}</div>
      <div class="inline" style="margin-bottom:10px"><input placeholder="Suchen (Name, Zweck, Betrag)…" value="${esc(ui.bankSearch)}" data-change="bankSearch" style="max-width:320px">
        ${good && f !== "zugeordnet" ? btn("acceptAll", `✓ ${good} Vorschläge übernehmen`, "primary") : ""}</div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Auftraggeber / Verwendungszweck</th><th class="num">Betrag</th><th>Zuordnung</th></tr></thead><tbody>
        ${shown.map((t) => { const s = sugs[t.id];
          return `<tr><td class="nowrap">${d(t.date)}</td><td><b>${esc(t.name)}</b><div class="small muted">${esc(t.purpose)}</div></td><td class="num ${t.amount < 0 ? "neg" : "pos"}">${eur(t.amount)}</td>
          <td>${t.link ? `${linkLabel(t)} <button class="btn sm link" data-act="unlink" data-id="${t.id}" title="Zuordnung lösen">✕</button>`
            : `${s ? `<span class="suggest ${s.score >= 60 ? "hi" : ""}" title="${esc(s.why.join(", "))} · Sicherheit ${s.score} %">${esc(suggestionLabel(s))} <button class="btn sm" data-act="accept" data-id="${t.id}">✓</button></span> ` : ""}${btn("assign", "Zuordnen…", "sm", t.id)}`}</td></tr>`; }).join("")}
      </tbody></table></div>${txs.length > shown.length ? `<p class="small muted">${txs.length - shown.length} weitere – Suche verwenden.</p>` : ""}` : `<p class="muted">${f === "offen" && state.transactions.length ? "Alle Umsätze sind zugeordnet 🎉" : "Keine Umsätze."}</p>`}
    </div>`;
}

function viewExpenses() {
  const list = state.expenses.filter((e) => e.date.startsWith(String(ui.year)) && (!ui.expObj || e.objectId === ui.expObj)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const byCat = {};
  for (const e of list) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  return head("Ausgaben & Belege", `${ui.year} · ${list.length} Belege · ${eur(sum(list, (e) => e.amount))}`,
    `<select data-change="expObj" style="width:auto">${opt([["", "Alle Objekte"], ...state.objects.map((o) => [o.id, o.name])], ui.expObj)}</select>` + btn("year", "‹", "", ui.year - 1) + btn("year", "›", "", ui.year + 1) + btn("newExpense", "+ Ausgabe", "primary")) + `
    <div class="grid g21">
      <div class="card">${list.length ? `<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Empfänger</th><th>Kategorie</th><th>Objekt</th><th class="num">Betrag</th></tr></thead><tbody>
        ${list.map((e) => `<tr class="click" data-act="editExpense" data-id="${e.id}"><td class="nowrap">${d(e.date)}</td><td>${esc(e.vendor)}<div class="small muted">${esc((e.note || "").slice(0, 70))}</div></td><td class="small">${esc(C.EXPENSE_CATEGORIES[e.category]?.label)}</td><td class="small">${esc(byId("objects", e.objectId)?.name || "–")}</td><td class="num">${eur(e.amount)} ${e.txId ? "🏦" : ""}${(e.fileIds || []).length ? " 📎" : ' <span class="muted" title="kein Beleg">○</span>'}</td></tr>`).join("")}
      </tbody></table></div>` : '<p class="muted">Keine Ausgaben in diesem Jahr. Ausgaben entstehen automatisch beim Zuordnen von Bankumsätzen oder manuell (bar/Karte).</p>'}</div>
      <div class="card"><h2>Nach Kategorie</h2><table>${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td class="small">${esc(C.EXPENSE_CATEGORIES[k]?.label)}</td><td class="num">${eur(v)}</td></tr>`).join("")}</table></div>
    </div>`;
}

function editExpense(id) {
  const e = byId("expenses", id) || { id: C.uid("e_"), date: today(), category: "erhaltung", txId: null };
  formDialog({
    title: id ? "Ausgabe bearbeiten" : "Neue Ausgabe (bar / Karte / ohne Kontoimport)", spec: SPEC.expense, data: e,
    intro: (e.txId ? `<div class="note small">Aus Bankumsatz übernommen – Datum und Betrag kommen vom Konto.</div>` : "") +
      `<div class="inline" style="margin-bottom:10px">${(e.fileIds || []).map((fid) => { const doc = byId("documents", fid); return doc ? `<span class="att" data-act="openDoc" data-id="${fid}">${doc.thumb ? `<img src="${doc.thumb}">` : "📄"} ${esc(doc.name.slice(0, 24))}</span>` : ""; }).join("")}
      <label class="btn sm">📎 Beleg anhängen<input type="file" accept="image/*,application/pdf" capture="environment" data-change="attachExpense" data-id="${e.id}" hidden></label></div>`,
    onSave: (v) => { upsert("expenses", { ...e, ...(byId("expenses", e.id) || {}), ...v, amount: Math.abs(v.amount) }); commit("Ausgabe gespeichert"); },
    onDelete: id && (() => {
      const tx = state.transactions.find((t) => t.link?.type === "expense" && t.link.id === id);
      if (tx) tx.link = null;
      state.expenses = state.expenses.filter((x) => x.id !== id); commit("Ausgabe gelöscht");
    }),
  });
}

function viewFewo() {
  const units = fewoUnits();
  if (!units.length) return head("Ferienwohnung") + `<div class="card empty"><div class="big">☀️</div><p>Lege unter „Objekte & Einheiten“ eine Einheit vom Typ <b>Ferienwohnung</b> an, um Buchungen, Belegungskalender und Gäste-Rechnungen zu nutzen.${isCloud() ? " Oder verbinde Smoobu – die Ferienwohnungen werden dann übernommen." : ""}</p><br>${btn("newUnit", "+ Einheit anlegen", "primary")}</div>${isCloud() ? `<div class="card">${smoobuBox()}</div>` : ""}`;
  const key = ui.month, days = C.daysInMonth(key);
  const from = `${key}-01`, to = `${C.addMonths(key, 1)}-01`;
  const ids = units.map((u) => u.id);
  const k = C.fewoStats(state, ids, from, to);
  const kPrev = C.fewoStats(state, ids, `${C.addMonths(key, -12)}-01`, `${C.addMonths(key, -11)}-01`);
  const y = key.slice(0, 4);
  const kYear = C.fewoStats(state, ids, `${y}-01-01`, `${Number(y) + 1}-01-01`);
  const pct = (v) => `${Math.round(v * 100)} %`;
  const vs = (a, b, f) => (b ? `<span class="${a >= b ? "pos" : "neg"}">Vorjahr ${f(b)}</span>` : "Vorjahr –");
  const active = state.bookings.filter((b) => !["storniert"].includes(b.status));
  const monthB = state.bookings.filter((b) => b.from < to && b.to > from).sort((a, b) => (a.from < b.from ? -1 : 1));
  // Netto-Ertrag im Jahr: Logis-Umsatz minus FeWo-Kosten der betroffenen Objekte
  const objIds = new Set(units.map((u) => u.objectId));
  const fewoCosts = sum(state.expenses.filter((e) => e.date.startsWith(y) && objIds.has(e.objectId) && C.EXPENSE_CATEGORIES[e.category]?.av), (e) => e.amount);
  // Reinigungsplan: Abreisen der nächsten 14 Tage
  const horizon = addDays(today(), 14);
  const departures = active.filter((b) => b.status !== "eigennutzung" && b.to >= today() && b.to <= horizon).sort((a, b) => (a.to < b.to ? -1 : 1));
  const cal = `<table class="cal"><tr><th></th>${Array.from({ length: days }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr>
    ${units.map((u) => `<tr><td class="u">${esc(u.name)}</td>${Array.from({ length: days }, (_, i) => {
      const day = `${key}-${String(i + 1).padStart(2, "0")}`;
      const b = active.find((x) => x.unitId === u.id && x.from <= day && x.to > day);
      const wd = new Date(day).getDay();
      return `<td class="d ${wd === 0 || wd === 6 ? "we" : ""} ${b ? "b" : ""} ${b?.status === "angefragt" ? "req" : ""} ${b?.status === "eigennutzung" ? "own" : ""} ${day === today() ? "today" : ""}" ${b ? `data-act="editBooking" data-id="${b.id}" title="${esc(b.guest)} · ${d(b.from)}–${d(b.to)}"` : `data-act="newBookingAt" data-id="${u.id}|${day}" title="Neue Buchung ab ${d(day)}"`}>${b && b.from === day ? esc((b.guest || "").slice(0, 2)) : ""}</td>`;
    }).join("")}</tr>`).join("")}</table>`;
  const statusB = (b) => ({ storniert: '<span class="badge bad">storniert</span>', angefragt: '<span class="badge warn">angefragt</span>', eigennutzung: '<span class="badge grey">Eigennutzung</span>' }[b.status] || '<span class="badge ok">bestätigt</span>');
  return head("Ferienwohnung", "Belegung, Kennzahlen, Buchungen & Gäste-Rechnungen", `<input type="month" value="${key}" data-change="month" style="width:auto">` + btn("syncNow", "🔄 Synchronisieren") + btn("newBooking", "+ Buchung", "primary")) + `
    <div class="kpis">
      <div class="kpi"><div class="l">Auslastung ${C.MONTHS_DE[Number(key.slice(5)) - 1]}</div><div class="v">${pct(k.occupancy)}</div><div class="s">${k.nights} / ${k.available} Nächte · ${vs(k.occupancy, kPrev.occupancy, pct)}</div></div>
      <div class="kpi"><div class="l">ADR (Ø Preis / Nacht)</div><div class="v">${k.adr ? eur(k.adr) : "–"}</div><div class="s">${vs(k.adr, kPrev.adr, eur)}</div></div>
      <div class="kpi"><div class="l">RevPAR</div><div class="v">${eur(k.revpar)}</div><div class="s">${vs(k.revpar, kPrev.revpar, eur)}</div></div>
      <div class="kpi"><div class="l">Logis-Umsatz</div><div class="v">${eur(k.lodging)}</div><div class="s">${vs(k.lodging, kPrev.lodging, eur)}</div></div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="l">Jahr ${y}: Logis-Umsatz</div><div class="v">${eur(kYear.lodging)}</div><div class="s">${kYear.bookings} Buchungen · Ø ${kYear.avgStay.toFixed(1).replace(".", ",")} Nächte</div></div>
      <div class="kpi"><div class="l">Kosten ${y} (Objekt)</div><div class="v">${eur(fewoCosts)}</div><div class="s">Netto-Ertrag ≈ ${eur(kYear.lodging - fewoCosts)}</div></div>
      <div class="kpi"><div class="l">Stornoquote ${y}</div><div class="v">${pct(kYear.cancelRate)}</div></div>
      <div class="kpi"><div class="l">Direktbuchungen ${y}</div><div class="v">${pct(kYear.directShare)}</div><div class="s">ohne Portal-Provision</div></div>
    </div>
    ${channelsCard()}
    <div class="card"><h2>Belegungskalender ${C.fmtMonth(key)}</h2><div class="table-wrap">${cal}</div><p class="small muted" style="margin-top:6px">Freien Tag anklicken = neue Buchung. Gold = angefragt, grau = Eigennutzung/gesperrt.</p></div>
    <div class="card"><h2>Reinigungsplan (nächste 14 Tage)</h2>${departures.length ? `<div class="table-wrap"><table><thead><tr><th>Abreise</th><th>Wohnung</th><th>Gast</th><th>Nächste Anreise</th><th></th></tr></thead><tbody>
      ${departures.map((b) => { const next = active.filter((x) => x.unitId === b.unitId && x.from >= b.to && x.id !== b.id).sort((a, c) => (a.from < c.from ? -1 : 1))[0];
        const same = next && next.from === b.to;
        return `<tr><td class="nowrap">${d(b.to)}</td><td>${esc(byId("units", b.unitId)?.name)}</td><td>${esc(b.guest)}</td><td>${next ? `${d(next.from)} · ${esc(next.guest)} (${Number(next.adults || 0) + Number(next.children || 0)} Pers.) ${same ? '<span class="badge warn">Wechsel am selben Tag</span>' : ""}` : '<span class="muted">keine</span>'}</td>
        <td>${btn("cleaningMsg", "📋 Auftrag kopieren", "sm", b.id)}</td></tr>`; }).join("")}</tbody></table></div>` : '<p class="muted">Keine Abreisen in den nächsten 14 Tagen.</p>'}</div>
    <div class="card"><h2>Buchungen im ${C.fmtMonth(key)}</h2>${monthB.length ? `<div class="table-wrap"><table><thead><tr><th>Zeitraum</th><th>Gast</th><th>Wohnung</th><th>Kanal</th><th class="num">Preis</th><th>Status</th><th>Rechnung</th><th></th></tr></thead><tbody>
      ${monthB.map((b) => { const inv = byId("invoices", b.invoiceId);
        const foreign = b.nationality && !/^(de|deu|deutsch|deutschland|german)/i.test(b.nationality.trim());
        return `<tr><td class="nowrap">${d(b.from)} – ${d(b.to)}<div class="small muted">${C.nightsBetween(b.from, b.to)} Nächte · ${Number(b.adults || 0) + Number(b.children || 0)} Pers.</div></td><td class="click" data-act="editBooking" data-id="${b.id}"><b>${esc(b.guest)}</b>${foreign ? ' <span class="badge warn" title="Ausländische Gäste: Meldeschein ausfüllen, 12 Monate aufbewahren">Meldeschein</span>' : ""}</td><td class="small">${esc(byId("units", b.unitId)?.name)}</td><td class="small">${esc(b.channel)}</td>
        <td class="num">${eur((b.total || 0) + (b.cleaning || 0))}</td><td>${statusB(b)}</td>
        <td>${inv ? `<a href="#/rechnung/${inv.id}">${esc(inv.number)}</a> ${invBadge(inv)}` : !["storniert", "eigennutzung"].includes(b.status) ? btn("invoiceFromBooking", "Rechnung erstellen", "sm", b.id) : ""}</td>
        <td>${b.status !== "eigennutzung" ? btn("guestMsg", "✉", "sm", b.id) : ""}</td></tr>`; }).join("")}</tbody></table></div>` : '<p class="muted">Keine Buchungen in diesem Monat.</p>'}</div>
    <p class="small muted">Pflichten prüfen: Meldeschein nur noch für ausländische Gäste (seit 1.1.2025), Registrierungsnummer falls die Kommune sie verlangt, Kurbeitrag/Beherbergungssteuer je Gemeinde, Rauchwarnmelder. Kein Rechts- oder Steuerrat.</p>`;
}

const GUEST_TEMPLATES = {
  bestaetigung: ["Buchungsbestätigung", (b, u, s) => `Hallo ${b.guest},

vielen Dank für Ihre Buchung! Hiermit bestätigen wir Ihren Aufenthalt in „${u?.name || "unserer Ferienwohnung"}“:

Anreise: ${d(b.from)} (ab 15:00 Uhr)
Abreise: ${d(b.to)} (bis 10:00 Uhr)
Personen: ${Number(b.adults || 0) + Number(b.children || 0)}
Gesamtpreis: ${eur((b.total || 0) + (b.cleaning || 0))} zzgl. Kurtaxe laut Satzung

Ein paar Tage vor der Anreise schicken wir Ihnen alle Infos zu Anfahrt, Parken und Schlüsselübergabe.

Herzliche Grüße
${s.ownerName}`],
  anreise: ["3 Tage vor Anreise", (b, u, s) => `Hallo ${b.guest},

in wenigen Tagen ist es so weit – wir freuen uns auf Sie!

Adresse: ${addrOf(u)}
Check-in: ${d(b.from)} ab 15:00 Uhr
Parken: [Parkmöglichkeit eintragen]
Schlüssel: [Schlüsselbox-Code / Übergabe eintragen]
WLAN: [Netzwerk / Passwort]

Bei Fragen erreichen Sie uns unter ${s.ownerPhone || "[Telefon]"}.

Gute Anreise!
${s.ownerName}`],
  waehrend: ["Während des Aufenthalts", (b, u, s) => `Hallo ${b.guest},

wir hoffen, Sie haben sich gut eingelebt! Ist alles in Ordnung oder fehlt Ihnen etwas? Melden Sie sich gern jederzeit.

Viele Grüße
${s.ownerName}`],
  abreise: ["Abreise & Bewertung", (b, u, s) => `Hallo ${b.guest},

vielen Dank, dass Sie bei uns zu Gast waren! Zur Abreise am ${d(b.to)} bitte bis 10:00 Uhr: Geschirr in die Spülmaschine, Müll in die Tonnen, Fenster schließen und Schlüssel [Rückgabe eintragen].

Wenn es Ihnen gefallen hat, freuen wir uns sehr über eine kurze Bewertung${b.channel && b.channel !== "Direkt" ? ` auf ${b.channel}` : ""}. Beim nächsten Mal können Sie auch gern direkt bei uns buchen.

Herzliche Grüße
${s.ownerName}`],
};

function addrOf(u) {
  const o = byId("objects", u?.objectId);
  return o ? [o.street, [o.zip, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
}

function guestMsg(id) {
  const b = byId("bookings", id), u = byId("units", b.unitId);
  const first = Object.keys(GUEST_TEMPLATES)[0];
  dialog({
    title: `Nachricht an ${b.guest}`, wide: true, submit: "Kopieren",
    body: `<label class="f"><span>Vorlage</span><select name="tpl">${opt(Object.entries(GUEST_TEMPLATES).map(([k, v]) => [k, v[0]]), first)}</select></label>
      <label class="f"><span>Text (anpassbar)</span><textarea name="text" style="min-height:280px">${esc(GUEST_TEMPLATES[first][1](b, u, state.settings))}</textarea></label>
      ${b.email ? `<a class="btn" id="mailto">✉ In E-Mail-Programm öffnen</a>` : '<p class="small muted">Keine E-Mail hinterlegt – Text kopieren und z. B. in Airbnb/Booking-Postfach einfügen.</p>'}
      <p class="small muted">Antwort auf Anfragen möglichst innerhalb einer Stunde. Werbung an frühere Gäste nur mit Einwilligung (§ 7 UWG).</p>`,
    onOpen: (form) => {
      const upd = () => {
        const [subject] = GUEST_TEMPLATES[form.tpl.value];
        const m = form.querySelector("#mailto");
        if (m) m.href = `mailto:${encodeURIComponent(b.email)}?subject=${encodeURIComponent(subject + " – " + (u?.name || ""))}&body=${encodeURIComponent(form.text.value)}`;
      };
      form.tpl.addEventListener("change", () => { form.text.value = GUEST_TEMPLATES[form.tpl.value][1](b, u, state.settings); upd(); });
      form.text.addEventListener("input", upd); upd();
    },
    onSubmit: (form) => { copyText(form.text.value); return false; },
  });
}

function cleaningMsg(id) {
  const b = byId("bookings", id), u = byId("units", b.unitId);
  const next = state.bookings.filter((x) => x.unitId === b.unitId && x.from >= b.to && x.id !== b.id && x.status !== "storniert").sort((a, c) => (a.from < c.from ? -1 : 1))[0];
  copyText(`Reinigungsauftrag ${u?.name || ""}
Adresse: ${addrOf(u)}
Abreise Gast: ${d(b.to)} bis 10:00 Uhr (${b.guest})
${next ? `Nächste Anreise: ${d(next.from)} ab 15:00 Uhr – ${Number(next.adults || 0) + Number(next.children || 0)} Personen${next.from === b.to ? " (WECHSEL AM SELBEN TAG!)" : ""}` : "Keine Folgebuchung."}
Bitte Schäden mit Foto melden.`);
}

function copyText(t) {
  (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast("In die Zwischenablage kopiert"), () => { prompt("Text kopieren:", t); });
}

const invBadge = (i) => ({ entwurf: '<span class="badge grey">Entwurf</span>', offen: '<span class="badge warn">offen</span>', teilbezahlt: '<span class="badge warn">teilbezahlt</span>', bezahlt: '<span class="badge ok">bezahlt</span>', storniert: '<span class="badge grey">storniert</span>', storno: '<span class="badge grey">Storno</span>' }[i.status] || "");

function viewInvoices() {
  const list = [...state.invoices].sort((a, b) => (a.number < b.number ? 1 : -1));
  const missing = bookingsWithoutInvoice();
  const openBk = missing.filter((b) => b.from <= today());
  return head("Rechnungen", "Gäste-Rechnungen mit fortlaufender Nummer, 7 % USt und Kurtaxe – auch für Booking.com, Airbnb & Co. (über Smoobu)", btn("newInvoice", "+ Rechnung", "primary")) + `
    <div class="card"><h2>🧾 Buchungen ohne Rechnung ${missing.length ? `<span class="badge warn">${missing.length}</span>` : ""}</h2>
      ${missing.length ? `<div class="table-wrap"><table><thead><tr><th>Gast</th><th>Kanal</th><th>Zeitraum</th><th class="num">Betrag</th><th></th></tr></thead><tbody>
        ${missing.slice(0, 30).map((b) => `<tr><td><b>${esc(b.guest || "Gast")}</b>${b.guestCompany ? `<div class="small muted">${esc(b.guestCompany)}</div>` : ""}${!b.guestStreet ? '<div class="small muted">Anschrift fehlt noch</div>' : ""}</td><td>${esc(b.channel || "Direkt")}${b.channelRef ? `<div class="small muted">Nr. ${esc(b.channelRef)}</div>` : ""}</td><td class="small nowrap">${d(b.from)} – ${d(b.to)}</td><td class="num">${eur(b.total || 0)}</td><td>${btn("invoiceFromBooking", "Rechnung erstellen", "sm primary", b.id)}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="toolbar" style="margin-top:8px">${openBk.length ? btn("draftsForAll", `Für alle ${openBk.length} begonnenen Aufenthalte Entwürfe anlegen`, "") : ""}</div>` : '<p class="small muted">Alle Buchungen haben eine Rechnung. 👍</p>'}
      <label class="f inline small" style="margin-top:8px"><input type="checkbox" data-change="autoInvoiceDrafts" ${state.settings.autoInvoiceDrafts ? "checked" : ""}> Für neue Smoobu-Buchungen (Booking.com, Airbnb …) automatisch einen Rechnungsentwurf anlegen</label>
      <p class="small muted">Gast, Anschrift, E-Mail, Kanal und Buchungsnummer kommen aus Smoobu. Soll die Rechnung an eine <b>Firma</b> gehen, im Entwurf auf „👤 Empfänger / Firma“ tippen – auch nach dem Festschreiben änderbar (dann automatisch per Storno + neuer Rechnung).</p></div>` + `
    <div class="card">${list.length ? `<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Datum</th><th>Empfänger</th><th>Zeitraum</th><th class="num">Betrag</th><th class="num">Bezahlt</th><th>Status</th></tr></thead><tbody>
      ${list.map((i) => `<tr class="click" data-go="#/rechnung/${i.id}"><td><b>${esc(i.number)}</b></td><td>${d(i.date)}</td><td>${esc(C.recipientName(i.recipient))}${i.recipient?.company && i.recipient?.name ? `<div class="small muted">${esc(i.recipient.name)}</div>` : ""}</td><td class="small nowrap">${i.serviceFrom ? `${d(i.serviceFrom)} – ${d(i.serviceTo)}` : ""}</td><td class="num">${eur(C.invoiceTotals(i).gross)}</td><td class="num">${eur(C.paidForInvoice(state, i.id))}</td><td>${invBadge(i)}${(i.sentLog || []).length ? ' <span title="versendet">📧</span>' : ""}${i.pdfDocId ? ' <span title="PDF abgelegt">📁</span>' : ""}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="muted">Noch keine Rechnungen. Am schnellsten: unter „Ferienwohnung“ bei einer Buchung „Rechnung erstellen“.</p>'}</div>`;
}

const PAID_VIA = (channel) => [["", "Per Überweisung (mit Zahlungsziel)"], ["portal", `Bereits bezahlt über ${channel && channel !== "Direkt" ? channel : "das Buchungsportal"}`], ["bar", "Bereits bar / vor Ort bezahlt"], ["ueberweisung", "Bereits per Überweisung bezahlt"]];

function paymentText(inv) {
  if (inv.type === "storno") return "";
  const s = state.settings, b = byId("bookings", inv.bookingId);
  if (inv.paidVia === "portal") return `Der Betrag wurde bereits über ${b?.channel && b.channel !== "Direkt" ? b.channel : "das Buchungsportal"} bezahlt.`;
  if (inv.paidVia === "bar") return "Der Betrag wurde bereits bar bezahlt.";
  if (inv.paidVia === "ueberweisung" || inv.status === "bezahlt") return "Der Betrag wurde bereits beglichen.";
  return `Bitte überweisen Sie den Betrag bis zum ${d(addDays(inv.date, Number(s.paymentTermDays) || 14))} unter Angabe der Rechnungsnummer${s.invoiceIban ? " auf das unten genannte Konto" : ""}.`;
}

// Inhalt einer Rechnung – gemeinsame Grundlage für Bildschirm, Druck und PDF
function invoiceModel(inv) {
  const s = state.settings, t = C.invoiceTotals(inv);
  const unit = byId("units", inv.unitId), obj = byId("objects", unit?.objectId);
  const sender = [s.ownerName, s.ownerStreet, [s.ownerZip, s.ownerCity].filter(Boolean).join(" ")].filter(Boolean);
  const draft = inv.status === "entwurf", ku = !!inv.kleinunternehmer;
  const paid = inv.type !== "storno" && !inv.paidVia ? C.paidForInvoice(state, inv.id) : 0;
  const title = `${draft ? "ENTWURF – " : ""}${inv.type === "storno" ? "Stornorechnung" : "Rechnung"} ${inv.number || ""}`.trim();
  return {
    draft, title, author: s.ownerName,
    senderLine: sender.join(" · "),
    recipient: [...C.recipientLines(inv.recipient), ...(inv.recipient?.vatId ? [`USt-IdNr. ${inv.recipient.vatId}`] : [])],
    info: [s.ownerName, ...sender.slice(1), s.ownerPhone && `Tel. ${s.ownerPhone}`, s.ownerEmail].filter(Boolean),
    meta: [["Rechnungsnr.", inv.number || "–"], ["Datum", d(inv.date)], inv.serviceFrom && ["Leistungszeitraum", `${d(inv.serviceFrom)} – ${d(inv.serviceTo || inv.serviceFrom)}`],
      s.taxNumber && ["Steuernummer", s.taxNumber], s.vatId && ["USt-IdNr.", s.vatId]].filter(Boolean),
    intro: [unit && `Unterkunft: ${unit.name}${obj ? `, ${[obj.street, [obj.zip, obj.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}` : ""}${unit.registrationNo ? ` · Registrierungsnr. ${unit.registrationNo}` : ""}`,
      inv.guestName && inv.recipient?.company && `Gast: ${inv.guestName}`].filter(Boolean),
    kleinunternehmer: ku,
    lines: inv.lines.map((l, i) => ({ pos: i + 1, desc: l.desc, sub: l.passThrough ? "durchlaufender Posten, nicht umsatzsteuerbar" : "", qty: String(l.qty).replace(".", ","), price: eur(l.price), vat: l.passThrough ? "–" : `${l.vat} %`, total: eur(Math.round(l.qty * l.price)) })),
    totals: [...(ku ? [] : t.taxes.flatMap((x) => [[`Nettobetrag ${x.rate} %`, eur(x.net)], [`zzgl. ${x.rate} % USt`, eur(x.vat)]])),
      ...(t.passThrough ? [["Durchlaufende Posten", eur(t.passThrough)]] : []), ["Gesamtbetrag", eur(t.gross), true],
      ...(paid ? [["bereits bezahlt", eur(paid)], ["Offen", eur(t.gross - paid), true]] : [])],
    paragraphs: [ku && "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.", inv.note, paymentText(inv), s.invoiceFooter].filter(Boolean),
    footer: [sender, [s.ownerEmail, s.ownerPhone, s.taxNumber && `St.-Nr. ${s.taxNumber}`, s.vatId && `USt-IdNr. ${s.vatId}`].filter(Boolean),
      [s.invoiceBank, s.invoiceIban && `IBAN ${s.invoiceIban}`, s.invoiceBic && `BIC ${s.invoiceBic}`].filter(Boolean)],
  };
}

const invoiceFileName = (inv) => `${inv.type === "storno" ? "Storno" : "Rechnung"} ${inv.number || "Entwurf"} ${C.recipientName(inv.recipient)}`.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 90) + ".pdf";

// PDF erzeugen und in „Belege & Dokumente → Ausgangsrechnungen“ ablegen (unveränderbares Original, GoBD)
async function archiveInvoicePdf(id, { quiet = false } = {}) {
  const inv = byId("invoices", id);
  if (!inv || inv.status === "entwurf" || (isCloud() && !canWrite())) return null;
  try {
    const P = await import("./pdf.js");
    const blob = P.invoicePdf(invoiceModel(inv));
    const docId = C.uid("d_");
    await putDocBlob(docId, blob);
    const unit = byId("units", inv.unitId);
    state.documents.push({ id: docId, name: invoiceFileName(inv), type: "application/pdf", size: blob.size, thumb: null, created: new Date().toISOString(),
      kind: "ausgangsrechnung", objectId: unit?.objectId || "", contractId: "", invoiceId: inv.id, bookingId: inv.bookingId || "", status: "verarbeitet",
      note: `${inv.type === "storno" ? "Stornorechnung" : "Rechnung"} an ${C.recipientName(inv.recipient)}`, ki: null });
    inv.pdfDocId = docId;
    commit(quiet ? undefined : `📁 PDF abgelegt unter Belege & Dokumente → Ausgangsrechnungen`);
    return blob;
  } catch (e) {
    if (!quiet) alert("PDF konnte nicht erstellt werden: " + e.message);
    return null;
  }
}

async function invoicePdfBlob(id) {
  const inv = byId("invoices", id);
  if (inv.pdfDocId) { const b = await getDocBlob(inv.pdfDocId); if (b) return b; }
  if (inv.status !== "entwurf") { const b = await archiveInvoicePdf(id, { quiet: true }); if (b) return b; }
  const P = await import("./pdf.js");
  return P.invoicePdf(invoiceModel(inv)); // Entwurf: nur Vorschau, wird nicht abgelegt
}

async function downloadInvoicePdf(id) {
  const inv = byId("invoices", id);
  const blob = await invoicePdfBlob(id);
  download(invoiceFileName(inv), blob);
}

// ---- Versand per E-Mail
function invoiceMailDefaults(inv) {
  const s = state.settings, unit = byId("units", inv.unitId), r = inv.recipient || {};
  const what = inv.type === "storno" ? "Stornorechnung" : "Rechnung";
  return {
    to: r.email || byId("bookings", inv.bookingId)?.email || "",
    subject: `${what} ${inv.number}${unit ? ` – ${unit.name}` : ""}`,
    text: `${r.company ? "Sehr geehrte Damen und Herren," : `Guten Tag${r.name ? " " + r.name : ""},`}

anbei erhalten Sie ${inv.type === "storno" ? "die Stornorechnung" : "die Rechnung"} ${inv.number}${inv.serviceFrom ? ` für den Aufenthalt vom ${d(inv.serviceFrom)} bis ${d(inv.serviceTo || inv.serviceFrom)}` : ""}${unit ? ` (${unit.name})` : ""} als PDF.${inv.replaces ? ` Sie ersetzt die Rechnung ${inv.replaces}.` : ""}
${paymentText(inv) ? "\n" + paymentText(inv) + "\n" : ""}
Mit freundlichen Grüßen
${s.ownerName || ""}${s.ownerPhone ? "\nTel. " + s.ownerPhone : ""}`,
  };
}

function emailInvoice(id) {
  const inv = byId("invoices", id), s = state.settings;
  if (inv.status === "entwurf") return alert("Bitte die Rechnung zuerst festschreiben – Entwürfe ohne Rechnungsnummer dürfen nicht verschickt werden.");
  const m = invoiceMailDefaults(inv);
  const proxy = /guest\.booking\.com|airbnb|expedia|vrbo/i.test(m.to);
  const read = (form) => ({ to: form.to.value.trim(), copy: form.copy.checked, subject: form.subject.value.trim(), text: form.text.value });
  dialog({
    title: "Rechnung per E-Mail senden", submit: "📧 Jetzt senden", wide: true,
    body: `<label class="f"><span>An *</span><input name="to" type="email" required value="${esc(m.to)}" placeholder="E-Mail des Gastes bzw. der Firma"></label>
      ${proxy ? '<div class="note small">Das ist eine Weiterleitungs-Adresse des Portals. Anhänge kommen dort nicht immer an – für Firmenrechnungen besser die E-Mail der Buchhaltung eintragen.</div>' : ""}
      <label class="f inline"><input type="checkbox" name="copy" ${s.ownerEmail ? "checked" : "disabled"}> Kopie an mich ${s.ownerEmail ? `(${esc(s.ownerEmail)})` : '<span class="muted">(eigene E-Mail unter Einstellungen eintragen)</span>'}</label>
      <label class="f"><span>Betreff</span><input name="subject" value="${esc(m.subject)}"></label>
      <label class="f"><span>Nachricht</span><textarea name="text" style="min-height:200px">${esc(m.text)}</textarea></label>
      <p class="small muted">📎 Anhang: ${esc(invoiceFileName(inv))}</p>
      <div class="toolbar"><button type="button" class="btn" data-share>📤 Stattdessen mit eigenem Mail-Programm / teilen</button></div>`,
    onOpen: (form) => { form.querySelector("[data-share]").onclick = () => { $("#modal").close(); shareInvoice(id, read(form)); }; },
    onSubmit: (form) => {
      const v = read(form);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.to)) { toast("Bitte eine gültige E-Mail-Adresse eingeben."); return false; }
      sendInvoiceMail(id, v);
    },
  });
}

function logSent(id, to, via) {
  const inv = byId("invoices", id);
  if (!inv || (isCloud() && !canWrite())) return;
  (inv.sentLog ||= []).push({ at: new Date().toISOString(), to, via });
  if (inv.recipient && to && !inv.recipient.email && via === "email") inv.recipient.email = to;
  commit();
}

async function sendInvoiceMail(id, m) {
  const inv = byId("invoices", id), s = state.settings;
  toast("📧 Rechnung wird gesendet …");
  try {
    const blob = await invoicePdfBlob(id);
    const content = await F.blobToBase64(blob);
    await callFn("immo-mail", { to: m.to, bcc: m.copy && s.ownerEmail ? s.ownerEmail : "", replyTo: s.ownerEmail || "", fromName: s.ownerName || "", subject: m.subject, text: m.text,
      attachment: { filename: invoiceFileName(inv), content, contentType: "application/pdf" } });
    logSent(id, m.to, "email");
    toast(`✅ Rechnung ${inv.number} an ${m.to} gesendet`);
  } catch (e) {
    if (confirm(`E-Mail konnte nicht über den Server gesendet werden:\n${e.message}\n\nStattdessen mit deinem eigenen Mail-Programm senden?`)) shareInvoice(id, m);
  }
}

// Ohne Mail-Server: PDF über das Teilen-Menü (Handy) oder Download + Mail-Programm (Computer)
async function shareInvoice(id, m) {
  const inv = byId("invoices", id);
  const blob = await invoicePdfBlob(id);
  const name = invoiceFileName(inv);
  const file = typeof File === "function" ? new File([blob], name, { type: "application/pdf" }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: m.subject, text: m.text }); logSent(id, m.to, "teilen"); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  download(name, blob);
  location.href = `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.text)}`;
  logSent(id, m.to, "mailprogramm");
  toast("PDF wurde heruntergeladen – bitte im Mail-Programm als Anhang hinzufügen.");
}

function viewInvoice(id) {
  const inv = byId("invoices", id);
  if (!inv) return head("Rechnung nicht gefunden");
  const s = state.settings, m = invoiceModel(inv);
  const missing = [!s.ownerName && "Name", !s.ownerStreet && "Anschrift", !s.taxNumber && !s.vatId && "Steuernummer/USt-IdNr."].filter(Boolean);
  const final = inv.status !== "entwurf", active = final && inv.type !== "storno" && inv.status !== "storniert";
  const pdfDoc = byId("documents", inv.pdfDocId);
  const sent = inv.sentLog || [];
  const fmtAt = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  return `<div class="head noprint"><div><a href="#/rechnungen">← Rechnungen</a></div><div class="toolbar">
      ${!final ? btn("editInvoice", "Bearbeiten", "", inv.id) + btn("invoiceRecipient", "👤 Empfänger / Firma", "", inv.id) + btn("deleteDraft", "Entwurf löschen", "danger", inv.id) + btn("invoicePdf", "📄 Vorschau-PDF", "", inv.id) + btn("finalizeInvoice", "✓ Festschreiben & Nummer vergeben", "primary", inv.id)
        : `${btn("invoicePdf", "📄 PDF", "", inv.id)}${btn("emailInvoice", "📧 Per E-Mail senden", "primary", inv.id)}${active ? btn("invoiceRecipient", "👤 Empfänger ändern", "", inv.id) + (inv.status !== "bezahlt" ? btn("markPaid", "Zahlung erfassen", "", inv.id) : "") + btn("cancelInvoice", "Stornieren", "danger", inv.id) : ""}`}
      <button class="btn" onclick="window.print()">🖨 Drucken</button></div></div>
    ${!final ? `<div class="note warn noprint">Entwurf – noch keine Rechnungsnummer. Empfänger prüfen (z. B. <b>Firma statt Gast</b> über „👤 Empfänger / Firma“), dann festschreiben. Danach wird das PDF automatisch abgelegt und kann per E-Mail verschickt werden.${invoiceMissing(inv).length ? ` Es fehlen: ${invoiceMissing(inv).map(esc).join(", ")}.` : ""}</div>` : ""}
    ${final ? `<div class="note noprint small">${pdfDoc ? `📁 PDF abgelegt: <button class="btn link small" data-act="openDoc" data-id="${pdfDoc.id}">${esc(pdfDoc.name)}</button> (Belege & Dokumente → Ausgangsrechnungen)` : `📄 PDF noch nicht abgelegt ${btn("archiveInvoice", "Jetzt ablegen", "sm", inv.id)}`}
      ${sent.length ? `<br>📧 Versendet: ${sent.map((x) => `${fmtAt(x.at)} an ${esc(x.to || "–")}${x.via !== "email" ? " (eigenes Mail-Programm)" : ""}`).join(" · ")}` : ""}
      ${inv.replaces ? `<br>↺ Ersetzt Rechnung ${esc(inv.replaces)}` : ""}${inv.status === "storniert" ? `<br>⚠️ Diese Rechnung wurde storniert.` : ""}</div>` : ""}
    ${R.eInvoiceHint(inv) ? `<div class="note noprint small">§ ${esc(R.eInvoiceHint(inv))}</div>` : ""}
    ${missing.length ? `<div class="note warn noprint">Pflichtangaben fehlen: ${missing.join(", ")} – bitte unter <a href="#/einstellungen">Einstellungen</a> ergänzen.</div>` : ""}
    <div class="paper">
      <div class="top"><div><div class="sender">${esc(m.senderLine)}</div>
        <div>${m.recipient.map((l, i) => (i === 0 ? `<b>${esc(l)}</b>` : esc(l))).join("<br>")}</div></div>
        <div><b>${esc(m.info[0] || "")}</b><br>${m.info.slice(1).map(esc).join("<br>")}
          <table class="meta" style="margin-top:12px">${m.meta.map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table></div></div>
      <h1>${esc(m.title)}</h1>
      ${m.intro.map((l) => `<p style="margin-bottom:6px">${esc(l)}</p>`).join("")}
      <table class="lines"><thead><tr><th>Pos.</th><th>Beschreibung</th><th class="num">Menge</th><th class="num">Einzelpreis</th>${m.kleinunternehmer ? "" : '<th class="num">USt</th>'}<th class="num">Gesamt</th></tr></thead><tbody>
        ${m.lines.map((l) => `<tr><td>${l.pos}</td><td>${esc(l.desc)}${l.sub ? `<div class="small muted">${esc(l.sub)}</div>` : ""}</td><td class="num">${esc(l.qty)}</td><td class="num">${esc(l.price)}</td>${m.kleinunternehmer ? "" : `<td class="num">${esc(l.vat)}</td>`}<td class="num">${esc(l.total)}</td></tr>`).join("")}
      </tbody></table>
      <table class="totals">${m.totals.map(([k, v, bold]) => `<tr class="${bold ? "sum" : ""}"><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`).join("")}</table>
      <div style="margin-top:24px">${m.paragraphs.map((p) => `<p style="margin-bottom:8px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>
      <div class="foot">${m.footer.map((c) => `<div>${c.map(esc).join("<br>")}</div>`).join("")}</div>
    </div>`;
}

function viewTax() {
  const y = ui.year;
  const av = C.anlageV(state, y);
  const s = state.settings;
  const from = ui.datevFrom || `${ui.month}-01`;
  const to = ui.datevTo || `${ui.month}-${String(C.daysInMonth(ui.month)).padStart(2, "0")}`;
  const rows = C.datevRows(state, from, to);
  const openTx = state.transactions.filter((t) => !t.link && t.date >= from && t.date <= to).length;
  const incomeRows = [["kalt", "Mieteinnahmen (Kaltmiete, Zuschläge)"], ["umlage", "Umlagen / Nebenkosten-Vorauszahlungen und -Nachzahlungen"], ["fewo", "Einnahmen Ferienwohnung (netto)"], ["sonstige", "Sonstige Einnahmen"]];
  const col = (r, fn) => av.map((x) => `<td class="num">${eur(fn(x))}</td>`).join("") + (av.length > 1 ? `<td class="num"><b>${eur(sum(av, fn))}</b></td>` : "");
  return head("Steuer & DATEV", "Anlage V, DATEV-Export und Monatspaket für den Steuerberater", btn("year", "‹ " + (y - 1), "", y - 1) + `<b style="padding:0 6px">${y}</b>` + btn("year", (y + 1) + " ›", "", y + 1)) + `
    <div class="card noprint"><h2>📬 Monatsbericht für den Steuerberater</h2><p class="small muted" style="margin-bottom:8px">Alle Mieteinnahmen und alle Ferienwohnungs-Einnahmen eines Monats als PDF, Excel-Tabelle und DATEV-Datei – mit einem Klick an deinen Steuerberater.</p><a class="btn primary" href="#/monat/${C.addMonths(C.monthKey(today()), -1)}">Monatsbericht öffnen</a></div>
    <div class="card noprint"><h2>DATEV-Export & Steuerberater-Paket</h2>
      <div class="inline" style="margin-bottom:10px">
        <label class="small">von <input type="date" value="${from}" data-change="datevFrom"></label>
        <label class="small">bis <input type="date" value="${to}" data-change="datevTo"></label>
        ${btn("datevPreset", "Monat", "sm", "m")}${btn("datevPreset", "Quartal", "sm", "q")}${btn("datevPreset", "Jahr " + y, "sm", "y")}
      </div>
      ${!s.datevBerater || !s.datevMandant ? `<div class="note warn">Berater- und Mandantennummer fehlen – bitte unter <a href="#/einstellungen">Einstellungen</a> eintragen (bekommst du vom Steuerberater).</div>` : ""}
      ${openTx ? `<div class="note warn">${openTx} Bankumsätze im Zeitraum sind noch nicht zugeordnet und fehlen im Export. <a href="#/bank">Jetzt zuordnen →</a></div>` : ""}
      <div class="toolbar">${btn("datev", "⬇ DATEV-Buchungsstapel (EXTF)", "primary")}${btn("journal", "⬇ Buchungsliste (Excel)")}<a class="btn" href="#/bericht/${from}_${to}">🖨 Bericht drucken</a><a class="btn" href="#/paket/${y}">📦 Jahrespaket ${y} für Steuerberater</a></div>
      <div class="note" style="margin-top:12px">🧾 <b>Steuererklärung selbst machen:</b> Vorprüfung wie beim Steuerberater, Ausfüllhilfe für Anlage V / V-FeWo mit Kopier-Knöpfen und Schritt-für-Schritt-Abgabe in Mein ELSTER. <a class="btn sm primary" href="#/erklaerung/${y}">Erklärung ${y} vorbereiten →</a></div>
      <p class="small muted" style="margin-top:8px">${rows.length} Buchungssätze · SKR ${s.skr} · Bank ${C.accountsFor(s).bank}. Der Buchungsstapel kann vom Steuerberater direkt in DATEV Rechnungswesen importiert werden (Format EXTF 700). Kontenzuordnung unter Einstellungen anpassbar.</p>
      ${rows.length ? `<details style="margin-top:8px"><summary class="small">Vorschau Buchungssätze</summary><div class="table-wrap"><table><thead><tr><th>Datum</th><th class="num">Betrag</th><th>S/H</th><th>Konto</th><th>Gegenkonto</th><th>Beleg</th><th>Text</th></tr></thead><tbody>
        ${rows.slice(0, 100).map((r) => `<tr><td>${d(r.date)}</td><td class="num">${C.fmtNum(r.amount)}</td><td>${r.sh}</td><td>${r.konto}</td><td>${r.gegen}</td><td class="small">${esc(r.beleg)}</td><td class="small">${esc(r.text)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
    </div>
    <div class="card"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">Anlage V – Zusammenstellung ${y}</h2><div class="toolbar noprint"><button class="btn sm" onclick="window.print()">Drucken / PDF</button></div></div>
      <div class="table-wrap"><table><thead><tr><th></th>${av.map((x) => `<th class="num">${esc(x.name)}</th>`).join("")}${av.length > 1 ? '<th class="num">Gesamt</th>' : ""}</tr></thead><tbody>
        <tr><td colspan="${av.length + 2}"><b>Einnahmen</b> <span class="small muted">(Zuflussprinzip, netto ohne USt, ohne Kaution & Kurtaxe)</span></td></tr>
        ${incomeRows.map(([k, l]) => `<tr><td>${l}</td>${col(null, (x) => x.income[k])}</tr>`).join("")}
        <tr><td><b>Summe Einnahmen</b></td>${col(null, (x) => x.incomeTotal)}</tr>
        <tr><td colspan="${av.length + 2}"><b>Werbungskosten</b></td></tr>
        ${Object.entries(C.AV_GROUPS).map(([k, l]) => `<tr><td>${l}</td>${col(null, (x) => x.costs[k])}</tr>`).join("")}
        <tr><td><b>Summe Werbungskosten</b></td>${col(null, (x) => x.costTotal)}</tr>
      </tbody><tfoot><tr><td>Überschuss / Verlust</td>${col(null, (x) => x.result)}</tr></tfoot></table></div>
      ${av.filter((x) => C.parseOwners(byId("objects", x.objectId)?.owners).length > 1).map((x) => `<p class="small" style="margin-top:6px"><b>${esc(x.name)}</b> – Aufteilung Miteigentum: ${C.parseOwners(byId("objects", x.objectId).owners).map((o) => `${esc(o.name)} (${o.share} %) ${eur(Math.round(x.result * o.share / 100))}`).join(" · ")}</p>`).join("")}
      <p class="small muted" style="margin-top:8px">Zusammenstellung als Vorbereitung für die Anlage V bzw. den Steuerberater – keine Steuerberatung. Ferienwohnungen mit hotelähnlichen Leistungen können gewerblich sein; bei Regelbesteuerung ist zusätzlich die Umsatzsteuer-Voranmeldung zu beachten. Nicht abziehbar: Tilgung, Privat.</p>
    </div>`;
}

function viewReport(range) {
  const [from, to] = range.split("_");
  const pays = state.payments.filter((p) => p.date >= from && p.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1));
  const exps = state.expenses.filter((e) => e.date >= from && e.date <= to && e.category !== "privat").sort((a, b) => (a.date < b.date ? -1 : 1));
  const invs = state.invoices.filter((i) => i.date >= from && i.date <= to);
  const s = state.settings;
  const kFrom = C.monthKey(from), kTo = C.monthKey(to);
  const si = C.sollIst(state, kFrom, kTo);
  const payLabel = (p) => p.kind === "miete" ? `Miete ${C.fmtMonth(p.period)} · ${contractLabel(byId("contracts", p.contractId))}` : p.kind === "fewo" ? `Rechnung ${byId("invoices", p.invoiceId)?.number || ""} · ${C.recipientName(byId("invoices", p.invoiceId)?.recipient)}` : `${C.INCOME_KINDS[p.kind]} ${p.note || ""}`;
  return `<div class="head noprint"><a href="#/steuer">← Steuer & DATEV</a><button class="btn primary" onclick="window.print()">Drucken / PDF</button></div>
    <div class="card"><h1>Immobilien-Bericht ${d(from)} – ${d(to)}</h1><p class="muted">${esc(s.ownerName)} · erstellt am ${d(today())}${s.datevMandant ? ` · Mandant ${esc(s.datevMandant)}` : ""}</p>
      <div class="kpis" style="margin-top:12px"><div class="kpi"><div class="l">Einnahmen</div><div class="v">${eur(sum(pays.filter((p) => p.kind !== "kaution"), (p) => p.amount))}</div></div>
        <div class="kpi"><div class="l">Ausgaben</div><div class="v">${eur(sum(exps, (e) => e.amount))}</div></div>
        <div class="kpi"><div class="l">Mietrückstand im Zeitraum</div><div class="v">${eur(-sum(si.filter((r) => r.diff < 0), (r) => r.diff))}</div></div></div>
      <h3>Einnahmen</h3><table><thead><tr><th>Datum</th><th>Vorgang</th><th>Weg</th><th class="num">Betrag</th></tr></thead><tbody>${pays.map((p) => `<tr><td>${d(p.date)}</td><td>${esc(payLabel(p))}</td><td>${p.txId ? "Bank" : "Kasse"}</td><td class="num">${eur(p.amount)}</td></tr>`).join("")}</tbody></table>
      <h3>Ausgaben</h3><table><thead><tr><th>Datum</th><th>Empfänger</th><th>Kategorie</th><th>Objekt</th><th>Beleg</th><th class="num">Betrag</th></tr></thead><tbody>${exps.map((e) => `<tr><td>${d(e.date)}</td><td>${esc(e.vendor)}</td><td>${esc(C.EXPENSE_CATEGORIES[e.category]?.label)}</td><td>${esc(byId("objects", e.objectId)?.name || "")}</td><td>${esc(e.belegNr || "")}</td><td class="num">${eur(e.amount)}</td></tr>`).join("")}</tbody></table>
      ${invs.length ? `<h3>Ausgestellte Rechnungen</h3><table><thead><tr><th>Nr.</th><th>Datum</th><th>Empfänger</th><th class="num">Netto</th><th class="num">USt</th><th class="num">Brutto</th><th>Status</th></tr></thead><tbody>${invs.map((i) => { const t = C.invoiceTotals(i); return `<tr><td>${esc(i.number)}</td><td>${d(i.date)}</td><td>${esc(C.recipientName(i.recipient))}</td><td class="num">${eur(t.net)}</td><td class="num">${eur(t.vat)}</td><td class="num">${eur(t.gross)}</td><td>${esc(i.status)}</td></tr>`; }).join("")}</tbody></table>` : ""}
      <h3>Offene Mieten</h3><table>${si.filter((r) => r.diff < 0).map((r) => `<tr><td>${C.fmtMonth(r.key)}</td><td>${esc(contractLabel(byId("contracts", r.contractId)))}</td><td class="num neg">${eur(r.diff)}</td></tr>`).join("") || '<tr><td class="muted">keine</td></tr>'}</table>
    </div>`;
}

// ---------------------------------------------------------------- Nebenkostenabrechnung

function nkDraft() {
  if (!ui.nk || !byId("objects", ui.nk.objectId)) {
    const ly = Number(today().slice(0, 4)) - 1;
    const objectId = state.objects[0]?.id;
    ui.nk = { id: null, objectId, from: `${ly}-01-01`, to: `${ly}-12-31`, items: objectId ? C.nkItemsFromExpenses(state, objectId, `${ly}-01-01`, `${ly}-12-31`) : [] };
  }
  return ui.nk;
}

function fillFromMeters(i, silent) {
  const nk = nkDraft(), it = nk.items[i];
  const types = it.kind === "heizung" ? ["heizung"] : it.kind === "warmwasser" ? ["wasser_warm"] : ["wasser_kalt", "wasser_warm"];
  const units = state.units.filter((u) => u.objectId === nk.objectId && C.NK_UNIT_TYPES(u));
  const shares = {}; let found = 0;
  for (const u of units) {
    const vals = types.map((t) => C.consumptionFor(state, u.id, t, nk.from, nk.to)).filter((x) => x !== null);
    if (vals.length) { shares[u.id] = Math.round(vals.reduce((a, b) => a + b, 0) * 1000) / 1000; found++; }
  }
  if (!found) { if (!silent) toast("Keine passenden Zählerstände (Beginn und Ende des Zeitraums) gefunden – beim Mieterwechsel oder unter Mieterakte erfassen."); return; }
  it.shares = shares;
  if (!["heizkosten", "verbrauch"].includes(it.key)) it.key = it.kind === "heizung" ? "heizkosten" : "verbrauch";
  if (!silent) toast(`Verbrauch für ${found} Einheit(en) übernommen`);
}

function viewNk() {
  if (!state.objects.length) return head("Nebenkostenabrechnung") + `<div class="card empty">Bitte zuerst ein Objekt mit Einheiten und Mietverträgen anlegen.</div>`;
  const nk = nkDraft();
  const units = state.units.filter((u) => u.objectId === nk.objectId && C.NK_UNIT_TYPES(u));
  const r = C.nkAbrechnung(state, nk);
  const saved = (state.nkStatements || []).filter((x) => x.objectId === nk.objectId).sort((a, b) => (a.to < b.to ? 1 : -1));
  const late = today() > r.deadline;
  const periodIssues = R.nkPeriodCheck(nk.from, nk.to);
  const nonUml = state.expenses.filter((e) => e.objectId === nk.objectId && e.date >= nk.from && e.date <= nk.to && !C.EXPENSE_CATEGORIES[e.category]?.umlage && C.EXPENSE_CATEGORIES[e.category]?.av);
  const needsShares = (it) => ["verbrauch", "heizkosten", "direkt"].includes(it.key);
  const itemRow = (it, i) => `<tr>
    <td><input list="betrkv" value="${esc(it.label)}" data-nk="label" data-i="${i}"></td>
    <td style="width:130px"><input inputmode="decimal" value="${it.key === "direkt" ? "" : esc(C.fmtNum(it.amount))}" data-nk="amount" data-i="${i}" ${it.key === "direkt" ? 'disabled placeholder="je Einheit"' : ""}></td>
    <td style="width:230px"><select data-nk="key" data-i="${i}">${opt(Object.entries(C.NK_KEYS), it.key)}</select>
      ${it.key === "heizkosten" ? `<div class="inline small" style="margin-top:4px">Verbrauchsanteil <input type="number" min="50" max="70" value="${esc(it.pct ?? 70)}" data-nk="pct" data-i="${i}" style="width:70px"> %</div>` : ""}
      ${["heizung", "warmwasser"].includes(it.kind) || it.key === "heizkosten" ? `<div class="small" style="margin-top:4px">CO2-Kosten lt. Brennstoffrechnung (€) <input inputmode="decimal" value="${it.co2Cost ? esc(C.fmtNum(it.co2Cost)) : ""}" data-nk="co2Cost" data-i="${i}" style="width:90px" placeholder="0,00"> · CO2 kg/m²/Jahr <input inputmode="decimal" value="${esc(it.co2Kg ?? "")}" data-nk="co2Kg" data-i="${i}" style="width:60px"> <label><input type="checkbox" data-nk="nonResidential" data-i="${i}" ${it.nonResidential ? "checked" : ""}> Nichtwohngebäude (50/50)</label>${it.co2Cost ? ` → Vermieteranteil ${r.co2[i]?.landlordPct ?? "?"} % = ${eur(r.co2[i]?.landlord || 0)}` : ""}</div>` : ""}</td>
    <td class="nowrap">${(it.expenseIds || []).flatMap((eid) => byId("expenses", eid)?.fileIds || []).length ? `<span title="Belege vorhanden">📎${(it.expenseIds || []).flatMap((eid) => byId("expenses", eid)?.fileIds || []).length}</span>` : (it.expenseIds || []).length ? '<span class="muted small" title="Ausgabe ohne Beleg – unter Ausgaben anhängen">kein Beleg</span>' : ""} <button class="btn sm link" data-act="nkDel" data-id="${i}">✕</button></td></tr>
    ${needsShares(it) ? `<tr><td colspan="4" style="background:#fafbfa"><div class="small muted" style="margin-bottom:4px">${it.key === "direkt" ? "Betrag je Einheit (€)" : `Verbrauch je Einheit (Zählerdifferenz, z. B. m³ / kWh / Einheiten Heizkostenverteiler) ${btn("nkMeters", "⟳ aus Zählerständen", "sm", i)}`}</div><div class="inline">
      ${units.map((u) => `<label class="small">${esc(u.name)} <input style="width:100px" inputmode="decimal" value="${esc(it.key === "direkt" ? C.fmtNum(it.shares?.[u.id] || 0) : (it.shares?.[u.id] ?? ""))}" data-nk="share" data-i="${i}" data-u="${u.id}"></label>`).join("")}</div></td></tr>` : ""}`;
  return head("Nebenkostenabrechnung", "Betriebskosten nach BetrKV – tagegenau, mit Leerstandsanteil des Vermieters", `<a class="btn primary" href="#/nkassistent">🧭 Geführter Assistent</a>`) + `
    <datalist id="betrkv">${C.BETRKV.map(([, l]) => `<option value="${esc(l)}">`).join("")}</datalist>
    <div class="card noprint"><div class="fgrid">
      <label class="f"><span>Objekt</span><select data-nk="objectId">${opt(state.objects.map((o) => [o.id, o.name]), nk.objectId)}</select></label>
      <div class="inline"><label class="f"><span>Abrechnungszeitraum von</span><input type="date" value="${nk.from}" data-nk="from"></label><label class="f"><span>bis</span><input type="date" value="${nk.to}" data-nk="to"></label></div>
    </div>
    ${saved.length ? `<div class="small">Gespeicherte Abrechnungen: ${saved.map((x) => `<button class="btn sm link" data-act="nkLoad" data-id="${x.id}">${d(x.from)}–${d(x.to)}</button>`).join(" · ")}</div>` : ""}
    </div>
    <div class="card"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">Umlagefähige Kosten (§ 2 BetrKV)</h2>
      <div class="toolbar">${btn("nkFromExpenses", "Aus Ausgaben übernehmen", "sm")}${btn("nkAdd", "+ Kostenart", "sm")}${btn("nkKiCheck", "✨ KI-Prüfung", "sm")}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Kostenart</th><th class="num">Gesamtkosten Haus</th><th>Umlageschlüssel</th><th></th></tr></thead><tbody>
      ${nk.items.map(itemRow).join("") || '<tr><td colspan="4" class="muted">Noch keine Kosten – „Aus Ausgaben übernehmen“ oder „+ Kostenart“.</td></tr>'}</tbody>
      <tfoot><tr><td>Summe</td><td class="num">${eur(r.total)}</td><td colspan="2"></td></tr></tfoot></table></div>
      <p class="small muted" style="margin-top:6px">Nur Kosten umlegen, die im Mietvertrag vereinbart sind. Heizöl: Verbrauch = Anfangsbestand + Lieferungen − Endbestand. Heizkosten bei mehreren Parteien: 50–70 % nach Verbrauch (HeizkostenV). Belege außerhalb des Zeitraums gehören ins nächste Jahr.</p>
    </div>
    ${legalNotes(periodIssues)}
    ${r.warnings.length || late ? `<div class="note warn">${late ? `<b>Frist abgelaufen:</b> Die Abrechnung musste bis ${d(r.deadline)} beim Mieter sein (§ 556 Abs. 3 BGB) – Nachforderungen sind ausgeschlossen, Guthaben müssen trotzdem ausgezahlt werden.<br>` : ""}${r.warnings.map(esc).join("<br>")}</div>` : `<div class="note">Frist: Die Abrechnung muss spätestens am <b>${d(r.deadline)}</b> beim Mieter sein (§ 556 Abs. 3 BGB).</div>`}
    <div class="card"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">Ergebnis je Mieter</h2><div class="toolbar">${btn("nkSave", nk.id ? "Änderungen speichern" : "Abrechnung speichern", "primary")}</div></div>
      ${r.contracts.length ? `<div class="table-wrap"><table><thead><tr><th>Einheit · Mieter</th><th class="num">Tage</th><th class="num">Kostenanteil</th><th class="num">Vorauszahlungen</th><th class="num">Ergebnis</th><th class="num">Vorschlag VZ/Monat</th><th></th></tr></thead><tbody>
      ${r.contracts.map((c) => `<tr><td>${esc(contractLabel(byId("contracts", c.contractId)))}</td><td class="num">${c.days}</td><td class="num">${eur(c.total)}</td><td class="num">${eur(c.prepaid)}${c.prepaid !== c.prepaidSoll ? `<div class="small muted">Soll ${eur(c.prepaidSoll)}</div>` : ""}</td>
        <td class="num ${c.saldo > 0 ? "neg" : "pos"}"><b>${c.saldo > 0 ? "Nachzahlung " + eur(c.saldo) : "Guthaben " + eur(-c.saldo)}</b></td><td class="num">${eur(c.newMonthly)}</td>
        <td>${nk.id ? `<a class="btn sm" href="#/nkbrief/${nk.id}/${c.contractId}">🖨 Anschreiben</a>` : '<span class="small muted">erst speichern</span>'}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Vermieter (Leerstand / Rundung)</td><td class="num">${r.owner.days}</td><td class="num">${eur(r.owner.total)}</td><td colspan="4"></td></tr></tfoot></table></div>
      <p class="small muted" style="margin-top:6px">Kontrolle: Summe aller Anteile ${eur(r.check)} ${r.check === r.total ? "= Gesamtkosten ✓" : `≠ Gesamtkosten ${eur(r.total)} ✗`}. Vorauszahlungen = tatsächlich eingegangene NK-Anteile der Mietzahlungen.</p>` : '<p class="muted">Keine Mietverträge im Zeitraum.</p>'}
    </div>
    <div class="card"><h2>Nicht umlagefähig (für den Steuerberater)</h2>${nonUml.length ? `<table>${nonUml.map((e) => `<tr><td>${d(e.date)}</td><td>${esc(e.vendor)}</td><td class="small">${esc(C.EXPENSE_CATEGORIES[e.category].label)}</td><td class="num">${eur(e.amount)}</td></tr>`).join("")}</table>` : '<p class="muted">Keine im Zeitraum.</p>'}
      <p class="small muted">Instandhaltung, Verwaltung, Zinsen, Bankgebühren, Rücklagen und Herstellungskosten dürfen nicht umgelegt werden.</p></div>`;
}

function viewNkLetter(stId, contractId) {
  const st = (state.nkStatements || []).find((x) => x.id === stId);
  if (!st) return head("Abrechnung nicht gefunden");
  const r = C.nkAbrechnung(state, st);
  const c = r.contracts.find((x) => x.contractId === contractId);
  const contract = byId("contracts", contractId);
  if (!c || !contract) return head("Mieter nicht in dieser Abrechnung");
  const u = byId("units", c.unitId), o = byId("objects", u?.objectId), s = state.settings;
  const tenants = contract.tenantIds.map((id) => byId("tenants", id)).filter(Boolean);
  const units = state.units.filter((x) => x.objectId === st.objectId && C.NK_UNIT_TYPES(x));
  const area = sum(units, (x) => Number(x.area));
  const sender = [s.ownerName, s.ownerStreet, [s.ownerZip, s.ownerCity].filter(Boolean).join(" ")].filter(Boolean);
  const due = addDays(today(), 30);
  const att = st.items.flatMap((it) => (it.expenseIds || []).flatMap((eid) => byId("expenses", eid)?.fileIds || [])).map((fid) => byId("documents", fid)).filter(Boolean);
  return `<div class="head noprint"><a href="#/nebenkosten">← Nebenkosten</a><div class="toolbar">${att.length ? `<label class="small inline"><input type="checkbox" data-act="nkAttach" ${ui.nkAttach ? "checked" : ""}> Belegkopien anhängen (${att.length})</label>` : ""}${btn("nkArchive", "Im Briefarchiv vermerken", "", `${stId}|${contractId}`)}<button class="btn primary" onclick="window.print()">Drucken / PDF</button></div></div>
  <div class="paper">
    <div class="top"><div><div class="sender">${esc(sender.join(" · "))}</div>
      <div><b>${esc(tenants.map((t) => t.name).join(", "))}</b><br>${esc(tenants[0]?.address || addrOf(u))}</div></div>
      <div><b>${esc(s.ownerName)}</b><br>${sender.slice(1).map(esc).join("<br>")}${s.ownerPhone ? `<br>Tel. ${esc(s.ownerPhone)}` : ""}${s.ownerEmail ? `<br>${esc(s.ownerEmail)}` : ""}<br><br>${d(today())}</div></div>
    <h1>Betriebskostenabrechnung ${d(st.from)} – ${d(st.to)}</h1>
    <p>Mietobjekt: ${esc(addrOf(u))}, ${esc(u?.name)}${u?.area ? ` (${String(u.area).replace(".", ",")} m² von ${String(area).replace(".", ",")} m²)` : ""}<br>
    Ihr Nutzungszeitraum: ${c.days} von ${r.days} Tagen${c.persons ? ` · ${c.persons} Person(en)` : ""}</p>
    <p style="margin:12px 0">${tenants.length > 1 ? "Sehr geehrte Damen und Herren" : `Guten Tag ${esc(tenants[0]?.name || "")}`},<br>
    hiermit erhalten Sie die Abrechnung der Betriebskosten. Die Gesamtkosten des Hauses werden nach dem jeweils genannten Schlüssel auf alle Wohnungen verteilt; für Ihren Anteil zählen nur die Tage, in denen Sie gemietet haben. Davon ziehen wir Ihre geleisteten Vorauszahlungen ab.</p>
    <table class="lines"><thead><tr><th>Kostenart</th><th>Verteilung nach</th><th class="num">Gesamtkosten Haus</th><th class="num">Ihr Anteil</th></tr></thead><tbody>
      ${st.items.map((it, i) => { const tot = (it.key === "direkt" ? sum(units, (x) => Number(it.shares?.[x.id]) || 0) : it.amount) - (r.co2[i]?.landlord || 0);
        const fmtN = (n) => String(Math.round(n * 100) / 100).replace(".", ",");
        const personDays = sum(r.contracts, (x) => x.persons * x.days);
        const noCons = ["heizkosten", "verbrauch"].includes(it.key) && !Object.values(it.shares || {}).some(Number);
        const basis = noCons ? `ohne Verbrauchswerte nach Fläche: ${fmtN(Number(u?.area) || 0)} von ${fmtN(area)} m² × ${c.days}/${r.days} Tage${it.key === "heizkosten" ? " – Sie dürfen Ihren Anteil um 15 % kürzen (§ 12 HeizkostenV)" : ""}` : { flaeche: `Ihre Fläche ${fmtN(Number(u?.area) || 0)} m² von ${fmtN(area)} m² Gesamtfläche × ${c.days}/${r.days} Tage`, einheiten: `1 von ${units.length} Einheiten × ${c.days}/${r.days} Tage`, personen: `${c.persons} Pers. × ${c.days} Tage = ${c.persons * c.days} von ${personDays} Personentagen`,
          verbrauch: `Ihr Verbrauch ${fmtN(Number(it.shares?.[u.id]) || 0)} von ${fmtN(sum(units, (x) => Number(it.shares?.[x.id]) || 0))}`, heizkosten: `${100 - (it.pct ?? 70)} % nach Fläche (${fmtN(Number(u?.area) || 0)} von ${fmtN(area)} m²), ${it.pct ?? 70} % nach Verbrauch (${fmtN(Number(it.shares?.[u.id]) || 0)} von ${fmtN(sum(units, (x) => Number(it.shares?.[x.id]) || 0))})`, direkt: "direkt Ihrer Einheit zugeordnet" }[it.key];
        return `<tr><td>${esc(it.label)}${r.co2[i]?.landlord ? `<div class="small muted">abzgl. Vermieteranteil CO2-Kosten ${eur(r.co2[i].landlord)}</div>` : ""}</td><td class="small">${esc(C.NK_KEYS[it.key])}<br><span class="muted">${esc(basis)}</span></td><td class="num">${eur(tot)}</td><td class="num">${eur(c.items[i].amount)}</td></tr>`; }).join("")}
    </tbody></table>
    <table class="totals">
      <tr><td>Ihr Kostenanteil</td><td class="num">${eur(c.total)}</td></tr>
      <tr><td>abzüglich geleistete Vorauszahlungen</td><td class="num">− ${eur(c.prepaid)}</td></tr>
      <tr class="sum"><td>${c.saldo > 0 ? "Nachzahlung" : "Guthaben"}</td><td class="num" style="color:${c.saldo > 0 ? "var(--bad)" : "var(--ok)"}">${eur(Math.abs(c.saldo))}</td></tr>
    </table>
    <div style="margin-top:20px">
      ${c.saldo > 0 ? `<p>Bitte überweisen Sie die Nachzahlung bis zum <b>${d(due)}</b> auf das Konto ${s.invoiceIban ? `IBAN ${esc(s.invoiceIban)}${s.invoiceBank ? ` (${esc(s.invoiceBank)})` : ""}` : "[IBAN]"}, Verwendungszweck „NK ${st.to.slice(0, 4)} ${esc(u?.name || "")}“.</p>` : c.saldo < 0 ? `<p>Das Guthaben überweisen wir Ihnen in den nächsten Tagen bzw. verrechnen es nach Absprache mit der nächsten Miete.</p>` : ""}
      ${c.newMonthly !== C.rentForMonth(contract, C.monthKey(today())).nk ? `<p>Damit es im nächsten Jahr keine größere ${c.saldo > 0 ? "Nachzahlung" : "Abweichung"} gibt, passen wir die monatliche Vorauszahlung ab dem übernächsten Monat auf <b>${eur(c.newMonthly)}</b> an (§ 560 Abs. 4 BGB).</p>` : ""}
      ${st.items.map((it, i) => r.co2[i]?.landlord ? `<p class="small">Aufteilung der CO2-Kosten nach dem CO2-Kostenaufteilungsgesetz (${esc(it.label)}): CO2-Kosten ${eur(it.co2Cost)}, ${it.nonResidential ? "Nichtwohngebäude (50 % Vermieter)" : `CO2-Ausstoß ${String(it.co2Kg).replace(".", ",")} kg CO2/m²/Jahr, Stufe ${r.co2[i].stufe}, Vermieteranteil ${r.co2[i].landlordPct} %`} = ${eur(r.co2[i].landlord)}. Dieser Anteil ist in der Abrechnung bereits abgezogen.</p>` : "").join("")}
      <p>Die Belege können Sie nach vorheriger Terminabsprache gern einsehen. Einwendungen gegen diese Abrechnung teilen Sie uns bitte spätestens bis zum Ablauf des zwölften Monats nach Zugang mit (§ 556 Abs. 3 S. 5 BGB). Bei Fragen melden Sie sich jederzeit.</p>
      <p style="margin-top:16px">Mit freundlichen Grüßen<br><br>${esc(s.ownerName)}</p>
      <p class="small muted" style="margin-top:16px">Anlagen: ${att.length ? att.map((x) => esc(x.name)).join(", ") : "Kopien der Abrechnungsbelege auf Anfrage"}</p>
    </div>
  </div>
  ${ui.nkAttach ? att.map((x) => x.type.startsWith("image/") ? `<div class="paper anlage"><p class="small muted">Anlage: ${esc(x.name)}</p><img data-doc="${x.id}" style="width:100%"></div>` : `<div class="paper anlage noprint"><p>PDF-Anlage „${esc(x.name)}“ bitte separat drucken: <button class="btn sm" data-act="openDoc" data-id="${x.id}">öffnen</button></p></div>`).join("") : ""}`;
}

// ---------------------------------------------------------------- Jahrespaket Steuerberater

function viewPackage(yearArg) {
  const y = Number(yearArg) || ui.year;
  const s = state.settings;
  const av = C.anlageV(state, y);
  const inc = C.incomeByUnitMonth(state, y);
  const pts = C.taxOpenPoints(state, y);
  const exps = state.expenses.filter((e) => e.date.startsWith(String(y)) && e.category !== "privat").sort((a, b) => (a.date < b.date ? -1 : 1));
  const hk = exps.filter((e) => e.category === "herstellung");
  const nks = (state.nkStatements || []).filter((x) => x.to.startsWith(String(y)) || x.to.startsWith(String(y - 1)));
  const mm = Array.from({ length: 12 }, (_, i) => i + 1);
  const ownersOf = (o) => C.parseOwners(o?.owners);
  const page = (html) => `<section class="card pkg">${html}</section>`;
  return `<style>@media print { @page { size: A4 landscape; margin: 12mm; } .pkg { page-break-after: always; } }
    .pkg th { background: #1f4e5f; color: #fff; } .pkg tbody tr:nth-child(even) td { background: #f5f8f8; }</style>
  <div class="head noprint"><a href="#/steuer">← Steuer & DATEV</a><div class="toolbar">${btn("pkgYear", "‹", "", y - 1)}<b>${y}</b>${btn("pkgYear", "›", "", y + 1)}<button class="btn primary" onclick="window.print()">Drucken / PDF</button></div></div>
  ${page(`<h1>Unterlagen Vermietung & Verpachtung ${y}</h1><p class="muted">${esc(s.ownerName)}${s.taxNumber ? ` · St.-Nr. ${esc(s.taxNumber)}` : ""} · erstellt am ${d(today())}</p>
    <h3>Inhalt</h3><ol style="margin-left:20px"><li>Übersicht aller Objekte</li><li>Monatstabellen je Objekt und Einheit</li><li>Werbungskosten je Objekt</li><li>Anschaffungs-/Herstellungskosten (Einordnung StB)</li><li>Nebenkostenabrechnungen</li><li>Beleg-Checkliste</li><li>Offene Fragen</li></ol>
    <p class="small muted" style="margin-top:12px">Zusammenstellung aus ${productName()}. Einordnungen sind Vorschläge – die Entscheidung trifft der Steuerberater. DATEV-Buchungsstapel liegt separat bei.</p>`)}
  ${page(`<h2>1. Übersicht</h2><div class="table-wrap"><table><thead><tr><th>Objekt</th><th>Eigentümer</th><th class="num">Einnahmen</th><th class="num">Werbungskosten</th><th class="num">davon AfA</th><th class="num">Überschuss</th></tr></thead><tbody>
    ${av.map((r) => { const o = byId("objects", r.objectId); const ow = ownersOf(o);
      return `<tr><td>${esc(r.name)}<div class="small muted">${esc(addrOf({ objectId: r.objectId }))}</div></td><td class="small">${ow.length ? ow.map((x) => `${esc(x.name)} ${x.share} %: ${eur(Math.round(r.result * x.share / 100))}`).join("<br>") : esc(s.ownerName)}</td><td class="num">${eur(r.incomeTotal)}</td><td class="num">${eur(r.costTotal)}</td><td class="num">${eur(r.costs.afa)}</td><td class="num"><b>${eur(r.result)}</b></td></tr>`; }).join("")}
    </tbody><tfoot><tr><td colspan="2">Gesamt</td><td class="num">${eur(sum(av, (r) => r.incomeTotal))}</td><td class="num">${eur(sum(av, (r) => r.costTotal))}</td><td class="num">${eur(sum(av, (r) => r.costs.afa))}</td><td class="num">${eur(sum(av, (r) => r.result))}</td></tr></tfoot></table></div>`)}
  ${state.objects.map((o) => { const units = state.units.filter((u) => u.objectId === o.id);
    return page(`<h2>2. ${esc(o.name)} – Zuflüsse je Monat (netto)</h2><div class="table-wrap"><table><thead><tr><th>Einheit</th><th></th>${mm.map((m) => `<th class="num">${C.MONTHS_DE[m - 1].slice(0, 3)}</th>`).join("")}<th class="num">Summe</th></tr></thead><tbody>
      ${units.map((u) => { const rows = u.type === "ferienwohnung" ? [["fewo", "FeWo"]] : [["kalt", "Kalt"], ["umlage", "NK"]];
        return rows.map(([k, l], i) => `<tr>${i === 0 ? `<td rowspan="${rows.length}" class="small"><b>${esc(u.name)}</b><br>${esc(u.type === "ferienwohnung" ? "Ferienwohnung" : tenantNames(state.contracts.find((c) => c.unitId === u.id && c.start <= `${y}-12-31` && (!c.end || c.end >= `${y}-01-01`))))}</td>` : ""}<td class="small">${l}</td>${mm.map((m) => `<td class="num small">${inc[u.id]?.[m]?.[k] ? C.fmtNum(inc[u.id][m][k]) : ""}</td>`).join("")}<td class="num small"><b>${C.fmtNum(sum(mm, (m) => inc[u.id]?.[m]?.[k] || 0))}</b></td></tr>`).join(""); }).join("")}
      </tbody></table></div>
      <h3>3. Werbungskosten ${esc(o.name)}</h3><table>${Object.entries(C.AV_GROUPS).map(([k, l]) => { const r = av.find((x) => x.objectId === o.id); return r?.costs[k] ? `<tr><td>${l}</td><td class="num">${eur(r.costs[k])}</td></tr>` : ""; }).join("")}</table>
      ${o.buildingShare ? `<p class="small muted">AfA: ${o.afaRate} % von ${eur(o.buildingShare)} (Gebäudeanteil), Erwerb ${d(o.purchaseDate)}</p>` : ""}`); }).join("")}
  ${page(`<h2>4. Anschaffungs- / Herstellungskosten</h2>${hk.length ? `<table><thead><tr><th>Datum</th><th>Objekt</th><th>Empfänger</th><th>Notiz</th><th class="num">Betrag</th></tr></thead><tbody>${hk.map((e) => `<tr><td>${d(e.date)}</td><td>${esc(byId("objects", e.objectId)?.name || "")}</td><td>${esc(e.vendor)}</td><td class="small">${esc(e.note || "")}</td><td class="num">${eur(e.amount)}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">Keine markiert.</p>'}
    <p class="small muted">Bitte prüfen: Erhaltungsaufwand (sofort abziehbar) oder Herstellungskosten/anschaffungsnaher Aufwand (AfA).</p>
    <h2 style="margin-top:18px">5. Nebenkostenabrechnungen</h2>${nks.length ? nks.map((st) => { const r = C.nkAbrechnung(state, st);
      return `<h3>${esc(byId("objects", st.objectId)?.name)} · ${d(st.from)}–${d(st.to)}</h3><table><thead><tr><th>Mieter</th><th class="num">Kosten</th><th class="num">Vorauszahlung</th><th class="num">Ergebnis</th></tr></thead><tbody>${r.contracts.map((c) => `<tr><td>${esc(contractLabel(byId("contracts", c.contractId)))}</td><td class="num">${eur(c.total)}</td><td class="num">${eur(c.prepaid)}</td><td class="num">${c.saldo > 0 ? "Nachzahlung " : "Guthaben "}${eur(Math.abs(c.saldo))}</td></tr>`).join("")}<tr><td>Vermieter (Leerstand)</td><td class="num">${eur(r.owner.total)}</td><td></td><td></td></tr></tbody></table>`; }).join("") : '<p class="muted">Keine gespeicherten Abrechnungen.</p>'}`)}
  ${page(`<h2>6. Beleg-Checkliste</h2><table><thead><tr><th>Datum</th><th>Objekt</th><th>Empfänger</th><th>Kategorie</th><th class="num">Betrag</th><th>Beleg</th></tr></thead><tbody>
    ${exps.map((e) => `<tr><td>${d(e.date)}</td><td class="small">${esc(byId("objects", e.objectId)?.name || "–")}</td><td>${esc(e.vendor)}</td><td class="small">${esc(C.EXPENSE_CATEGORIES[e.category]?.label)}</td><td class="num">${eur(e.amount)}</td><td>${e.belegNr ? `✓ ${esc(e.belegNr)}` : '<span class="badge warn">fehlt</span>'}</td></tr>`).join("")}</tbody></table>
    <p class="small muted">Außerdem beilegen: Zinsbescheinigungen der Banken, Grundsteuerbescheid, Versicherungsnachweise, Hausgeldabrechnung (WEG), Plattform-Jahresberichte (Airbnb/Booking).</p>
    <h2 style="margin-top:18px">7. Offene Fragen</h2>${pts.length ? `<ul style="margin-left:20px">${pts.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="muted">Keine.</p>'}`)}`;
}

function viewSettings() {
  const s = state.settings;
  const skr = s.skr === "04" ? "04" : "03";
  const acc = C.accountsFor(s);
  const accLabels = { bank: "Bank", kasse: "Kasse", steuerfrei: "Mieterlöse steuerfrei (§ 4 Nr. 12)", kleinunternehmer: "Erlöse Kleinunternehmer (§ 19)", erl7: "Erlöse 7 % (Ferienwohnung)", erl19: "Erlöse 19 %", durchlaufend: "Durchlaufende Posten (Kurtaxe)", sonstErtrag: "Sonstige Erträge" };
  const rules = Object.entries(state.rules || {});
  return head("Einstellungen") + `
    ${isCloud() ? `<div class="card"><h2>🔗 Verbindungen</h2>${smoobuBox()}<p class="small muted" style="margin-top:6px">Bank verbinden: unter „Konto & Zahlungen“.</p></div>` : ""}
    <form class="card" data-form="owner"><h2>Vermieter / Rechnungssteller</h2><div class="fgrid">
      ${[["ownerName", "Name / Firma"], ["ownerStreet", "Straße"], ["ownerZip", "PLZ"], ["ownerCity", "Ort"], ["ownerEmail", "E-Mail"], ["ownerPhone", "Telefon"], ["taxNumber", "Steuernummer"], ["vatId", "USt-IdNr. (falls vorhanden)"], ["invoiceBank", "Bank (für Rechnungen)"], ["invoiceIban", "IBAN (für Rechnungen)"], ["invoiceBic", "BIC"]].map(([k, l]) => `<label class="f"><span>${l}</span><input name="${k}" value="${esc(s[k] || "")}"></label>`).join("")}
    </div><button class="btn primary">Speichern</button></form>
    <form class="card" data-form="invoice"><h2>Rechnungen & Ferienwohnung</h2><div class="fgrid">
      <label class="f"><span>Nummernkreis ({JJJJ} = Jahr)</span><input name="invoicePrefix" value="${esc(s.invoicePrefix)}"></label>
      <label class="f"><span>Letzte vergebene Nr. ${new Date().getFullYear()}</span><input type="number" name="counter" value="${(s.invoiceCounters || {})[new Date().getFullYear()] || 0}"></label>
      <label class="f"><span>Zahlungsziel (Tage)</span><input type="number" name="paymentTermDays" value="${esc(s.paymentTermDays)}"></label>
      <label class="f"><span>Standard Kurtaxe / Pers. & Nacht (€)</span><input name="defaultKurtaxe" value="${C.fmtNum(s.defaultKurtaxe || 0)}"></label>
      <label class="f"><span>Standard Endreinigung (€)</span><input name="defaultCleaning" value="${C.fmtNum(s.defaultCleaning || 0)}"></label>
      <label class="f"><span>Fußtext</span><input name="invoiceFooter" value="${esc(s.invoiceFooter || "")}"></label>
      <label class="f inline full"><input type="checkbox" name="kleinunternehmer" ${s.kleinunternehmer ? "checked" : ""}> Kleinunternehmer nach § 19 UStG (keine USt auf Rechnungen)</label>
    </div><button class="btn primary">Speichern</button></form>
    <form class="card" data-form="datev"><h2>DATEV & Kontenrahmen</h2><div class="fgrid">
      <label class="f"><span>Kontenrahmen</span><select name="skr">${opt([["03", "SKR 03"], ["04", "SKR 04"]], skr)}</select></label>
      <label class="f"><span>Sachkontenlänge</span><input type="number" name="datevKontenlaenge" value="${esc(s.datevKontenlaenge || 4)}"></label>
      <label class="f"><span>Steuerberater / Kanzlei</span><input name="taxAdvisorName" value="${esc(s.taxAdvisorName || "")}" placeholder="z. B. Kanzlei Müller"></label>
      <label class="f"><span>E-Mail des Steuerberaters (für den Monatsbericht)</span><input name="taxAdvisorEmail" type="email" value="${esc(s.taxAdvisorEmail || "")}"></label>
      <label class="f"><span>Beraternummer</span><input name="datevBerater" value="${esc(s.datevBerater || "")}"></label>
      <label class="f"><span>Mandantennummer</span><input name="datevMandant" value="${esc(s.datevMandant || "")}"></label>
      <label class="f"><span>Mietabgleich (Soll/Ist) ab Monat</span><input type="month" name="sollStart" value="${esc(s.sollStart || "")}"></label>
      <label class="f"><span>Automatisch zuordnen ab Sicherheit (%)</span><input type="number" name="autoAssignScore" value="${esc(s.autoAssignScore || 80)}"></label>
    </div>
    <details><summary>Konten anpassen (SKR ${skr}) – Vorschläge, mit Steuerberater abstimmen</summary><div class="fgrid" style="margin-top:10px">
      ${Object.entries(accLabels).map(([k, l]) => `<label class="f"><span>${l}</span><input name="acc_${k}" value="${esc(acc[k])}"></label>`).join("")}
      ${Object.entries(C.EXPENSE_CATEGORIES).filter(([k]) => k !== "privat").map(([k, v]) => `<label class="f"><span>${esc(v.label)}</span><input name="exp_${k}" value="${esc(C.expenseAccount(s, k) || "")}"></label>`).join("")}
    </div></details><br><button class="btn primary">Speichern</button></form>
    <div class="card"><h2>Gelernte Zuordnungsregeln (${rules.length})</h2>${rules.length ? `<table>${rules.map(([k, r]) => `<tr><td class="small">${esc(k.replace(/^(iban|name):/, ""))}</td><td class="small">${esc(suggestionLabel({ ...r, period: ui.month }))}</td><td>${btn("delRule", "✕", "sm link", k)}</td></tr>`).join("")}</table>` : '<p class="muted">Regeln entstehen beim Zuordnen von Bankumsätzen („Regel merken“).</p>'}</div>
    <div class="card"><h2>🔄 Synchronisation (Bank, Smoobu, Kalender)</h2>
      <p class="small muted" style="margin-bottom:8px">Die App ruft beim Öffnen und alle 15 Minuten automatisch neue Bankumsätze und Buchungen ab. ${isCloud() ? "Im Cloud-Modus ist der Zugriff über deine Anmeldung geschützt." : "Im lokalen Modus schützt ein Sync-Schlüssel die Server-Funktionen: denselben Wert in Netlify als IMMO_SYNC_TOKEN setzen."}</p>
      ${isCloud() ? "" : `<label class="f"><span>Sync-Schlüssel (IMMO_SYNC_TOKEN)</span><input type="password" data-change="syncToken" value="${getSyncToken() ? "••••••••" : ""}" style="max-width:340px" autocomplete="off"></label>`}
      <div class="small">Letzter Abruf: ${syncStatus().lastRun ? new Date(syncStatus().lastRun).toLocaleString("de-DE") : "noch nie"} ${btn("syncNow", "Jetzt abrufen", "sm")}</div></div>
    ${viewPrivacyCard()}
    <div class="card"><h2>✨ KI-Assistent (Claude)</h2>
      <p class="small muted" style="margin-bottom:8px">Für Belegerkennung, Fragen an deine Daten und Briefentwürfe. Schlüssel unter console.anthropic.com → API Keys erstellen; Kosten nach Nutzung (meist wenige Cent pro Anfrage). Der Schlüssel wird nur auf diesem Gerät gespeichert und ist nicht Teil der Datensicherung. Beim Nutzen der KI werden die betroffenen Daten an Anthropic übertragen.</p>
      <div class="inline"><input type="password" placeholder="sk-ant-…" value="${K.hasKey() ? "••••••••••••" : ""}" data-change="kiKey" style="max-width:340px" autocomplete="off"> ${K.hasKey() ? '<span class="badge ok">aktiv</span>' : '<span class="badge grey">nicht eingerichtet</span>'}</div></div>
    ${!isCloud() ? `<div class="card"><h2>👥 Gemeinsam verwalten (Team)</h2><p class="small">Mit Ehepartner, Mitarbeitern oder Steuerberater an denselben Daten arbeiten – jede Person mit eigenem Zugang und eigener Rolle (Bearbeiten / Nur lesen). Das ist im <b>Konto-Modus</b> (Anmeldung, Daten sicher online gespeichert) möglich; im lokalen Modus liegen die Daten nur in diesem Browser. Vorhandene lokale Daten werden bei der ersten Anmeldung übernommen.</p></div>` : ""}
    <div class="card"><h2>Datensicherung</h2>
      <p class="muted" style="margin-bottom:10px">Alle Daten liegen nur in diesem Browser. Sichere sie regelmäßig als Datei (z. B. in iCloud/Google Drive) – damit kannst du sie auch auf ein anderes Gerät übertragen.</p>
      <div class="toolbar">${btn("backup", "⬇ Sicherung herunterladen", "primary")}${btn("backupFull", "⬇ Sicherung inkl. Belege")}<label class="btn">⬆ Sicherung einspielen<input type="file" accept=".json" data-change="restore" hidden></label>${btn("loadDemo", "Demo-Daten laden")}${btn("reset", "Alle Daten löschen", "danger")}</div></div>`;
}

// ---------------------------------------------------------------- Belege & Dokumente

const DOC_KINDS = { beleg: "Rechnung / Beleg", ausgangsrechnung: "Ausgangsrechnung (an Gäste/Firmen)", bescheid: "Bescheid (Grundsteuer, Abgaben)", abrechnung: "Versorger-/Jahresabrechnung", vertrag: "Mietvertrag", nachtrag: "Nachtrag / Mieterhöhung / Vereinbarung", protokoll: "Übergabeprotokoll", kaution: "Kaution (Nachweis, Kautionskonto)", selbstauskunft: "Mieterselbstauskunft / Bonität", wohnungsgeber: "Wohnungsgeberbestätigung", kuendigung: "Kündigung", korrespondenz: "Schriftverkehr", foto: "Fotos / Mängel", zaehler: "Zählerstand / Foto", zinsbescheinigung: "Zinsbescheinigung (Darlehen)", steuerbescheid: "Steuerbescheid", sonstiges: "Sonstiges" };
const KI_DOC_KIND = { rechnung: "beleg", bescheid: "bescheid", abrechnung: "abrechnung", vertrag: "vertrag", zaehlerstand: "zaehler", kontoauszug: "sonstiges", sonstiges: "sonstiges" };

async function addFiles(fileList, { scan = false, expenseId = null, meta = null, objectId = "", quiet = false } = {}) {
  if (isCloud() && !canWrite()) { paywall(); return []; }
  const files = [...fileList];
  if (!files.length) return [];
  const added = [];
  for (const file of files) {
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (!isPdf && !file.type.startsWith("image/")) { toast(`${file.name}: nur Fotos und PDFs möglich`); continue; }
      if (file.size > 25 * 1024 * 1024) { toast(`${file.name} ist größer als 25 MB`); continue; }
      const id = C.uid("d_");
      let blob = file, thumb = "", type = isPdf ? "application/pdf" : file.type;
      if (!isPdf) { const r = await F.prepareImage(file, scan); blob = r.blob; thumb = r.thumb; type = "image/jpeg"; }
      await putDocBlob(id, blob);
      const doc = { id, name: file.name || `Scan ${d(today())}`, type, size: blob.size, thumb, created: new Date().toISOString(), kind: "beleg", objectId: objectId || "", contractId: "", expenseId, status: expenseId ? "verarbeitet" : "neu", note: "", ki: null,
        ordner: C.guessFolder(file.name, file.webkitRelativePath, file.relPath), source: file.webkitRelativePath || file.relPath || "" };
      if (meta) { Object.assign(doc, meta, { status: "verarbeitet" }); if (!file.name || /^image\.|^IMG_|^scan/i.test(file.name)) doc.name = `${DOC_KINDS[meta.kind] || "Dokument"} ${d(today())}`; }
      state.documents.push(doc);
      if (expenseId) { const e = byId("expenses", expenseId); if (e) e.fileIds = [...(e.fileIds || []), id]; }
      added.push(doc);
    } catch (err) { if (quiet) console.warn(file.name, err); else alert(`${file.name}: ${err.message}`); }
  }
  commit(`${added.length} Datei(en) gespeichert`);
  if (!expenseId && !meta && ui.autoKi && K.hasKey()) for (const doc of added) await kiReadDoc(doc.id);
  if (meta?.kind === "vertrag" && added.length && K.hasKey() && confirm("Mietvertrag gespeichert. Soll die KI die Vertragsdaten jetzt auslesen?")) await leaseRead(`${added[0].id}|${meta.contractId}`);
  return added;
}

async function openDoc(id) {
  const blob = await getDocBlob(id);
  if (!blob) return toast("Datei nicht gefunden (anderes Gerät?)");
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Lädt Bilder aus IndexedDB in <img data-doc="…"> (Druckansichten)
async function hydrateDocImages() {
  for (const img of document.querySelectorAll("img[data-doc]")) {
    const blob = await getDocBlob(img.dataset.doc).catch(() => null);
    if (blob) img.src = URL.createObjectURL(blob);
  }
}

function guessObject(hint) {
  const n = C.normalize(hint);
  if (!n) return "";
  let best = "", score = 0;
  for (const o of state.objects) {
    const words = C.normalize(`${o.name} ${o.street} ${o.city}`).split(" ").filter((w) => w.length > 2);
    const s = words.filter((w) => n.includes(w)).length;
    if (s > score) { score = s; best = o.id; }
  }
  return best;
}

async function kiReadDoc(id, quiet = false) {
  const doc = byId("documents", id);
  if (!K.hasKey()) { toast("Für die KI-Erkennung zuerst unter Einstellungen den API-Schlüssel eintragen."); location.hash = "#/einstellungen"; return; }
  const blob = await getDocBlob(id);
  if (!blob) return toast("Datei nicht gefunden");
  ui.kiBusy = { ...(ui.kiBusy || {}), [id]: true }; render();
  try {
    const r = await K.readReceipt({ base64: await F.blobToBase64(blob), mediaType: doc.type, objects: state.objects.map((o) => `${o.name} (${o.street}, ${o.city})`) });
    doc.ki = r;
    doc.kind = KI_DOC_KIND[r.doc_type] || doc.kind;
    doc.objectId = doc.objectId || guessObject(r.object_hint);
    doc.ordner = C.DOC_FOLDERS[r.ordner] && r.ordner !== "sonstiges" ? r.ordner : C.guessFolder(r.vendor, r.summary, doc.name);
    if (r.vendor) doc.name = `${r.vendor}${r.date ? " " + d(r.date) : ""}`;
    persist();
    if (!quiet) toast(`Ausgelesen: ${r.vendor} · ${eur(Math.round(r.amount * 100))} (Sicherheit ${r.confidence})`);
    return true;
  } catch (e) {
    if (quiet) { doc.kiError = K.friendlyError(e); return false; }
    alert("KI-Erkennung fehlgeschlagen: " + K.friendlyError(e));
  } finally {
    delete ui.kiBusy[id]; render();
  }
}

// Beleg → Ausgabe: neu anlegen, an vorhandene Ausgabe hängen oder mit Bankumsatz verknüpfen
function bookDoc(id) {
  const doc = byId("documents", id);
  const k = doc.ki || {};
  const amount = Math.abs(Math.round((k.amount || 0) * 100));
  const date = k.date || today();
  const near = (iso) => Math.abs(new Date(iso) - new Date(date)) <= 75 * 86400000;
  const expC = state.expenses.filter((e) => e.amount === amount && amount && near(e.date) && !(e.fileIds || []).length);
  const txC = state.transactions.filter((t) => !t.link && t.amount === -amount && amount && near(t.date));
  const linkOpts = [["neu", "Neue Ausgabe anlegen"], ...expC.map((e) => [`e:${e.id}`, `An vorhandene Ausgabe hängen: ${d(e.date)} ${e.vendor} ${eur(e.amount)}`]), ...txC.map((t) => [`t:${t.id}`, `Mit Bankumsatz verknüpfen: ${d(t.date)} ${t.name} ${eur(t.amount)}`])];
  const pos = k.positions || [];
  const umlGroups = {};
  for (const x of pos.filter((x) => x.umlagefaehig && x.betrkv !== "keine")) umlGroups[x.betrkv] = (umlGroups[x.betrkv] || 0) + Math.round(x.amount * 100);
  const canSplit = Object.keys(umlGroups).length > 1 || (Object.keys(umlGroups).length === 1 && pos.some((x) => !x.umlagefaehig));
  const readings = k.meter_readings || [];
  const spec = [{ k: "linkTo", l: "Buchung", t: "select", opts: linkOpts, full: 1 }, ...SPEC.expense,
    ...(canSplit ? [{ k: "split", l: "Rechnung aufteilen: je Betriebskostenart eine Buchung + Rest (nicht umlagefähig) separat", t: "checkbox", full: 1 }] : []),
    ...(readings.length ? [{ k: "meterUnit", l: `Erkannte Zählerstände (${readings.map((r) => `${C.METER_TYPES[r.meter_type] || r.meter_type}: ${String(r.value).replace(".", ",")}`).join(", ")}) speichern für Einheit`, t: "select", opts: () => [["", "– nicht speichern –"], ...unitOpts((u) => u.type !== "ferienwohnung")], full: 1 }] : [])];
  formDialog({
    title: "Beleg als Ausgabe buchen", spec, wide: true,
    data: { linkTo: linkOpts[1]?.[0] || "neu", date, amount, split: canSplit, umlageAmount: !doc.ki ? undefined : !k.umlagefaehig ? 0 : k.umlage_betrag && Math.round(k.umlage_betrag * 100) !== amount ? Math.round(k.umlage_betrag * 100) : undefined, category: k.category || "sonstiges", betrkv: k.betrkv && k.betrkv !== "keine" ? k.betrkv : "", objectId: doc.objectId || guessObject(k.object_hint), vendor: k.vendor || "", belegNr: k.invoice_number || "", note: [k.summary, k.consumption && `Verbrauch: ${k.consumption}`, k.period_from && `Zeitraum ${d(k.period_from)}–${d(k.period_to)}`].filter(Boolean).join("\n") },
    intro: `<div class="inline" style="align-items:flex-start;margin-bottom:10px">${doc.thumb ? `<img src="${doc.thumb}" style="width:90px;border-radius:6px;border:1px solid var(--line)">` : '<span class="big">📄</span>'}
      <div class="small">${doc.ki ? `KI-Vorschlag (Sicherheit: <b>${esc(k.confidence)}</b>) – bitte prüfen.${k.umlagefaehig ? ' <span class="badge ok">umlagefähig</span>' : ' <span class="badge grey">nicht umlagefähig</span>'}` : "Bitte Daten vom Beleg eintragen."}
      ${txC.length || expC.length ? `<br><b>Tipp:</b> Es gibt einen passenden Bankumsatz/eine Ausgabe – verknüpfen statt doppelt buchen.` : ""}</div></div>
      ${pos.length > 1 || (pos.length === 1 && !pos[0].umlagefaehig && k.umlagefaehig) ? `<table class="positions" style="margin-bottom:10px"><thead><tr><th>Position</th><th class="num">Betrag</th><th>Umlage</th><th>Begründung</th></tr></thead><tbody>${pos.map((x) => `<tr><td>${esc(x.text)}</td><td class="num">${eur(Math.round(x.amount * 100))}</td><td>${x.umlagefaehig ? `<span class="badge ok">${esc(C.BETRKV.find((b) => b[0] === x.betrkv)?.[1] || "ja")}</span>` : '<span class="badge grey">nein</span>'}</td><td class="small muted">${esc(x.reason)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${k.hinweis_vermieter ? `<div class="note small">💡 ${esc(k.hinweis_vermieter)}</div>` : ""}`,
    onSave: (v) => {
      const { linkTo, split, meterUnit, ...vals } = v;
      if (meterUnit) state.meterReadings.push(...readings.map((r) => ({ id: C.uid("m_"), unitId: meterUnit, contractId: activeContract(meterUnit, C.monthKey(r.date || vals.date))?.id || "", type: r.meter_type, number: r.meter_number, date: r.date || vals.date, value: r.value, reason: "ablesung" })));
      if (split && linkTo === "neu") {
        const catOf = (bk) => B.CATALOG.find((c) => c.id === bk)?.cats?.[0] || vals.category;
        const parts = Object.entries(umlGroups).map(([bk, amt]) => ({ ...vals, id: C.uid("e_"), txId: null, amount: amt, umlageAmount: amt, betrkv: bk, category: catOf(bk), note: `${vals.note}\n(Teil der Rechnung ${vals.belegNr || ""})` }));
        const rest = Math.abs(vals.amount) - sum(parts, (x) => x.amount);
        if (rest > 0) parts.push({ ...vals, id: C.uid("e_"), txId: null, amount: rest, umlageAmount: 0, betrkv: "", category: ["grundsteuer", "versorgung", "muell", "reinigung", "versicherung"].includes(vals.category) ? "erhaltung" : vals.category, note: `${vals.note}\n(nicht umlagefähiger Rest)` });
        for (const x of parts) { x.fileIds = [doc.id]; state.expenses.push(x); }
        Object.assign(doc, { expenseId: parts[0].id, status: "verarbeitet", objectId: vals.objectId || doc.objectId });
        return commit(`Beleg in ${parts.length} Buchungen aufgeteilt`);
      }
      let e;
      if (linkTo.startsWith("e:")) { e = byId("expenses", linkTo.slice(2)); Object.assign(e, { betrkv: vals.betrkv || e.betrkv, umlageAmount: vals.umlageAmount, belegNr: vals.belegNr || e.belegNr, objectId: vals.objectId || e.objectId, category: vals.category }); }
      else {
        e = { id: C.uid("e_"), txId: null, ...vals, amount: Math.abs(vals.amount) };
        if (linkTo.startsWith("t:")) { const tx = byId("transactions", linkTo.slice(2)); e.txId = tx.id; e.date = tx.date; e.amount = -tx.amount; tx.link = { type: "expense", id: e.id }; }
        state.expenses.push(e);
      }
      e.fileIds = [...new Set([...(e.fileIds || []), doc.id])];
      Object.assign(doc, { expenseId: e.id, status: "verarbeitet", objectId: e.objectId || doc.objectId });
      commit("Beleg gebucht");
    },
  });
}

function editDoc(id) {
  const doc = byId("documents", id);
  formDialog({
    title: "Dokument bearbeiten", data: doc,
    spec: [
      { k: "name", l: "Bezeichnung", req: 1, full: 1 },
      { k: "kind", l: "Art", t: "select", opts: Object.entries(DOC_KINDS) },
      { k: "ordner", l: "Ordner (Ablage)", t: "select", opts: Object.entries(C.DOC_FOLDERS).map(([k, [l, ic]]) => [k, `${ic} ${l}`]) },
      { k: "objectId", l: "Objekt", t: "select", opts: () => objectOpts() },
      { k: "contractId", l: "Mietvertrag / Mieter", t: "select", opts: () => [["", "–"], ...contractOpts()], full: 1 },
      { k: "status", l: "Status", t: "select", opts: [["neu", "Eingang (unbearbeitet)"], ["verarbeitet", "erledigt / abgelegt"]] },
      { k: "note", l: "Notiz", t: "textarea" },
    ],
    onSave: (v) => { Object.assign(doc, v, { ordnerManuell: v.ordner !== folderOf(doc) || doc.ordnerManuell }); commit("Gespeichert"); },
    onDelete: async () => {
      for (const e of state.expenses) if ((e.fileIds || []).includes(id)) e.fileIds = e.fileIds.filter((x) => x !== id);
      state.documents = state.documents.filter((x) => x.id !== id);
      await deleteDocBlob(id);
      commit("Dokument gelöscht");
    },
  });
}

function docCard(doc) {
  const busy = ui.kiBusy?.[doc.id];
  const e = byId("expenses", doc.expenseId);
  return `<div class="doc">
    <div class="thumb" data-act="openDoc" data-id="${doc.id}">${doc.thumb ? `<img src="${doc.thumb}" alt="">` : `<span>PDF</span>`}</div>
    <div class="meta"><b>${esc(doc.name)}</b>
      <div class="small muted">${esc(DOC_KINDS[doc.kind] || "")}${doc.objectId ? " · " + esc(byId("objects", doc.objectId)?.name || "") : ""}${doc.contractId ? " · " + esc(tenantNames(byId("contracts", doc.contractId))) : ""}</div>
      ${doc.ki && !e ? `<div class="small">✨ ${esc(doc.ki.vendor)} · ${eur(Math.round(doc.ki.amount * 100))}${doc.ki.date ? " · " + d(doc.ki.date) : ""}</div>` : ""}
      ${e ? `<div class="small"><span class="badge ok">gebucht</span> ${d(e.date)} ${eur(e.amount)}</div>` : doc.status === "neu" ? '<span class="badge warn">Eingang</span>' : ""}
      <div class="toolbar" style="margin-top:6px">
        ${!e && ["beleg", "bescheid", "abrechnung"].includes(doc.kind) ? `${btn("kiDoc", busy ? "⏳ liest…" : "✨ KI auslesen", "sm", doc.id)}${btn("bookDoc", "Buchen", "sm primary", doc.id)}` : ""}
        ${btn("editDoc", "✎", "sm", doc.id)}
      </div></div></div>`;
}

// ---------------------------------------------------------------- Ablage je Objekt: Ordner reinwerfen, App sortiert
const KIND_FOLDER = { vertrag: "mieter", nachtrag: "mieter", protokoll: "mieter", kaution: "mieter", selbstauskunft: "mieter", wohnungsgeber: "mieter", kuendigung: "mieter", zinsbescheinigung: "bank", steuerbescheid: "steuer", ausgangsrechnung: "fewo" };
function folderOf(doc) {
  if (doc.ordner && doc.ordner !== "sonstiges") return doc.ordner;
  const g = C.guessFolder(doc.name, doc.ki?.vendor, doc.ki?.summary, doc.source);
  return g !== "sonstiges" ? g : KIND_FOLDER[doc.kind] || "sonstiges";
}
const docYear = (doc) => (doc.ki?.date || doc.ki?.period_to || "").slice(0, 4) || (`${doc.name} ${doc.source || ""}`.match(/\b(19[89]\d|20[0-4]\d)\b/) || [])[1] || (doc.created || "").slice(0, 4) || "ohne Jahr";

// Ganzen Ordner/viele Dateien einem Objekt zuordnen und (mit KI-Schlüssel) einzeln auslesen und einsortieren
async function bulkImport(files, objectId) {
  const list = [...files].filter((f) => !/^\./.test(f.name));
  const ok = list.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name) || (f.type || "").startsWith("image/") || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
  const skipped = list.length - ok.length;
  if (!ok.length) return toast(skipped ? `Keine Fotos oder PDFs gefunden (${skipped} andere Dateien übersprungen).` : "Keine Dateien gefunden.");
  ui.bulk = { total: ok.length, done: 0, objectId, phase: "speichern", skipped }; render();
  const added = await addFiles(ok, { objectId, quiet: true });
  if (K.hasKey()) {
    ui.bulk = { ...ui.bulk, phase: "lesen", done: 0, total: added.length }; render();
    let fail = 0;
    for (const doc of added) { if (!(await kiReadDoc(doc.id, true))) fail++; ui.bulk.done++; render(); }
    ui.bulk = null; commit(`${added.length} Dateien einsortiert${fail ? ` – ${fail} konnten nicht gelesen werden (nach Dateiname sortiert)` : ""}${skipped ? ` · ${skipped} andere Dateien übersprungen` : ""}`);
  } else {
    ui.bulk = null; commit(`${added.length} Dateien nach Dateinamen einsortiert${skipped ? ` · ${skipped} andere Dateien übersprungen` : ""}. Mit KI-Schlüssel liest die App auch den Inhalt.`);
  }
}

// Ordner aus Drag & Drop rekursiv auslesen
async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); f.relPath = path + f.name; out.push(f); return; }
    const reader = entry.createReader();
    let batch;
    do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const e of batch) await walk(e, `${path}${entry.name}/`); } while (batch.length);
  };
  for (const e of entries) await walk(e, "");
  return out;
}

function viewAblage(objectId) {
  if (!state.objects.length) return head("Ablage") + `<div class="card empty"><div class="big">📂</div>Lege zuerst unter „Häuser & Wohnungen“ ein Objekt an.</div>`;
  const oid = byId("objects", objectId) ? objectId : ui.ablageObj && byId("objects", ui.ablageObj) ? ui.ablageObj : state.objects[0].id;
  ui.ablageObj = oid;
  const o = byId("objects", oid);
  const docs = state.documents.filter((x) => x.objectId === oid);
  const groups = {};
  for (const doc of docs) (groups[folderOf(doc)] ||= []).push(doc);
  const open = ui.ablageFolder && groups[ui.ablageFolder] ? ui.ablageFolder : null;
  const b = ui.bulk;
  const unassigned = state.documents.filter((x) => !x.objectId).length;
  const tiles = Object.entries(C.DOC_FOLDERS).filter(([k]) => groups[k]).map(([k, [l, ic]]) => `<button class="qtile ${open === k ? "on" : ""}" data-act="ablageFolder" data-id="${k}"><span>${ic}</span>${esc(l)}<small class="muted">${groups[k].length} Datei${groups[k].length === 1 ? "" : "en"}</small></button>`).join("");
  let list = "";
  if (open) {
    const byYear = {};
    for (const doc of groups[open]) (byYear[docYear(doc)] ||= []).push(doc);
    list = `<div class="card"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">${C.DOC_FOLDERS[open][1]} ${esc(C.DOC_FOLDERS[open][0])}</h2>${btn("ablageFolder", "✕ schließen", "sm", "")}</div>
      ${Object.keys(byYear).sort().reverse().map((y) => `<h3>${esc(y)}</h3><div class="docs">${byYear[y].sort((a, c) => ((a.ki?.date || a.created) < (c.ki?.date || c.created) ? 1 : -1)).map(docCard).join("")}</div>`).join("")}
      <p class="small muted" style="margin-top:8px">Falsch einsortiert? Bei der Datei auf ✎ tippen und den Ordner ändern.</p></div>`;
  }
  return head(`📂 Ablage`, "Ganzen Ordner reinwerfen – die App sortiert nach Schornsteinfeger, Gas, Strom, Versicherung …",
    `<select data-change="ablageObj" style="width:auto">${opt(state.objects.map((x) => [x.id, x.name]), oid)}</select>`) + `
    <div class="card noprint drop" data-drop="ablage">
      <div class="toolbar">
        <label class="btn primary">📂 Ganzen Ordner wählen<input type="file" webkitdirectory directory multiple data-change="ablageUpload" hidden></label>
        <label class="btn">📄 Dateien wählen<input type="file" accept="image/*,application/pdf" multiple data-change="ablageUpload" hidden></label>
        <label class="btn">📷 Foto<input type="file" accept="image/*" capture="environment" data-change="ablageUpload" hidden></label>
      </div>
      <p class="small muted" style="margin-top:8px">Für <b>${esc(o.name)}</b>: Ordner oder Dateien hierher ziehen oder auswählen – auch durcheinander. Unterordner werden mitgenommen, nur PDFs und Fotos werden übernommen.
      ${K.hasKey() ? "Die KI liest jede Datei und legt sie in den passenden Ordner (kostet je Datei ein paar Cent über deinen KI-Schlüssel)." : 'Ohne KI-Schlüssel wird nach dem Dateinamen sortiert. Mit Schlüssel (<a href="#/einstellungen">Einstellungen → KI</a>) liest die App auch den Inhalt.'}</p>
      ${b ? `<div class="note"><b>${b.phase === "lesen" ? `✨ Lese und sortiere … ${b.done} von ${b.total}` : `Speichere ${b.total} Dateien …`}</b><div class="bar"><i style="width:${b.total ? Math.round((100 * b.done) / b.total) : 0}%"></i></div><span class="small muted">Bitte die Seite offen lassen.</span></div>` : ""}
    </div>
    ${docs.length ? `<div class="qgrid">${tiles}</div>` : `<div class="card empty-start"><div class="big">📂</div><b>Noch keine Dateien für ${esc(o.name)}</b><p class="muted">Wirf z. B. den Ordner „Haus Unterlagen“ von deinem Computer hier hinein.</p></div>`}
    ${list}
    ${unassigned ? `<p class="small muted">${unassigned} Datei(en) ohne Objekt findest du unter <a href="#/dokumente">Belege & Dokumente</a>.</p>` : ""}`;
}

function viewDocs() {
  const f = ui.docFilter || "neu";
  let docs = [...state.documents].sort((a, b) => (a.created < b.created ? 1 : -1));
  if (f === "neu") docs = docs.filter((x) => x.status === "neu");
  else if (f !== "alle") docs = docs.filter((x) => x.kind === f);
  const counts = { neu: state.documents.filter((x) => x.status === "neu").length };
  return head("Belege & Dokumente", "Fotografieren, scannen oder PDFs hochladen – die KI liest Belege aus und bucht sie", "") + `
    <div class="card noprint drop" data-drop="1">
      <div class="toolbar">
        <label class="btn primary">📷 Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-change="docUpload" hidden></label>
        <label class="btn">🖨 Dokument scannen<input type="file" accept="image/*" capture="environment" data-change="docScan" hidden></label>
        <label class="btn">📄 PDFs / Bilder wählen<input type="file" accept="image/*,application/pdf" multiple data-change="docUpload" hidden></label>
        <label class="small inline"><input type="checkbox" data-change="autoKi" ${ui.autoKi ? "checked" : ""}> nach dem Hochladen automatisch mit KI auslesen</label>
      </div>
      <p class="small muted" style="margin-top:8px">Dateien hierher ziehen geht auch. „Scannen“ macht aus dem Handyfoto ein kontrastreiches Schwarz-Weiß-Dokument. Alles wird nur auf diesem Gerät gespeichert.${K.hasKey() ? "" : ' Für die automatische Erkennung unter <a href="#/einstellungen">Einstellungen</a> den KI-Schlüssel eintragen.'}</p>
    </div>
    <div class="card">
      <div class="tabs">${[["neu", `Eingang (${counts.neu})`], ["alle", "Alle"], ...Object.entries(DOC_KINDS)].map(([k, l]) => `<button data-act="docFilter" data-id="${k}" class="${f === k ? "active" : ""}">${esc(l.split(" (")[0].split(" /")[0])}</button>`).join("")}</div>
      ${docs.length ? `<div class="docs">${docs.map(docCard).join("")}</div>` : `<p class="muted">${f === "neu" ? "Keine unbearbeiteten Dokumente. 🎉" : "Keine Dokumente."}</p>`}
    </div>`;
}

// ---------------------------------------------------------------- Briefe an Mieter

function letterFacts(contractId) {
  const c = byId("contracts", contractId);
  const u = byId("units", c?.unitId), s = state.settings;
  const key = C.monthKey(today());
  const back = c ? C.sollIst(state, C.addMonths(key, -12), key).filter((r) => r.contractId === c.id && r.diff < 0) : [];
  const lastNk = (state.nkStatements || []).filter((x) => x.objectId === u?.objectId).sort((a, b) => (a.to < b.to ? 1 : -1))[0];
  const nkRes = lastNk ? C.nkAbrechnung(state, lastNk).contracts.find((x) => x.contractId === contractId) : null;
  const r = c ? C.rentForMonth(c, key) : null;
  return {
    vermieter: { name: s.ownerName, anschrift: [s.ownerStreet, [s.ownerZip, s.ownerCity].filter(Boolean).join(" ")].filter(Boolean).join(", "), iban: s.invoiceIban, telefon: s.ownerPhone, email: s.ownerEmail },
    mieter: c ? tenantNames(c) : "", wohnung: u ? `${u.name}, ${addrOf(u)}` : "", wohnflaeche: u?.area || "",
    mietbeginn: c ? d(c.start) : "", mietende: c?.end ? d(c.end) : "", personen: c?.persons || "",
    miete_aktuell: r ? { kalt: eur(r.kalt), nebenkosten: eur(r.nk), zuschlaege: eur(r.extra), gesamt: eur(r.total) } : null,
    kaution: c?.kaution ? eur(c.kaution) : "",
    rueckstaende: back.map((x) => ({ monat: C.fmtMonth(x.key), offen: eur(-x.diff) })), rueckstand_summe: eur(-sum(back, (x) => x.diff)),
    letzte_nk_abrechnung: nkRes ? { zeitraum: `${d(lastNk.from)}–${d(lastNk.to)}`, ergebnis: nkRes.saldo > 0 ? `Nachzahlung ${eur(nkRes.saldo)}` : `Guthaben ${eur(-nkRes.saldo)}`, neue_vorauszahlung: eur(nkRes.newMonthly) } : null,
  };
}

const LETTERS = {
  zahlungserinnerung: ["Zahlungserinnerung", (f) => [`Zahlungserinnerung – ${f.wohnung}`, `${greet(f)}

bei der Durchsicht unserer Unterlagen ist uns aufgefallen, dass folgende Mietzahlungen noch nicht vollständig eingegangen sind:

${f.rueckstaende.map((x) => `- ${x.monat}: ${x.offen}`).join("\n") || "- [Monat]: [Betrag]"}

Offener Betrag insgesamt: ${f.rueckstand_summe}

Sicher handelt es sich nur um ein Versehen. Bitte überweisen Sie den Betrag bis zum ${d(addDays(today(), 14))} auf das Konto ${f.vermieter.iban || "[IBAN]"}. Sollten Sie die Zahlung inzwischen veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Mit freundlichen Grüßen
${f.vermieter.name}`]],
  mahnung: ["Mahnung (2. Stufe)", (f) => [`Mahnung – Mietrückstand ${f.wohnung}`, `${greet(f)}

trotz unserer Zahlungserinnerung ist der folgende Mietrückstand weiterhin offen:

${f.rueckstaende.map((x) => `- ${x.monat}: ${x.offen}`).join("\n") || "- [Monat]: [Betrag]"}

Gesamt: ${f.rueckstand_summe}

Bitte gleichen Sie den Betrag bis spätestens ${d(addDays(today(), 10))} aus. Wir weisen darauf hin, dass ein Rückstand in Höhe von mehr als einer Monatsmiete über zwei aufeinanderfolgende Termine oder in Höhe von zwei Monatsmieten zur fristlosen Kündigung berechtigen kann (§ 543 Abs. 2 Nr. 3 BGB). Wenn Sie in Zahlungsschwierigkeiten sind, sprechen Sie uns bitte an – gemeinsam finden wir eine Lösung, z. B. eine Ratenzahlung.

Mit freundlichen Grüßen
${f.vermieter.name}`]],
  vorauszahlung: ["Anpassung Nebenkosten-Vorauszahlung", (f) => [`Anpassung der Betriebskostenvorauszahlung – ${f.wohnung}`, `${greet(f)}

auf Grundlage der Betriebskostenabrechnung ${f.letzte_nk_abrechnung?.zeitraum || "[Zeitraum]"} (Ergebnis: ${f.letzte_nk_abrechnung?.ergebnis || "[Ergebnis]"}) passen wir die monatliche Vorauszahlung gemäß § 560 Abs. 4 BGB an.

Neue Betriebskostenvorauszahlung: ${f.letzte_nk_abrechnung?.neue_vorauszahlung || "[Betrag]"} monatlich
gültig ab: ${C.fmtMonth(C.addMonths(C.monthKey(today()), 2))}

Ihre Gesamtmiete beträgt damit ab diesem Monat [neue Gesamtmiete]. Bitte passen Sie Ihren Dauerauftrag entsprechend an.

Mit freundlichen Grüßen
${f.vermieter.name}`]],
  ankuendigung: ["Ankündigung Termin (Ablesung, Handwerker)", (f) => [`Ankündigung: [Ablesung / Handwerkertermin] – ${f.wohnung}`, `${greet(f)}

am [Datum] zwischen [Uhrzeit] und [Uhrzeit] findet in Ihrer Wohnung [die Ablesung der Zähler / folgende Arbeit: …] statt. Bitte ermöglichen Sie den Zugang zur Wohnung oder hinterlegen Sie einen Schlüssel. Passt Ihnen der Termin nicht, melden Sie sich bitte unter ${f.vermieter.telefon || "[Telefon]"}.

Vielen Dank für Ihre Mithilfe!

Mit freundlichen Grüßen
${f.vermieter.name}`]],
  mieterhoehung: ["Mieterhöhung (Zustimmungsverlangen § 558 BGB)", (f) => [`Mieterhöhungsverlangen nach § 558 BGB – ${f.wohnung}`, `${greet(f)}

hiermit bitten wir Sie um Zustimmung zur Erhöhung der Nettokaltmiete für die Wohnung ${f.wohnung} (${f.wohnflaeche || "[x]"} m²) von derzeit ${f.miete_aktuell?.kalt || "[Betrag]"} auf [neuer Betrag] monatlich mit Wirkung ab dem [Beginn des dritten Monats nach Zugang].

Begründung: Die neue Miete entspricht der ortsüblichen Vergleichsmiete. Wir beziehen uns auf den [Mietspiegel der Stadt …, Feld …, Spanne … €/m²]. Die Kappungsgrenze (in 3 Jahren max. 20 % bzw. 15 % in Gebieten mit Kappungsgrenzenverordnung) ist eingehalten; die Miete war seit mindestens 15 Monaten unverändert.

Bitte erteilen Sie Ihre Zustimmung bis zum Ablauf des zweiten Kalendermonats nach Zugang dieses Schreibens, z. B. durch Unterschrift auf der beiliegenden Kopie.

Mit freundlichen Grüßen
${f.vermieter.name}`]],
  wohnungsgeber: ["Wohnungsgeberbestätigung (§ 19 BMG)", (f) => [`Wohnungsgeberbestätigung nach § 19 Bundesmeldegesetz`, `Hiermit bestätige ich als Wohnungsgeber den Einzug der folgenden Person(en):

Name(n) der meldepflichtigen Person(en): ${f.mieter}
Anschrift der Wohnung: ${f.wohnung}
Datum des Einzugs: ${f.mietbeginn}

Name und Anschrift des Wohnungsgebers: ${f.vermieter.name}, ${f.vermieter.anschrift}
Der Wohnungsgeber ist zugleich Eigentümer der Wohnung.

Ich bestätige mit meiner Unterschrift den Einzug der oben genannten Person(en) in die bezeichnete Wohnung und dass ich als Wohnungsgeber oder als beauftragte Person diese Bescheinigung ausstellen darf. Es ist verboten, eine Wohnanschrift für eine Anmeldung anzubieten oder zur Verfügung zu stellen, obwohl ein tatsächlicher Bezug der Wohnung weder stattfindet noch beabsichtigt ist (§ 19 Abs. 6 BMG).

${d(today())}, ____________________________
${f.vermieter.name}`]],
  mietbescheinigung: ["Mietbescheinigung", (f) => [`Mietbescheinigung`, `Hiermit bestätigen wir, dass ${f.mieter} seit dem ${f.mietbeginn} die Wohnung ${f.wohnung} (${f.wohnflaeche || "[x]"} m²) von uns gemietet hat${f.mietende ? ` (Mietende ${f.mietende})` : ""}.

Die monatliche Miete beträgt derzeit:
- Nettokaltmiete: ${f.miete_aktuell?.kalt || ""}
- Betriebs-/Heizkostenvorauszahlung: ${f.miete_aktuell?.nebenkosten || ""}
${f.miete_aktuell?.zuschlaege && f.miete_aktuell.zuschlaege !== eur(0) ? `- Zuschläge: ${f.miete_aktuell.zuschlaege}\n` : ""}- Gesamtmiete: ${f.miete_aktuell?.gesamt || ""}

Die Miete wurde bisher [regelmäßig und pünktlich] gezahlt.

${d(today())}

${f.vermieter.name}`]],
  kuendigungsbestaetigung: ["Bestätigung der Kündigung", (f) => [`Bestätigung Ihrer Kündigung – ${f.wohnung}`, `${greet(f)}

wir bestätigen den Eingang Ihrer Kündigung vom [Datum]. Das Mietverhältnis endet damit zum [Datum Mietende].

Für die Wohnungsübergabe schlagen wir den [Datum, Uhrzeit] vor. Bitte geben Sie alle Schlüssel zurück und teilen Sie uns Ihre neue Anschrift sowie Ihre Bankverbindung für die Abrechnung der Kaution (${f.kaution || "[Betrag]"}) mit. Über die Kaution rechnen wir nach Übergabe und Erstellung der nächsten Betriebskostenabrechnung ab.

Mit freundlichen Grüßen
${f.vermieter.name}`]],
  frei: ["Freier Brief", (f) => ["", `${greet(f)}

[Text]

Mit freundlichen Grüßen
${f.vermieter.name}`]],
};
function greet(f) { return f.mieter && !/familie|,| und /i.test(f.mieter) ? `Guten Tag ${f.mieter},` : "Sehr geehrte Damen und Herren,"; }

function viewLetters() {
  const L = ui.letter || (ui.letter = { kind: "zahlungserinnerung", contractId: state.contracts[0]?.id || "", subject: "", body: "", instr: "" });
  if (!L.body && L.contractId !== undefined) { const [s, b] = LETTERS[L.kind][1](letterFacts(L.contractId)); L.subject = s; L.body = b; }
  const archive = [...(state.letters || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  return head("Briefe an Mieter", "Vorlagen, KI-Formulierung, Druck/PDF und Briefarchiv", "") + `
    <div class="card">
      <div class="fgrid">
        <label class="f"><span>Vorlage</span><select data-letter="kind">${opt(Object.entries(LETTERS).map(([k, v]) => [k, v[0]]), L.kind)}</select></label>
        <label class="f"><span>Mieter / Vertrag</span><select data-letter="contractId">${opt([["", "–"], ...contractOpts()], L.contractId)}</select></label>
        <label class="f full"><span>Betreff</span><input data-letter="subject" value="${esc(L.subject)}"></label>
        <label class="f full"><span>Text</span><textarea data-letter="body" style="min-height:320px">${esc(L.body)}</textarea></label>
      </div>
      <p class="small muted">[Platzhalter] in eckigen Klammern vor dem Versand ersetzen. Mieterhöhung und Kündigung bei Unsicherheit von Haus & Grund oder einem Anwalt prüfen lassen.</p>
      <div class="inline" style="margin:10px 0"><input placeholder="✨ KI-Anweisung, z. B. „freundlicher“, „Ratenzahlung 3×200 € anbieten“, „auf Türkisch übersetzen“" data-letter="instr" value="${esc(L.instr || "")}" style="flex:1;min-width:220px">${btn("letterKi", ui.letterBusy ? "⏳ schreibt…" : "✨ Mit KI formulieren", "")}</div>
      <div class="toolbar">${btn("letterReset", "Vorlage neu laden", "")}${btn("letterSave", "Speichern & drucken", "primary")}${btn("letterMail", "✉ Per E-Mail", "")}</div>
    </div>
    <div class="card"><h2>Briefarchiv (${archive.length})</h2>${archive.length ? `<table>${archive.map((l) => `<tr><td class="nowrap">${d(l.date)}</td><td>${esc(l.subject)}<div class="small muted">${esc(contractLabel(byId("contracts", l.contractId)))}</div></td><td class="nowrap"><a class="btn sm" href="#/brief/${l.id}">🖨</a> ${btn("letterDel", "✕", "sm link", l.id)}</td></tr>`).join("")}</table>` : '<p class="muted">Noch keine Briefe gespeichert. Auch NK-Abrechnungen landen hier, wenn du sie archivierst.</p>'}</div>`;
}

function viewLetter(id) {
  const l = (state.letters || []).find((x) => x.id === id);
  if (!l) return head("Brief nicht gefunden");
  const s = state.settings, c = byId("contracts", l.contractId), u = byId("units", c?.unitId);
  const tenants = (c?.tenantIds || []).map((x) => byId("tenants", x)).filter(Boolean);
  const sender = [s.ownerName, s.ownerStreet, [s.ownerZip, s.ownerCity].filter(Boolean).join(" ")].filter(Boolean);
  return `<div class="head noprint"><a href="#/briefe">← Briefe</a><button class="btn primary" onclick="window.print()">Drucken / PDF</button></div>
    <div class="paper">
      <div class="top"><div><div class="sender">${esc(sender.join(" · "))}</div>
        <div><b>${esc(tenants.map((t) => t.name).join(", ") || l.recipient || "")}</b><br>${esc(tenants[0]?.address || (u ? addrOf(u) : ""))}</div></div>
        <div><b>${esc(s.ownerName)}</b><br>${sender.slice(1).map(esc).join("<br>")}${s.ownerPhone ? `<br>Tel. ${esc(s.ownerPhone)}` : ""}${s.ownerEmail ? `<br>${esc(s.ownerEmail)}` : ""}<br><br>${d(l.date)}</div></div>
      ${l.subject ? `<h1 style="font-size:16px">${esc(l.subject)}</h1>` : ""}
      <div style="white-space:pre-wrap;line-height:1.6">${esc(l.body)}</div>
    </div>`;
}

// ---------------------------------------------------------------- KI-Assistent

function buildContext() {
  const key = C.monthKey(today()), y = Number(key.slice(0, 4));
  const si = C.sollIst(state, C.addMonths(key, -11), key);
  const fewo = fewoUnits().map((u) => u.id);
  return {
    vermieter: { name: state.settings.ownerName, kleinunternehmer: state.settings.kleinunternehmer, kontenrahmen: `SKR ${state.settings.skr}` },
    objekte: state.objects.map((o) => ({ name: o.name, adresse: [o.street, o.zip, o.city].filter(Boolean).join(" "), art: C.OBJECT_TYPES[o.type], baujahr: o.year, kaufdatum: o.purchaseDate, gebaeudeanteil: o.buildingShare ? eur(o.buildingShare) : null, afa_satz: o.afaRate, eigentuemer: o.owners || null,
      einheiten: state.units.filter((u) => u.objectId === o.id).map((u) => { const c = activeContract(u.id, key); const r = c ? C.rentForMonth(c, key) : null;
        return { name: u.name, art: C.UNIT_TYPES[u.type], flaeche_m2: u.area, zimmer: u.rooms, mieter: c ? tenantNames(c) : (u.type === "ferienwohnung" ? "Ferienvermietung" : "leer"), mietbeginn: c?.start, mietende: c?.end || null, kalt: r && eur(r.kalt), nk: r && eur(r.nk), gesamt: r && eur(r.total), kaution: c?.kaution ? eur(c.kaution) : null, personen: c?.persons, ausstattung: u.features || null }; }) })),
    mietrueckstaende_12_monate: si.filter((r) => r.diff < 0).map((r) => ({ vertrag: contractLabel(byId("contracts", r.contractId)), monat: r.key, offen: eur(-r.diff) })),
    soll_ist_aktueller_monat: C.sollIst(state, key, key).map((r) => ({ vertrag: contractLabel(byId("contracts", r.contractId)), soll: eur(r.soll), ist: eur(r.ist) })),
    offene_bankumsaetze: state.transactions.filter((t) => !t.link).slice(0, 40).map((t) => ({ datum: t.date, betrag: eur(t.amount), name: t.name, zweck: t.purpose })),
    ausgaben: [y - 1, y].map((yy) => ({ jahr: yy, nach_kategorie: Object.fromEntries(Object.entries(state.expenses.filter((e) => e.date.startsWith(String(yy))).reduce((m, e) => { m[C.EXPENSE_CATEGORIES[e.category]?.label || e.category] = (m[C.EXPENSE_CATEGORIES[e.category]?.label || e.category] || 0) + e.amount; return m; }, {})).map(([k, v]) => [k, eur(v)])) })),
    letzte_ausgaben: [...state.expenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30).map((e) => ({ datum: e.date, betrag: eur(e.amount), empfaenger: e.vendor, kategorie: C.EXPENSE_CATEGORIES[e.category]?.label, objekt: byId("objects", e.objectId)?.name || null, beleg: (e.fileIds || []).length ? "ja" : "nein" })),
    anlage_v: [y - 1, y].map((yy) => ({ jahr: yy, objekte: C.anlageV(state, yy).map((r) => ({ objekt: r.name, einnahmen: eur(r.incomeTotal), werbungskosten: eur(r.costTotal), afa: eur(r.costs.afa), ergebnis: eur(r.result) })) })),
    nebenkostenabrechnungen: (state.nkStatements || []).map((st) => { const r = C.nkAbrechnung(state, st); return { objekt: byId("objects", st.objectId)?.name, zeitraum: `${st.from} bis ${st.to}`, frist: r.deadline, gesamtkosten: eur(r.total), positionen: st.items.map((i) => `${i.label}: ${eur(i.amount)} nach ${C.NK_KEYS[i.key]}`), ergebnisse: r.contracts.map((c) => ({ vertrag: contractLabel(byId("contracts", c.contractId)), kosten: eur(c.total), vorauszahlung: eur(c.prepaid), saldo: eur(c.saldo) })), leerstand_vermieter: eur(r.owner.total), warnungen: r.warnings }; }),
    ferienwohnung: fewo.length ? { kennzahlen_jahr: (() => { const k = C.fewoStats(state, fewo, `${y}-01-01`, `${y + 1}-01-01`); return { auslastung: `${Math.round(k.occupancy * 100)} %`, adr: eur(k.adr), revpar: eur(k.revpar), logis_umsatz: eur(k.lodging), buchungen: k.bookings, storno: `${Math.round(k.cancelRate * 100)} %`, direkt: `${Math.round(k.directShare * 100)} %` }; })(),
      naechste_buchungen: state.bookings.filter((b) => b.to >= today() && b.status !== "storniert").sort((a, b) => (a.from < b.from ? -1 : 1)).slice(0, 15).map((b) => ({ gast: b.guest, von: b.from, bis: b.to, personen: Number(b.adults || 0) + Number(b.children || 0), kanal: b.channel, preis: eur((b.total || 0) + (b.cleaning || 0)), status: b.status })) } : null,
    offene_rechnungen: state.invoices.filter((i) => ["offen", "teilbezahlt"].includes(i.status)).map((i) => ({ nr: i.number, an: C.recipientName(i.recipient), betrag: eur(C.invoiceTotals(i).gross), bezahlt: eur(C.paidForInvoice(state, i.id)) })),
    dokumente_im_eingang: state.documents.filter((x) => x.status === "neu").map((x) => x.name),
    offene_fragen_steuer: C.taxOpenPoints(state, y - 1),
  };
}

function viewKi() {
  const chat = ui.chat || (ui.chat = []);
  const examples = ["Wer ist mit der Miete im Rückstand und wie viel?", "Wie hoch war mein Überschuss letztes Jahr je Objekt?", "Welche Kosten darf ich in der Nebenkostenabrechnung umlegen?", "Prüfe meine letzte Nebenkostenabrechnung auf Fehler.", "Welche Belege fehlen noch für den Steuerberater?", "Lohnt sich eine Mieterhöhung? Was muss ich beachten?", "Schreib eine freundliche Nachricht an meine nächsten Feriengäste."];
  if (!K.hasKey()) return head("KI-Assistent") + `<div class="card empty"><div class="big">✨</div><p>Der KI-Assistent beantwortet Fragen zu deinen Immobilien, prüft Abrechnungen, liest Belege aus und formuliert Briefe.</p><p class="small" style="margin:10px 0">Dafür wird ein eigener Claude-API-Schlüssel benötigt (console.anthropic.com → API Keys). Abgerechnet wird nach Nutzung, meist wenige Cent pro Anfrage.</p><a class="btn primary" href="#/einstellungen">Schlüssel in den Einstellungen eintragen</a></div>`;
  return head("KI-Assistent", "Fragen zu deinen Daten, Mietrecht, Nebenkosten und Steuern – Antworten auf Basis deiner App-Daten", chat.length ? btn("kiClear", "Neues Gespräch") : "") + `
    <div class="card chat">
      ${chat.length ? chat.map((m, i) => `<div class="msg q">${esc(m.q)}</div><div class="msg a">${m.a ? fmtAnswer(m.a) : '<span class="muted">⏳ denkt nach …</span>'}${m.a ? `<div class="toolbar" style="margin-top:6px">${btn("kiCopy", "Kopieren", "sm", i)}${btn("kiToLetter", "Als Brief übernehmen", "sm", i)}</div>` : ""}</div>`).join("") : `<p class="muted">Beispiele:</p><div class="toolbar">${examples.map((x) => `<button class="btn sm" data-act="kiExample" data-id="${esc(x)}">${esc(x)}</button>`).join("")}</div>`}
    </div>
    <form class="card inline" data-form="ki"><textarea name="q" placeholder="Deine Frage …" style="flex:1;min-height:60px" ${ui.kiAsking ? "disabled" : ""}></textarea><button class="btn primary" ${ui.kiAsking ? "disabled" : ""}>Senden</button></form>
    <p class="small muted">Beim Senden werden die App-Daten (Objekte, Mieter, Beträge) an die Claude API von Anthropic übertragen. Keine Rechts- oder Steuerberatung.</p>`;
}

function fmtAnswer(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^#{1,4} (.+)$/gm, "<b>$1</b>").replace(/\n/g, "<br>");
}

async function kiAsk(q) {
  if (!q.trim() || ui.kiAsking) return;
  ui.chat = ui.chat || [];
  const history = ui.chat.filter((m) => m.a && !m.err).slice(-8);
  const entry = { q, a: "" };
  ui.chat.push(entry); ui.kiAsking = true; render();
  try {
    if (state.settings.kiPseudo !== false) {
      // Datensparsamkeit (Art. 5 DSGVO): Namen und IBANs verlassen das Gerät nicht
      const ps = R.pseudonymizer(state);
      const ctx = JSON.parse(ps(JSON.stringify(buildContext())));
      const a = await K.ask({ question: ps(q), history: history.map((h) => ({ q: ps(h.q), a: ps(h.a) })), context: ctx });
      entry.a = ps.revert(a);
    } else entry.a = await K.ask({ question: q, history, context: buildContext() });
  }
  catch (e) { entry.a = "⚠️ " + K.friendlyError(e); entry.err = true; }
  ui.kiAsking = false; render();
  window.scrollTo(0, document.body.scrollHeight);
}

// ---------------------------------------------------------------- Mieterverwaltung: Einzug, Auszug, Mieterwechsel

const rentableUnits = () => state.units.filter((u) => u.type !== "ferienwohnung");
const contractsOfUnit = (unitId) => state.contracts.filter((c) => c.unitId === unitId).sort((a, b) => (a.start < b.start ? -1 : 1));
const currentContract = (unitId) => contractsOfUnit(unitId).find((c) => c.start <= today() && (!c.end || c.end >= today()));
const nextContract = (unitId) => contractsOfUnit(unitId).find((c) => c.start > today());
const meterFields = (prefix, readings = {}) => Object.entries(C.METER_TYPES).filter(([k]) => k !== "sonstiges").map(([k, l]) => `<label class="f"><span>${l}</span><input name="${prefix}_${k}" inputmode="decimal" value="${esc(readings[k] ?? "")}" placeholder="Zählerstand"></label>`).join("");
const lastReadings = (unitId) => {
  const out = {};
  for (const r of [...(state.meterReadings || [])].filter((x) => x.unitId === unitId).sort((a, b) => (a.date < b.date ? -1 : 1))) out[r.type] = r.value;
  return out;
};

function moveWizard(unitId) {
  const units = rentableUnits();
  if (!units.length) return toast("Bitte zuerst eine Einheit anlegen.");
  const uid0 = unitId || units.find((u) => !currentContract(u.id))?.id || units[0].id;
  const body = (uId) => {
    const c = currentContract(uId);
    const r = c ? C.rentForMonth(c, C.monthKey(today())) : null;
    const lr = lastReadings(uId);
    return `<label class="f"><span>Einheit</span><select name="unitId" data-wiz="unit">${opt(units.map((u) => [u.id, `${unitLabel(u)}${currentContract(u.id) ? " – " + tenantNames(currentContract(u.id)) : " – leer"}`]), uId)}</select></label>
      ${c ? `<h3>1. Auszug von ${esc(tenantNames(c))} <label class="small inline" style="font-weight:400"><input type="checkbox" name="doMoveOut" checked> Auszug erfassen</label></h3>
      <div class="fgrid">
        <label class="f"><span>Mietende (letzter Tag)</span><input type="date" name="outDate" value="${esc(c.end || "")}"></label>
        <label class="f"><span>Übergabe / Rückgabe am</span><input type="date" name="outHandover"></label>
        ${meterFields("out", {})}
        <label class="f"><span>Schlüssel zurück (Anzahl)</span><input type="number" name="outKeys"></label>
        <label class="f"><span>Kaution ${c.kaution ? eur(c.kaution) : ""}</span><select name="outKaution">${opt([["einbehalt", "Teilweise einbehalten bis NK-Abrechnung"], ["voll", "Vollständig zurückzahlen"], ["offen", "Noch offen"]], "einbehalt")}</select></label>
        <label class="f full"><span>Zustand / Mängel bei Rückgabe</span><textarea name="outNote" placeholder="z. B. Bohrlöcher Bad, Schönheitsreparaturen erledigt …"></textarea></label>
      </div>` : `<p class="note small">Die Einheit ist aktuell leer – es wird nur der Einzug erfasst.</p>`}
      <h3>${c ? "2." : "1."} Neuer Mieter</h3>
      <div class="fgrid">
        <label class="f"><span>Name (Hauptmieter) *</span><input name="name" required></label>
        <label class="f"><span>Weitere Personen / Mitmieter</span><input name="members" placeholder="z. B. Partner, Kinder"></label>
        <label class="f"><span>E-Mail</span><input type="email" name="email"></label>
        <label class="f"><span>Telefon</span><input name="phone"></label>
        <label class="f"><span>IBAN (für automatische Zuordnung)</span><input name="iban"></label>
        <label class="f"><span>Bisherige Anschrift</span><input name="prevAddress"></label>
        <label class="f"><span>Mietbeginn / Einzug *</span><input type="date" name="inDate" required value="${c?.end ? C.addDaysIso(c.end, 1) : ""}"></label>
        <label class="f"><span>Schlüsselübergabe am</span><input type="date" name="inHandover"></label>
        <label class="f"><span>Personen im Haushalt</span><input type="number" name="persons" value="1"></label>
        <label class="f"><span>Befristet bis (leer = unbefristet)</span><input type="date" name="inEnd"></label>
        <label class="f"><span>Kaltmiete (€/Monat)</span><input name="kalt" inputmode="decimal" value="${r ? C.fmtNum(r.kalt) : ""}"></label>
        <label class="f"><span>NK-/Heizkostenvorauszahlung (€/Monat)</span><input name="nk" inputmode="decimal" value="${r ? C.fmtNum(r.nk) : ""}"></label>
        <label class="f"><span>Zuschläge (Stellplatz, Möblierung …)</span><input name="extra" inputmode="decimal" value="${r?.extra ? C.fmtNum(r.extra) : ""}"></label>
        <label class="f"><span>Kaution (€, Wohnraum max. 3 Nettokaltmieten)</span><input name="kaution" inputmode="decimal" value="${r ? C.fmtNum(r.kalt * 3) : ""}"></label>
        <label class="f"><span>Umsatzsteuer</span><select name="ustRate">${opt([["", "keine (Wohnraum / privater Mieter)"], ["19", "zzgl. 19 % USt (gewerblicher Mieter)"], ["7", "zzgl. 7 % USt"]], c?.ustRate ? String(c.ustRate) : byId("units", uId)?.type === "gewerbe" ? "19" : "")}</select></label>
        <label class="f"><span>Mietart</span><select name="mietart">${opt([["standard", "Normale Miete"], ["staffel", "Staffelmiete"], ["index", "Indexmiete"]], "standard")}</select></label>
        ${meterFields("in", lr)}
        <label class="f"><span>Schlüssel übergeben (Anzahl)</span><input type="number" name="inKeys"></label>
        <label class="f full"><span>Zustand bei Übergabe / Vereinbarungen</span><textarea name="inNote" placeholder="z. B. frisch renoviert, Einbauküche, Kellerraum Nr. 3 …"></textarea></label>
      </div>
      <p class="small muted">Zählerstände beim Einzug sind mit dem letzten bekannten Stand vorbelegt – bitte mit dem tatsächlichen Stand überschreiben. Sie fließen später in die Nebenkostenabrechnung ein.</p>
      <div id="wizWarn"></div>`;
  };
  dialog({
    title: currentContract(uid0) ? "Mieterwechsel" : "Neuer Mieter", wide: true, submit: currentContract(uid0) ? "Mieterwechsel speichern" : "Mieter speichern", body: body(uid0),
    onOpen: (form) => {
      const check = () => {
        const c = currentContract(form.unitId.value);
        // Überschrift und Knopf passen sich an: leere Einheit = neuer Mieter, bewohnte Einheit mit Auszug = Mieterwechsel
        const wechsel = !!c && !!form.doMoveOut?.checked;
        $(".dh", form).textContent = wechsel ? "Mieterwechsel" : "Neuer Mieter";
        $("button[type=submit]", form).textContent = wechsel ? "Mieterwechsel speichern" : "Mieter speichern";
        const res = C.checkMove(c, form.doMoveOut?.checked ? form.outDate?.value : c?.end, form.inDate.value);
        $("#wizWarn", form).innerHTML = [...res.warnings.map((w) => `<div class="note warn">${esc(w)}</div>`), res.vacancyDays ? `<div class="note">Leerstand zwischen den Mietern: ${res.vacancyDays} Tage (Nebenkosten dafür trägt der Vermieter).</div>` : ""].join("");
      };
      form.addEventListener("change", (e) => {
        if (e.target.dataset.wiz === "unit") { $(".db", form.closest("dialog")).innerHTML = body(e.target.value); }
        if (e.target.name === "outDate" && form.inDate && !form.inDate.value && e.target.value) form.inDate.value = C.addDaysIso(e.target.value, 1);
        if (e.target.name?.startsWith("out_") && form[`in_${e.target.name.slice(4)}`] && e.target.value) form[`in_${e.target.name.slice(4)}`].value = e.target.value;
        check();
      });
      check();
    },
    onSubmit: (form) => {
      const v = Object.fromEntries(new FormData(form));
      const unitId = v.unitId, old = currentContract(unitId);
      const doOut = old && form.doMoveOut?.checked;
      if (doOut && !v.outDate) { toast("Bitte das Mietende des bisherigen Mieters angeben."); return false; }
      const res = C.checkMove(old, doOut ? v.outDate : old?.end, v.inDate);
      if (res.warnings.length) { toast(res.warnings[0]); return false; }
      if (old && !doOut && !old.end) { toast("Die Einheit ist noch vermietet – bitte den Auszug erfassen."); return false; }
      const readings = (prefix, date, contractId, reason) => Object.keys(C.METER_TYPES).filter((k) => v[`${prefix}_${k}`]).map((k) => ({ id: C.uid("m_"), unitId, contractId, type: k, date, value: Number(String(v[`${prefix}_${k}`]).replace(",", ".")), reason }));
      if (doOut) {
        old.end = v.outDate;
        old.moveOut = { date: v.outDate, handover: v.outHandover || v.outDate, keys: v.outKeys, note: v.outNote, kaution: v.outKaution };
        state.meterReadings.push(...readings("out", v.outHandover || v.outDate, old.id, "auszug"));
      }
      const unit = byId("units", unitId), obj = byId("objects", unit?.objectId);
      const legal = [...R.depositCheck(unit, { kalt: C.parseAmount(v.kalt), kaution: C.parseAmount(v.kaution) }), ...R.rentBrakeCheck(obj, unit, C.parseAmount(v.kalt), old ? C.rentForMonth(old, C.monthKey(old.end || v.outDate || today())).kalt : 0, obj?.vergleichsmiete)];
      if (!confirmLegal(legal)) return false;
      const t = { id: C.uid("t_"), name: v.name.trim(), members: v.members, email: v.email, phone: v.phone, ibans: v.iban ? [C.normIban(v.iban)] : [], prevAddress: v.prevAddress, notes: "" };
      const c = { id: C.uid("c_"), unitId, tenantIds: [t.id], start: v.inDate, end: v.inEnd || "", kalt: C.parseAmount(v.kalt), nk: C.parseAmount(v.nk), extra: C.parseAmount(v.extra), kaution: C.parseAmount(v.kaution), persons: Number(v.persons) || 1, mietart: v.mietart || "standard", ustRate: v.ustRate || "", steps: [], notes: "",
        moveIn: { date: v.inDate, handover: v.inHandover || v.inDate, keys: v.inKeys, note: v.inNote } };
      state.tenants.push(t); state.contracts.push(c);
      state.meterReadings.push(...readings("in", v.inHandover || v.inDate, c.id, "einzug"));
      commit(doOut ? "Mieterwechsel gespeichert" : "Neuer Mieter eingetragen");
      setTimeout(() => moveDoneDialog(c.id, doOut ? old.id : null), 50);
    },
  });
}

function moveDoneDialog(newId, oldId) {
  const nc = byId("contracts", newId);
  dialog({
    title: "Erledigt – nächste Schritte", submit: "Fertig", onSubmit: () => {},
    body: `<p style="margin-bottom:10px">${esc(tenantNames(nc))} ist ab ${d(nc.start)} eingetragen.</p>
      <div class="toolbar" style="flex-direction:column;align-items:stretch">
        <a class="btn" href="#/protokoll/${newId}/in" data-close>🖨 Übergabeprotokoll Einzug</a>
        <button class="btn" data-act="letterFor" data-id="wohnungsgeber|${newId}">✉ Wohnungsgeberbestätigung (§ 19 BMG)</button>
        ${oldId ? `<a class="btn" href="#/protokoll/${oldId}/out" data-close>🖨 Übergabeprotokoll Auszug</a>
        <button class="btn" data-act="letterFor" data-id="kuendigungsbestaetigung|${oldId}">✉ Bestätigung Auszug / Kaution</button>` : ""}
        <a class="btn" href="#/mieter/${nc.tenantIds[0]}" data-close>👤 Mieterakte öffnen</a>
      </div>
      <p class="small muted" style="margin-top:10px">Tipp: Mietvertrag und Übergabeprotokoll unter „Belege & Dokumente“ scannen und dem Mieter zuordnen.</p>`,
  });
}

function viewDataReport(id) {
  const t = byId("tenants", id);
  if (!t) return head("Mieter nicht gefunden");
  const s = state.settings;
  const cs = state.contracts.filter((c) => c.tenantIds.includes(id));
  const cIds = new Set(cs.map((c) => c.id));
  const pays = state.payments.filter((p) => cIds.has(p.contractId));
  const rd = (state.meterReadings || []).filter((r) => cIds.has(r.contractId));
  const docs = state.documents.filter((x) => cIds.has(x.contractId));
  const letters = (state.letters || []).filter((l) => cIds.has(l.contractId));
  const txs = state.transactions.filter((tx) => tx.link?.type === "payment" && pays.some((p) => (tx.link.ids || [tx.link.id]).includes(p.id)));
  return `<div class="head noprint"><a href="#/mieter/${id}">← Mieterakte</a><button class="btn primary" onclick="window.print()">Drucken / PDF</button></div>
  <div class="paper">
    <h1>Auskunft über gespeicherte personenbezogene Daten (Art. 15 DSGVO)</h1>
    <p>Verantwortlicher: ${esc(s.ownerName)}, ${esc([s.ownerStreet, [s.ownerZip, s.ownerCity].filter(Boolean).join(" ")].filter(Boolean).join(", "))}${s.ownerEmail ? `, ${esc(s.ownerEmail)}` : ""} · Stand: ${d(today())}</p>
    <h3>1. Stammdaten</h3><table class="lines"><tbody>
      ${[["Name", t.name], ["Weitere Personen", t.members], ["E-Mail", t.email], ["Telefon", t.phone], ["IBAN", (t.ibans || []).join(", ")], ["Zustellanschrift", t.address], ["Bisherige Anschrift", t.prevAddress], ["Notizen", t.notes]].filter(([, v]) => v).map(([k, v]) => `<tr><td style="width:200px">${k}</td><td>${esc(v)}</td></tr>`).join("")}
    </tbody></table>
    <h3>2. Mietverhältnisse</h3>${cs.map((c) => `<p>${esc(unitLabel(byId("units", c.unitId)))}: ${d(c.start)} – ${c.end ? d(c.end) : "unbefristet"}, Kaltmiete ${eur(c.kalt)}, NK ${eur(c.nk)}, Kaution ${eur(c.kaution || 0)}, ${c.persons || 1} Person(en)</p>`).join("")}
    <h3>3. Zahlungen (${pays.length}) und Kontoumsätze (${txs.length})</h3><p class="small">${pays.map((p) => `${d(p.date)} ${eur(p.amount)}`).join(" · ") || "keine"}</p>
    <h3>4. Zählerstände</h3><p class="small">${rd.map((r) => `${d(r.date)} ${esc(C.METER_TYPES[r.type])}: ${r.value}`).join(" · ") || "keine"}</p>
    <h3>5. Dokumente und Schreiben</h3><p class="small">${[...docs.map((x) => esc(x.name)), ...letters.map((l) => `${d(l.date)} ${esc(l.subject)}`)].join(" · ") || "keine"}</p>
    <h3>6. Zwecke, Rechtsgrundlagen, Speicherdauer</h3>
    <p class="small">Zweck: Durchführung des Mietverhältnisses, Abrechnung von Miete und Betriebskosten, Erfüllung gesetzlicher Pflichten. Rechtsgrundlagen: Art. 6 Abs. 1 lit. b DSGVO (Vertrag), lit. c (gesetzliche Pflichten, z. B. Aufbewahrung nach § 147 AO/§ 257 HGB, Wohnungsgeberbestätigung nach § 19 BMG), lit. f (berechtigtes Interesse, z. B. Geltendmachung von Ansprüchen). Speicherdauer: für die Dauer des Mietverhältnisses; danach Buchungsbelege 8 Jahre, Geschäftsbriefe 6 Jahre ab Ende des Kalenderjahres, anschließend Löschung bzw. Anonymisierung. Empfänger: ggf. Steuerberater, Hausverwaltung, Ableseunternehmen, Handwerker im erforderlichen Umfang${isCloud() ? "; technische Dienstleister im Auftrag (Hosting)" : ""}.</p>
    <p class="small">Sie haben das Recht auf Berichtigung, Löschung (soweit keine Aufbewahrungspflicht besteht), Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie auf Beschwerde bei einer Datenschutz-Aufsichtsbehörde.</p>
  </div>`;
}

function viewPrivacyCard() {
  const due = R.retentionDue(state, today());
  return `<div class="card"><h2>🛡 Datenschutz & Aufbewahrung</h2>
    <label class="f inline"><input type="checkbox" data-change="kiPseudo" ${state.settings.kiPseudo !== false ? "checked" : ""}> KI-Assistent datensparsam: Mieter- und Gästenamen werden vor dem Senden ersetzt, IBANs entfernt (empfohlen)</label>
    <p class="small muted">Aufbewahrungsfristen: Buchungsbelege, Rechnungen, Kontoauszüge 8 Jahre; Geschäftsbriefe 6 Jahre; Bücher/Abschlüsse 10 Jahre (§ 147 AO, § 257 HGB) – jeweils ab Ende des Kalenderjahres. Meldescheine von Gästen 1 Jahr. Danach sind personenbezogene Daten zu löschen (Art. 17 DSGVO).</p>
    ${due.tenants.length || due.guests.length ? `<div class="note warn"><b>Frist abgelaufen – Löschung/Anonymisierung empfohlen:</b>
      ${due.tenants.map((t) => `<div class="small">Ehemaliger Mieter: ${esc(t.name)} ${btn("anonTenant", "anonymisieren", "sm link", t.id)}</div>`).join("")}
      ${due.guests.length ? `<div class="small">${due.guests.length} Feriengast/-gäste: Kontakt- und Meldedaten älter als 1 Jahr ${btn("anonGuests", "bereinigen", "sm link")}</div>` : ""}
      <div class="small muted">Beträge und Buchungen bleiben für Steuer und Statistik erhalten; nur Namen, Kontaktdaten, IBAN und Notizen werden entfernt.</div></div>` : '<p class="small">✓ Keine Daten mit abgelaufener Aufbewahrungsfrist.</p>'}
  </div>`;
}

function viewProtocol(contractId, dir) {
  const c = byId("contracts", contractId);
  if (!c) return head("Vertrag nicht gefunden");
  const m = dir === "out" ? c.moveOut : c.moveIn;
  const u = byId("units", c.unitId), s = state.settings;
  const rs = (state.meterReadings || []).filter((r) => r.contractId === c.id && r.reason === (dir === "out" ? "auszug" : "einzug"));
  return `<div class="head noprint"><a href="#/mieter/${c.tenantIds[0]}">← Mieterakte</a><button class="btn primary" onclick="window.print()">Drucken / PDF</button></div>
  <div class="paper">
    <h1>Wohnungsübergabeprotokoll – ${dir === "out" ? "Auszug / Rückgabe" : "Einzug / Übergabe"}</h1>
    <table class="lines"><tbody>
      <tr><td style="width:200px">Mietobjekt</td><td>${esc(addrOf(u))}, ${esc(u?.name || "")}${u?.area ? `, ${String(u.area).replace(".", ",")} m²` : ""}</td></tr>
      <tr><td>Vermieter</td><td>${esc(s.ownerName)}, ${esc([s.ownerStreet, [s.ownerZip, s.ownerCity].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</td></tr>
      <tr><td>Mieter</td><td>${esc(tenantNames(c))}${byId("tenants", c.tenantIds[0])?.members ? `, ${esc(byId("tenants", c.tenantIds[0]).members)}` : ""}</td></tr>
      <tr><td>${dir === "out" ? "Mietende" : "Mietbeginn"}</td><td>${d(dir === "out" ? c.end : c.start)}</td></tr>
      <tr><td>Datum der Übergabe</td><td>${m?.handover ? d(m.handover) : "____________"}</td></tr>
      <tr><td>Schlüssel</td><td>${m?.keys ? `${esc(m.keys)} Stück` : "____ Stück"} (Haustür ___ / Wohnung ___ / Keller ___ / Briefkasten ___)</td></tr>
    </tbody></table>
    <h3>Zählerstände</h3>
    <table class="lines"><thead><tr><th>Zähler</th><th>Zählernummer</th><th class="num">Stand</th></tr></thead><tbody>
      ${Object.entries(C.METER_TYPES).filter(([k]) => k !== "sonstiges").map(([k, l]) => { const r = rs.find((x) => x.type === k); return `<tr><td>${l}</td><td>________________</td><td class="num">${r ? String(r.value).replace(".", ",") : "________"}</td></tr>`; }).join("")}
    </tbody></table>
    <h3>Zustand der Räume</h3>
    <table class="lines"><thead><tr><th>Raum</th><th>Zustand / Mängel</th></tr></thead><tbody>
      ${["Flur", "Wohnzimmer", "Schlafzimmer", "Kinderzimmer", "Küche", "Bad / WC", "Balkon / Terrasse", "Keller"].map((r) => `<tr><td style="width:160px">${r}</td><td style="height:30px"></td></tr>`).join("")}
    </tbody></table>
    ${m?.note ? `<h3>Vermerke</h3><p style="white-space:pre-wrap">${esc(m.note)}</p>` : ""}
    ${dir === "out" ? `<p style="margin-top:12px">Kaution: ${eur(c.kaution || 0)} – ${esc({ einbehalt: "angemessener Teil wird bis zur Erstellung der Betriebskostenabrechnung einbehalten", voll: "wird vollständig zurückgezahlt", offen: "Abrechnung folgt" }[m?.kaution] || "Abrechnung folgt")}.</p>` : ""}
    <div class="sig"><div>Ort, Datum, Vermieter</div><div>Ort, Datum, Mieter</div></div>
  </div>`;
}

// ---------------------------------------------------------------- Mieterordner (digitale Mieterakte)

const NOTE_TYPES = { notiz: "📝 Notiz", anruf: "📞 Anruf", email: "✉️ E-Mail/Nachricht", mangel: "🔧 Mangel / Reparatur", termin: "📅 Termin / Wiedervorlage", vereinbarung: "🤝 Vereinbarung" };
const FOLDER_KINDS = ["vertrag", "nachtrag", "protokoll", "kaution", "selbstauskunft", "wohnungsgeber", "kuendigung", "korrespondenz", "foto", "zaehler", "sonstiges"];

// Was gehört in eine vollständige Akte?
function folderChecklist(c) {
  const u = byId("units", c.unitId);
  const docs = state.documents.filter((x) => x.contractId === c.id);
  const has = (k) => docs.some((x) => x.kind === k);
  const letters = (state.letters || []).filter((l) => l.contractId === c.id);
  const wohn = R.isWohnraum(u);
  const items = [
    { k: "vertrag", label: "Mietvertrag (unterschrieben)", ok: has("vertrag") },
    ...(wohn ? [
      { k: "protokoll", label: "Übergabeprotokoll Einzug", ok: has("protokoll") },
      { k: "wohnungsgeber", label: "Wohnungsgeberbestätigung (§ 19 BMG)", ok: has("wohnungsgeber") || letters.some((l) => l.kind === "wohnungsgeber"), optional: c.start < C.addDaysIso(today(), -365) },
      { k: "kaution", label: "Kaution erhalten / Kautionskonto", ok: !c.kaution || has("kaution") || state.payments.some((p) => p.kind === "kaution" && p.contractId === c.id) },
      { k: "selbstauskunft", label: "Mieterselbstauskunft (optional)", ok: has("selbstauskunft"), optional: true },
    ] : []),
    ...(c.end && c.end <= today() && wohn ? [{ k: "protokoll", label: "Übergabeprotokoll Auszug", ok: docs.filter((x) => x.kind === "protokoll").length >= 2 || !!c.moveOut?.handover }] : []),
  ];
  return { items, missing: items.filter((i) => !i.ok && !i.optional) };
}

function notesFor(tenantId) {
  return (state.notes || []).filter((n) => n.tenantId === tenantId).sort((a, b) => (a.date < b.date ? 1 : -1));
}

function editNote(id, preset = {}) {
  const n = (state.notes || []).find((x) => x.id === id) || { id: C.uid("n_"), date: today(), type: "notiz", done: false, ...preset };
  formDialog({
    title: id ? "Vorgang bearbeiten" : "Neuer Vorgang", data: n,
    spec: [
      { k: "type", l: "Art", t: "select", opts: Object.entries(NOTE_TYPES) },
      { k: "date", l: "Datum", t: "date", req: 1 },
      { k: "title", l: "Kurzbeschreibung", req: 1, full: 1, ph: "z. B. Heizung im Bad wird nicht warm" },
      { k: "text", l: "Details", t: "textarea" },
      { k: "due", l: "Wiedervorlage / fällig am", t: "date" },
      { k: "done", l: "erledigt", t: "checkbox" },
    ],
    onSave: (v) => {
      state.notes = state.notes || [];
      upsert("notes", { ...n, ...v, doneAt: v.done && !n.done ? today() : n.doneAt });
      commit("Vorgang gespeichert");
    },
    onDelete: id && (() => { state.notes = state.notes.filter((x) => x.id !== id); commit("Vorgang gelöscht"); }),
  });
  const hasRepair = n.repairId && (state.repairs || []).some((r) => r.id === n.repairId);
  if (id && n.type === "mangel" && !hasRepair) $("#modal .df").insertAdjacentHTML("afterbegin", `<button type="button" class="btn" data-act="repairFromNote" data-id="${n.id}">🔧 Als Reparaturauftrag übernehmen</button>`);
  else if (hasRepair) $("#modal .df").insertAdjacentHTML("afterbegin", `<button type="button" class="btn" data-act="editRepair" data-id="${n.repairId}">🔧 Zum Reparaturauftrag</button>`);
}

function openTasks() {
  const t = today();
  return (state.notes || []).filter((n) => !n.done && (n.type === "mangel" || (n.due && n.due <= C.addDaysIso(t, 14)))).sort((a, b) => ((a.due || "9") < (b.due || "9") ? -1 : 1));
}

function viewTenants() {
  const units = rentableUnits();
  const q = C.normalize(ui.tenantSearch || "");
  const filter = ui.tenantFilter || "aktiv";
  const info = (t) => {
    const cs = state.contracts.filter((c) => c.tenantIds.includes(t.id)).sort((a, b) => (a.start < b.start ? 1 : -1));
    const c = cs.find((x) => x.start <= today() && (!x.end || x.end >= today())) || cs.find((x) => x.start > today()) || cs[0];
    const status = !c ? "ohne" : c.start > today() ? "einzug" : c.end && c.end < today() ? "ehemalig" : c.end ? "gekuendigt" : "aktiv";
    const back = c ? -sum(C.sollIst(state, C.addMonths(C.monthKey(today()), -11), C.monthKey(today())).filter((r) => r.contractId === c.id && r.diff < 0), (r) => r.diff) : 0;
    const miss = c ? folderChecklist(c).missing.length : 0;
    const defects = (state.notes || []).filter((n) => n.tenantId === t.id && n.type === "mangel" && !n.done).length;
    return { t, c, status, back, miss, defects };
  };
  const all = state.tenants.map(info);
  const list = all.filter((x) => (filter === "alle" || (filter === "aktiv" ? ["aktiv", "gekuendigt", "einzug"].includes(x.status) : x.status === filter)))
    .filter((x) => !q || C.normalize(`${x.t.name} ${x.t.members} ${x.t.email} ${x.t.phone} ${x.c ? unitLabel(byId("units", x.c.unitId)) : ""}`).includes(q))
    .sort((a, b) => (a.c ? unitLabel(byId("units", a.c.unitId)) : "z").localeCompare(b.c ? unitLabel(byId("units", b.c.unitId)) : "z"));
  const badge = { aktiv: '<span class="badge ok">aktiv</span>', gekuendigt: '<span class="badge warn">gekündigt</span>', einzug: '<span class="badge">zieht ein</span>', ehemalig: '<span class="badge grey">ehemalig</span>', ohne: '<span class="badge grey">ohne Vertrag</span>' };
  const vacant = units.filter((u) => !currentContract(u.id) && !nextContract(u.id));
  return head("Mieter & Verträge", `${all.filter((x) => ["aktiv", "gekuendigt"].includes(x.status)).length} aktive Mietverhältnisse · ${vacant.length} frei`, btn("moveWizard", "+ Neuer Mieter / Einzug", "primary", "") + btn("newContract", "Vertrag manuell")) + `
    <div class="inline" style="margin-bottom:12px"><input placeholder="🔎 Mieter, Wohnung, Telefon suchen …" value="${esc(ui.tenantSearch || "")}" data-change="tenantSearch" style="max-width:320px">
      <div class="tabs" style="border:0;margin:0">${[["aktiv", "Aktuelle"], ["gekuendigt", "Gekündigt"], ["ehemalig", "Ehemalige"], ["alle", "Alle"], ["belegung", "Belegung je Einheit"]].map(([k, l]) => `<button data-act="tenantFilter" data-id="${k}" class="${filter === k ? "active" : ""}">${l}</button>`).join("")}</div></div>
    ${filter === "belegung" ? `<div class="card"><div class="table-wrap"><table><thead><tr><th>Einheit</th><th>Aktueller Mieter</th><th>seit</th><th class="num">Warmmiete</th><th>Danach</th><th></th></tr></thead><tbody>
      ${units.map((u) => { const c = currentContract(u.id), n = nextContract(u.id); const r = c ? C.rentForMonth(c, C.monthKey(today())) : null;
        return `<tr><td><b>${esc(unitLabel(u))}</b><div class="small muted">${esc(C.UNIT_TYPES[u.type])}${u.area ? ` · ${String(u.area).replace(".", ",")} m²` : ""}</div></td>
        <td>${c ? `<a href="#/mieter/${c.tenantIds[0]}">📁 ${esc(tenantNames(c))}</a>${c.end ? `<div class="small"><span class="badge warn">Auszug ${d(c.end)}</span></div>` : ""}` : '<span class="badge warn">leer</span>'}</td>
        <td class="nowrap small">${c ? d(c.start) : ""}</td><td class="num">${r ? eur(r.total) : ""}</td>
        <td class="small">${n ? `<a href="#/mieter/${n.tenantIds[0]}">${esc(tenantNames(n))}</a><br>ab ${d(n.start)}` : ""}</td>
        <td class="nowrap">${c && !c.end ? btn("moveWizard", "Mieterwechsel / Auszug", "sm", u.id) : !c && !n ? btn("moveWizard", "Neuen Mieter eintragen", "sm primary", u.id) : ""}</td></tr>`; }).join("") || '<tr><td colspan="6" class="muted">Noch keine Einheiten.</td></tr>'}
    </tbody></table></div></div>` : ""}
    ${filter !== "belegung" ? tenantsOverviewHtml(all, vacant, list.length) : ""}
    <div class="folders" ${filter === "belegung" || !all.length ? 'style="display:none"' : ""}>${list.map(({ t, c, status, back, miss, defects }) => { const u = c && byId("units", c.unitId); const r = c ? C.rentForMonth(c, C.monthKey(today())) : null;
      return `<a class="folder" href="#/mieter/${t.id}">
        <div class="tab">${esc(u ? `${C.UNIT_TYPES[u.type]} · ${u.name}` : "–")}</div>
        <div class="fhead"><b>${esc(t.name)}</b> ${badge[status]}</div>
        <div class="small muted">${esc(u ? addrOf(u) : "")}</div>
        <div class="small">${c ? `seit ${d(c.start)}${c.end ? ` · bis ${d(c.end)}` : ""}` : ""}${r ? ` · ${eur(r.total)} warm` : ""}</div>
        <div class="fbadges">${back > 0 ? `<span class="badge bad">Rückstand ${eur(back)}</span>` : c && status !== "ehemalig" ? '<span class="badge ok">Miete ok</span>' : ""}
          ${defects ? `<span class="badge warn">🔧 ${defects} Mangel</span>` : ""}${miss ? `<span class="badge warn">📁 ${miss} fehlt</span>` : c ? '<span class="badge ok">📁 vollständig</span>' : ""}</div>
      </a>`; }).join("") || '<p class="muted">Keine Mieter in dieser Ansicht.</p>'}</div>`;
}

const UNIT_ICON = { wohnung: "🏠", haus: "🏡", gewerbe: "🏢", garage: "🚗", stellplatz: "🅿️", carport: "🅿️", keller: "📦", lager: "📦", ferienwohnung: "🏖️", sonstiges: "🔑" };

// Kopf der Mieterseite: Kennzahlen, Start ohne Mieter, freie Einheiten als Kacheln je Objekt
function tenantsOverviewHtml(all, vacant, shown) {
  const units = rentableUnits(), key = C.monthKey(today());
  const active = all.filter((x) => ["aktiv", "gekuendigt"].includes(x.status));
  const rentSum = sum(active, (x) => (x.c ? C.rentForMonth(x.c, key).total : 0));
  const backSum = sum(active, (x) => Math.max(0, x.back));
  const stats = all.length ? `<div class="bigstats four"><div><b>${active.length}</b><span>vermietet</span></div><div><b>${vacant.length}</b><span>frei</span></div><div><b>${eur(rentSum)}</b><span>Miete pro Monat (warm)</span></div><div><b class="${backSum ? "neg" : ""}">${eur(backSum)}</b><span>Rückstand</span></div></div>` : "";
  const start = !all.length ? `<div class="card empty-start"><div class="big">👥</div><h2>Noch keine Mieter eingetragen</h2>
      <p class="muted">Lege deinen ersten Mieter an – mit Einzugsdatum, Miete und Kaution. Den Mietvertrag kannst du danach einfach fotografieren und ablegen.</p>
      <div class="toolbar" style="justify-content:center;margin-top:12px">${btn("moveWizard", "+ Ersten Mieter eintragen", "primary", "")}</div></div>` : "";
  if (!vacant.length) return stats + start;
  const byObj = new Map();
  for (const u of vacant) { if (!byObj.has(u.objectId)) byObj.set(u.objectId, []); byObj.get(u.objectId).push(u); }
  const tile = (u) => `<button class="unit-tile" data-act="moveWizard" data-id="${u.id}" title="Mieter für ${esc(u.name)} eintragen">
      <span class="ut-ic">${UNIT_ICON[u.type] || "🔑"}</span><span class="ut-tx"><b>${esc(u.name)}</b><small>${esc(C.UNIT_TYPES[u.type] || "")}${u.area ? ` · ${String(u.area).replace(".", ",")} m²` : ""}</small></span><span class="ut-go">+ Mieter</span></button>`;
  const groups = [...byObj.entries()].map(([oid, us]) => `<div class="ut-group"><div class="ut-obj">🏘️ ${esc(byId("objects", oid)?.name || "Objekt")} <span class="muted small">· ${us.length} frei</span></div><div class="unit-tiles">${us.map(tile).join("")}</div></div>`).join("");
  const open = !all.length || vacant.length <= 6 || ui.vacantOpen;
  return stats + start + `<details class="card vacant" ${open ? "open" : ""} data-vacant><summary><h2 style="display:inline">🔓 Freie Einheiten <span class="badge warn">${vacant.length}</span></h2> <span class="small muted">– antippen, um einen Mieter einzutragen</span></summary>${groups}</details>`;
}

function viewTenant(id) {
  const t = byId("tenants", id);
  if (!t) return head("Mieter nicht gefunden");
  const cs = state.contracts.filter((c) => c.tenantIds.includes(id)).sort((a, b) => (a.start < b.start ? 1 : -1));
  const cIds = new Set(cs.map((c) => c.id));
  const active = cs.find((c) => c.start <= today() && (!c.end || c.end >= today())) || cs.find((c) => c.start > today()) || cs[0];
  const u = active && byId("units", active.unitId);
  const key = C.monthKey(today());
  const pays = state.payments.filter((p) => cIds.has(p.contractId)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const si = cs.length ? C.sollIst(state, C.addMonths(key, -23), key).filter((r) => cIds.has(r.contractId)) : [];
  const saldo = sum(si, (r) => r.diff);
  const kautionPaid = sum(pays.filter((p) => p.kind === "kaution"), (p) => p.amount);
  const docs = state.documents.filter((x) => cIds.has(x.contractId)).sort((a, b) => (a.created < b.created ? 1 : -1));
  const letters = (state.letters || []).filter((l) => cIds.has(l.contractId));
  const notes = notesFor(id);
  const readings = (state.meterReadings || []).filter((r) => cIds.has(r.contractId)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const nks = (state.nkStatements || []).map((st) => ({ st, r: C.nkAbrechnung(state, st).contracts.find((x) => cIds.has(x.contractId)) })).filter((x) => x.r);
  const check = active ? folderChecklist(active) : { items: [], missing: [] };
  const r = active ? C.rentForMonth(active, active.start > today() ? C.monthKey(active.start) : key) : null;
  const tab = ui.folderTab || "ueberblick";
  const openNotes = notes.filter((n) => !n.done);
  const tabs = [["ueberblick", "Überblick"], ["dokumente", `Dokumente (${docs.length})`], ["vorgaenge", `Vorgänge${openNotes.length ? ` (${openNotes.length} offen)` : ""}`], ["zahlungen", "Mietkonto"], ["vertrag", "Vertrag & Historie"], ["nebenkosten", "Nebenkosten & Zähler"]];
  const fact = (l, v) => (v ? `<div><span class="muted small">${l}</span><br>${v}</div>` : "");
  const upload = (kind) => `<label class="btn sm">📷 Foto/Scan<input type="file" accept="image/*" capture="environment" data-change="folderUpload" data-kind="${kind}" data-scan="1" hidden></label><label class="btn sm">📄 PDF/Datei<input type="file" accept="image/*,application/pdf" multiple data-change="folderUpload" data-kind="${kind}" hidden></label>`;
  const docRow = (x) => `<div class="docline"><span class="att" data-act="openDoc" data-id="${x.id}">${x.thumb ? `<img src="${x.thumb}">` : "📄"} ${esc(x.name)}</span>
    <span class="small muted">${esc(DOC_KINDS[x.kind] || "")} · ${d(x.created.slice(0, 10))}</span>
    ${x.kind === "vertrag" ? btn("leaseRead", ui.kiBusy?.[x.id] ? "⏳ liest …" : "✨ Vertrag auslesen", "sm", `${x.id}|${x.contractId}`) : ""}${isCloud() && portalRowFor(id) && !portalRowFor(id).revoked_at ? ((x.sharedWith || []).includes(id) ? '<span class="small muted">🔑 geteilt</span>' : btn("portalShareDoc", "🔑 Teilen", "sm", `${x.id}|${id}`)) : ""}${btn("editDoc", "✎", "sm link", x.id)}</div>`;

  const body = {
    ueberblick: `<div class="grid g2">${portalCard(id)}
      <div class="card"><h2>Steckbrief</h2><div class="facts">
        ${fact("Einheit", u ? `${esc(unitLabel(u))} (${esc(C.UNIT_TYPES[u.type])}${u.area ? `, ${String(u.area).replace(".", ",")} m²` : ""})` : "")}
        ${fact("Adresse", u ? esc(addrOf(u)) : "")}
        ${fact("Mietzeit", active ? `${d(active.start)} – ${active.end ? d(active.end) : "unbefristet"}` : "")}
        ${fact("Warmmiete", r ? `<b>${eur(r.total)}</b> <span class="small muted">(kalt ${eur(r.kalt)} + NK ${eur(r.nk)}${r.extra ? ` + ${eur(r.extra)}` : ""}${r.vat ? ` netto + ${r.rate} % USt ${eur(r.vat)}` : ""})</span>` : "")}
        ${fact("Kaution", active?.kaution ? `${eur(active.kaution)} · ${kautionPaid ? `${eur(kautionPaid)} erhalten` : "Eingang nicht erfasst"}` : "")}
        ${fact("Personen", active ? `${active.persons || 1}${t.members ? ` – ${esc(t.members)}` : ""}` : "")}
        ${fact("Telefon", t.phone ? `<a href="tel:${esc(t.phone)}">${esc(t.phone)}</a>` : "")}
        ${fact("E-Mail", t.email ? `<a href="mailto:${esc(t.email)}">${esc(t.email)}</a>` : "")}
        ${fact("IBAN", (t.ibans || []).map(esc).join(", "))}
        ${fact("Mietart", active ? esc({ standard: "normale Miete", staffel: "Staffelmiete", index: "Indexmiete" }[active.mietart || "standard"]) : "")}
      </div></div>
      <div>
        <div class="card"><h2>Auf einen Blick</h2>
          <div class="kv"><span>Mietkonto (24 Mon.)</span><b class="${saldo < 0 ? "neg" : "pos"}">${saldo < 0 ? `Rückstand ${eur(-saldo)}` : "ausgeglichen"}</b></div>
          <div class="kv"><span>Offene Vorgänge</span><b>${openNotes.length}</b></div>
          <div class="kv"><span>Letzte Zahlung</span><b>${pays[0] ? `${d(pays[0].date)} · ${eur(pays[0].amount)}` : "–"}</b></div>
          <div class="kv"><span>Letzte NK-Abrechnung</span><b>${nks[0] ? (nks[0].r.saldo > 0 ? `Nachzahlung ${eur(nks[0].r.saldo)}` : `Guthaben ${eur(-nks[0].r.saldo)}`) : "–"}</b></div>
        </div>
        <div class="card"><h2>📁 Akte vollständig?</h2>${check.items.map((i) => `<div class="small">${i.ok ? "✅" : i.optional ? "▫️" : "⚠️"} ${esc(i.label)} ${!i.ok ? `<span class="inline" style="display:inline-flex">${upload(i.k)}</span>` : ""}</div>`).join("") || '<p class="muted small">Kein Vertrag.</p>'}</div>
      </div></div>
      ${openNotes.length ? `<div class="card"><h2>Offene Vorgänge</h2>${openNotes.map((n) => `<div class="small click" data-act="editNote" data-id="${n.id}">${NOTE_TYPES[n.type]?.split(" ")[0] || ""} <b>${esc(n.title)}</b> <span class="muted">${d(n.date)}${n.due ? ` · fällig ${d(n.due)}` : ""}</span></div>`).join("")}</div>` : ""}`,
    dokumente: `<div class="card"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">Dokumente im Ordner</h2>
        <div class="toolbar"><select data-change="folderKind" style="width:auto">${opt(FOLDER_KINDS.map((k) => [k, DOC_KINDS[k]]), ui.folderKind || "vertrag")}</select>${upload(ui.folderKind || "vertrag")}</div></div>
      <p class="small muted" style="margin-bottom:8px">Art wählen, dann fotografieren/scannen oder PDF ablegen – das Dokument landet direkt in diesem Ordner. Mietverträge kann die KI auslesen und die Daten in den Vertrag übernehmen.</p>
      ${FOLDER_KINDS.map((k) => { const ds = docs.filter((x) => x.kind === k); return ds.length ? `<h3>${esc(DOC_KINDS[k])}</h3>${ds.map(docRow).join("")}` : ""; }).join("")}
      ${docs.filter((x) => !FOLDER_KINDS.includes(x.kind)).length ? `<h3>Weitere</h3>${docs.filter((x) => !FOLDER_KINDS.includes(x.kind)).map(docRow).join("")}` : ""}
      ${docs.length ? "" : '<p class="muted">Noch keine Dokumente – am besten mit dem Mietvertrag anfangen.</p>'}
      ${letters.length ? `<h3>Erstellte Briefe</h3>${letters.map((l) => `<div class="docline small">✉️ <a href="#/brief/${l.id}">${esc(l.subject)}</a> <span class="muted">${d(l.date)}</span></div>`).join("")}` : ""}</div>`,
    vorgaenge: `<div class="card"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">Vorgänge & Notizen</h2><div class="toolbar">${Object.entries(NOTE_TYPES).map(([k, l]) => btn("newNote", l, "sm", `${k}|${id}|${active?.id || ""}`)).join("")}</div></div>
      ${notes.length ? notes.map((n) => `<div class="timeline ${n.done ? "done" : ""}" data-act="editNote" data-id="${n.id}"><div class="small muted">${d(n.date)} · ${NOTE_TYPES[n.type] || ""}${n.due ? ` · fällig ${d(n.due)}` : ""}${n.done ? " · ✓ erledigt" : ""}</div><b>${esc(n.title)}</b>${n.text ? `<div class="small" style="white-space:pre-wrap">${esc(n.text)}</div>` : ""}</div>`).join("") : '<p class="muted">Noch keine Vorgänge. Halte hier Anrufe, Mängelmeldungen, Absprachen und Termine fest – mit Wiedervorlage.</p>'}</div>`,
    zahlungen: `<div class="card"><h2>Mietkonto</h2>
      <div class="kpis"><div class="kpi"><div class="l">Saldo 24 Monate</div><div class="v ${saldo < 0 ? "neg" : "pos"}">${eur(saldo)}</div></div><div class="kpi"><div class="l">Kaution</div><div class="v">${eur(kautionPaid)}</div><div class="s">von ${eur(active?.kaution || 0)}</div></div></div>
      ${si.filter((x) => x.diff < 0).length ? `<div class="note warn">Offen: ${si.filter((x) => x.diff < 0).map((x) => `${C.fmtMonth(x.key)} ${eur(-x.diff)}`).join(" · ")} ${btn("letterFor", "Zahlungserinnerung", "sm", `zahlungserinnerung|${active?.id}`)}</div>` : ""}
      <table>${pays.slice(0, 36).map((p) => `<tr><td class="small nowrap">${d(p.date)}</td><td class="small">${esc(C.INCOME_KINDS[p.kind])}${p.period ? " " + C.fmtMonth(p.period) : ""}</td><td class="small muted">${p.txId ? "Bank" : "bar/manuell"}</td><td class="num">${eur(p.amount)}</td></tr>`).join("") || '<tr><td class="muted">Keine Zahlungen erfasst.</td></tr>'}</table></div>`,
    vertrag: `<div class="card"><h2>Mietverhältnisse</h2>${cs.map((c) => `<div class="tl"><b>${esc(unitLabel(byId("units", c.unitId)))}</b> <span class="small muted">${d(c.start)} – ${c.end ? d(c.end) : "unbefristet"}</span>
      <div class="small">Kalt ${eur(c.kalt)} · NK ${eur(c.nk)}${c.extra ? ` · Zuschläge ${eur(c.extra)}` : ""} · Kaution ${eur(c.kaution || 0)}${c.kuendigungsfrist ? ` · Kündigungsfrist: ${esc(c.kuendigungsfrist)}` : ""}</div>
      ${(c.steps || []).length ? `<div class="small">Mietanpassungen: ${c.steps.map((s) => `ab ${C.fmtMonth(s.from)} kalt ${eur(s.kalt ?? c.kalt)}`).join(" · ")}</div>` : ""}
      ${(c.sonstigeBk || []).length ? `<div class="small">Vereinbarte sonstige Betriebskosten: ${c.sonstigeBk.map(esc).join(", ")}</div>` : ""}
      ${(c.besonderheiten || []).length ? `<div class="small">Besonderheiten: ${c.besonderheiten.map(esc).join(" · ")}</div>` : ""}
      ${c.moveIn ? `<div class="small">🔑 Einzug: Übergabe ${d(c.moveIn.handover)}${c.moveIn.keys ? `, ${c.moveIn.keys} Schlüssel` : ""}${c.moveIn.note ? ` – ${esc(c.moveIn.note)}` : ""} <a href="#/protokoll/${c.id}/in">Protokoll</a></div>` : ""}
      ${c.moveOut ? `<div class="small">📦 Auszug: Rückgabe ${d(c.moveOut.handover)}${c.moveOut.note ? ` – ${esc(c.moveOut.note)}` : ""} <a href="#/protokoll/${c.id}/out">Protokoll</a></div>` : ""}
      ${legalNotes(contractLegal(c))}
      <div class="toolbar" style="margin-top:4px">${btn("editContract", "Vertrag bearbeiten", "sm", c.id)}${btn("addStep", "Mietanpassung", "sm", c.id)}${!c.end ? btn("moveWizard", "Auszug / Mieterwechsel", "sm", c.unitId) : ""}</div></div>`).join("") || '<p class="muted">Kein Mietvertrag.</p>'}</div>`,
    nebenkosten: `<div class="grid g2"><div class="card"><h2>Nebenkostenabrechnungen</h2>${nks.map(({ st, r: rr }) => `<div class="small">${d(st.from)}–${d(st.to)}: ${rr.saldo > 0 ? `<span class="neg">Nachzahlung ${eur(rr.saldo)}</span>` : `<span class="pos">Guthaben ${eur(-rr.saldo)}</span>`} <a href="#/nkbrief/${st.id}/${rr.contractId}">Anschreiben</a></div>`).join("") || '<p class="muted small">Noch keine.</p>'}</div>
      <div class="card"><h2>Zählerstände</h2>${readings.length ? `<table>${readings.map((x) => `<tr><td class="small">${d(x.date)}</td><td class="small">${esc(C.METER_TYPES[x.type])}</td><td class="num">${String(x.value).replace(".", ",")}</td><td class="small muted">${esc(x.reason || "")}</td></tr>`).join("")}</table>` : '<p class="muted small">Keine Zählerstände.</p>'}
        ${active ? btn("newReading", "+ Zählerstand", "sm", active.id) : ""}</div></div>`,
  }[tab];
  return head(`📁 ${t.name}`, [u && esc(unitLabel(u)), t.phone && `<a href="tel:${esc(t.phone)}">${esc(t.phone)}</a>`, t.email && `<a href="mailto:${esc(t.email)}">${esc(t.email)}</a>`].filter(Boolean).join(" · "),
    btn("editTenant", "✎ Name & Kontakt", "", id) + (active ? btn("editContract", "✎ Miete & Vertrag", "", active.id) : "") + (active && !active.end && active.start <= today() ? btn("moveWizard", "Auszug / Mieterwechsel", "", active.unitId) : "") + btn("newNote", "+ Vorgang", "", `notiz|${id}|${active?.id || ""}`) + btn("letterFor", "✉ Brief", "", `zahlungserinnerung|${active?.id || ""}`) + `<a class="btn" href="#/auskunft/${id}">🛡 Datenauskunft</a>` + btn("deleteTenant", "🗑 Löschen", "danger", id)) + `
    <div class="tabs">${tabs.map(([k, l]) => `<button data-act="folderTab" data-id="${k}" class="${tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    ${body}`;
}

// Mietvertrag per KI auslesen und Daten (auf Wunsch) übernehmen
async function leaseRead(v) {
  const [docId, contractId] = v.split("|");
  if (!K.hasKey()) { toast("Für die KI bitte unter Einstellungen den API-Schlüssel eintragen."); return; }
  const doc = byId("documents", docId), blob = await getDocBlob(docId);
  if (!blob) return toast("Datei nicht gefunden");
  ui.kiBusy = { ...(ui.kiBusy || {}), [docId]: true }; render();
  try {
    const x = await K.readLease({ base64: await F.blobToBase64(blob), mediaType: doc.type });
    doc.ki = x; persist();
    leaseApplyDialog(contractId, x);
  } catch (e) { alert("Auslesen fehlgeschlagen: " + K.friendlyError(e)); }
  finally { delete ui.kiBusy[docId]; render(); }
}

function leaseApplyDialog(contractId, x) {
  const c = byId("contracts", contractId);
  const cents = (n) => Math.round((Number(n) || 0) * 100);
  const nk = cents(x.nebenkosten_vz) + cents(x.heizkosten_vz);
  const rows = [
    ["start", "Mietbeginn", c?.start ? d(c.start) : "–", x.mietbeginn ? d(x.mietbeginn) : ""],
    ["end", "Mietende (Befristung)", c?.end ? d(c.end) : "–", x.mietende ? d(x.mietende) : ""],
    ["kalt", "Kaltmiete", eur(c?.kalt || 0), x.kaltmiete ? eur(cents(x.kaltmiete)) : ""],
    ["nk", "NK-/Heizkosten-Vorauszahlung", eur(c?.nk || 0), nk ? eur(nk) : ""],
    ["extra", "Zuschläge", eur(c?.extra || 0), x.zuschlaege ? eur(cents(x.zuschlaege)) : ""],
    ["kaution", "Kaution", eur(c?.kaution || 0), x.kaution ? eur(cents(x.kaution)) : ""],
    ["mietart", "Mietart", c?.mietart || "standard", x.mietart],
    ["persons", "Personen", c?.persons || "–", x.personen || ""],
  ].filter((r) => r[3] !== "" && String(r[2]) !== String(r[3]));
  dialog({
    title: `Mietvertrag ausgelesen (Sicherheit: ${x.confidence})`, wide: true, submit: "Ausgewählte Daten übernehmen",
    body: `<p class="small" style="margin-bottom:8px">Mieter: <b>${esc(x.mieter.join(", "))}</b> · ${esc(x.einheit)} · ${esc(x.objekt_adresse)}${x.flaeche_m2 ? ` · ${String(x.flaeche_m2).replace(".", ",")} m²` : ""}</p>
      ${rows.length ? `<table class="lines"><thead><tr><th></th><th>Feld</th><th>bisher in der App</th><th>laut Vertrag</th></tr></thead><tbody>${rows.map(([k, l, a, b]) => `<tr><td><input type="checkbox" name="f_${k}" checked></td><td>${l}</td><td class="muted">${esc(a)}</td><td><b>${esc(b)}</b></td></tr>`).join("")}</tbody></table>` : '<div class="note">Die Vertragsdaten stimmen mit der App überein. ✓</div>'}
      <div class="kv"><span>Kündigungsfrist</span><b>${esc(x.kuendigungsfrist || "–")}</b></div>
      <div class="kv"><span>Betriebskosten wirksam vereinbart</span><b>${x.bk_klausel ? "✓ ja" : "⚠️ nein / unklar"}</b></div>
      ${x.sonstige_bk.length ? `<div class="kv"><span>Sonstige Betriebskosten</span><b>${x.sonstige_bk.map(esc).join(", ")}</b></div>` : ""}
      ${x.staffeln.length ? `<div class="kv"><span>Staffeln</span><b>${x.staffeln.map((s) => `ab ${esc(s.ab)}: ${eur(cents(s.kaltmiete))}`).join(" · ")}</b></div>` : ""}
      ${x.besonderheiten.length ? `<h3>Besonderheiten</h3><ul class="small" style="margin-left:18px">${x.besonderheiten.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      ${x.risiken.length ? `<div class="note warn small"><b>⚖️ Klauseln prüfen:</b><ul style="margin-left:18px">${x.risiken.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>` : ""}
      <p class="small muted">Kündigungsfrist, sonstige Betriebskosten und Besonderheiten werden im Vertrag gespeichert. Bitte die Werte mit dem Original vergleichen.</p>`,
    onSubmit: (form) => {
      if (!c) return;
      const map = { start: x.mietbeginn, end: x.mietende, kalt: cents(x.kaltmiete), nk, extra: cents(x.zuschlaege), kaution: cents(x.kaution), mietart: x.mietart, persons: x.personen };
      for (const [k] of rows) if (form[`f_${k}`]?.checked) c[k] = map[k];
      if (x.mietart === "staffel" && x.staffeln.length && form.f_mietart?.checked !== false) c.steps = x.staffeln.map((s) => ({ from: s.ab, kalt: cents(s.kaltmiete), nk: undefined, extra: undefined }));
      Object.assign(c, { kuendigungsfrist: x.kuendigungsfrist, sonstigeBk: x.sonstige_bk, besonderheiten: x.besonderheiten, bkKlausel: x.bk_klausel });
      commit("Vertragsdaten übernommen");
    },
  });
}

function newReading(contractId) {
  const c = byId("contracts", contractId);
  formDialog({
    title: "Zählerstand erfassen", data: { date: today(), type: "wasser_kalt" },
    spec: [{ k: "type", l: "Zähler", t: "select", opts: Object.entries(C.METER_TYPES) }, { k: "date", l: "Datum", t: "date", req: 1 }, { k: "value", l: "Stand", req: 1 }, { k: "number", l: "Zählernummer" }],
    onSave: (v) => { state.meterReadings.push({ id: C.uid("m_"), unitId: c.unitId, contractId, type: v.type, date: v.date, value: Number(String(v.value).replace(",", ".")), number: v.number, reason: "ablesung" }); commit("Zählerstand gespeichert"); },
  });
}

// ---------------------------------------------------------------- Schnellsuche über alles

function searchAll(qRaw) {
  const q = C.normalize(qRaw);
  if (q.length < 2) return [];
  const hit = (s) => C.normalize(s).includes(q);
  const out = [];
  for (const t of state.tenants) if (hit(`${t.name} ${t.members} ${t.email} ${t.phone} ${(t.ibans || []).join(" ")}`)) { const c = state.contracts.find((x) => x.tenantIds.includes(t.id)); out.push({ icon: "👤", title: t.name, sub: c ? unitLabel(byId("units", c.unitId)) : "Mieter", href: `#/mieter/${t.id}` }); }
  for (const o of state.objects) if (hit(`${o.name} ${o.street} ${o.city}`)) out.push({ icon: "🏢", title: o.name, sub: [o.street, o.city].filter(Boolean).join(", "), href: "#/objekte" });
  for (const u of state.units) if (hit(`${u.name} ${C.UNIT_TYPES[u.type]} ${u.features || ""}`)) { const c = currentContract(u.id); out.push({ icon: "🚪", title: unitLabel(u), sub: c ? tenantNames(c) : "frei", href: c ? `#/mieter/${c.tenantIds[0]}` : "#/objekte" }); }
  for (const x of state.documents) if (hit(`${x.name} ${x.note} ${DOC_KINDS[x.kind] || ""}`)) { const c = byId("contracts", x.contractId); out.push({ icon: "📄", title: x.name, sub: `${DOC_KINDS[x.kind] || ""}${c ? " · " + tenantNames(c) : ""}`, href: c ? `#/mieter/${c.tenantIds[0]}` : "#/dokumente", doc: x.id }); }
  for (const r of state.repairs || []) if (hit(`${r.title} ${r.description || ""} ${r.contractor?.name || ""}`)) out.push({ icon: "🔧", title: r.title, sub: `${I.REPAIR_STATUS[r.status] || ""} · ${byId("objects", r.objectId)?.name || ""}`, href: "#/instand", repair: r.id });
  for (const n of state.notes || []) if (hit(`${n.title} ${n.text}`)) out.push({ icon: "📝", title: n.title, sub: `${d(n.date)} · ${byId("tenants", n.tenantId)?.name || ""}`, href: `#/mieter/${n.tenantId}`, folderTab: "vorgaenge" });
  for (const e of state.expenses) if (hit(`${e.vendor} ${e.note} ${e.belegNr}`)) out.push({ icon: "🧾", title: `${e.vendor} ${eur(e.amount)}`, sub: `${d(e.date)} · ${C.EXPENSE_CATEGORIES[e.category]?.label || ""}`, href: "#/ausgaben" });
  for (const b of state.bookings) if (hit(`${b.guest} ${b.email || ""}`)) out.push({ icon: "☀", title: b.guest, sub: `${d(b.from)}–${d(b.to)} · ${byId("units", b.unitId)?.name || ""}`, href: "#/ferien" });
  for (const i of state.invoices) if (hit(`${i.number} ${i.recipient?.name || ""} ${i.recipient?.company || ""}`)) out.push({ icon: "▤", title: `${i.number || "Entwurf"} ${C.recipientName(i.recipient)}`, sub: eur(C.invoiceTotals(i).gross), href: `#/rechnung/${i.id}` });
  for (const l of state.letters || []) if (hit(l.subject)) out.push({ icon: "✉", title: l.subject, sub: d(l.date), href: `#/brief/${l.id}` });
  return out.slice(0, 40);
}

function viewSearch() {
  const res = searchAll(ui.globalQ || "");
  return head("Suche", ui.globalQ ? `„${esc(ui.globalQ)}“ – ${res.length} Treffer` : "Suchbegriff eingeben") + `<div class="card">${res.map((r) => `<a class="result" href="${r.href}" ${r.folderTab ? `data-folder-tab="${r.folderTab}"` : ""}><span class="ic">${r.icon}</span><span><b>${esc(r.title)}</b><br><span class="small muted">${esc(r.sub)}</span></span></a>`).join("") || '<p class="muted">Keine Treffer.</p>'}</div>`;
}

// ---------------------------------------------------------------- Nebenkosten-Assistent (geführte Abfrage)

function nkWizState() {
  if (!ui.nkWiz) {
    const ly = Number(today().slice(0, 4)) - 1;
    const objectId = ui.nk?.objectId || state.objects[0]?.id;
    const w = { objectId, from: `${ly}-01-01`, to: `${ly}-12-31`, step: 1, answers: Object.fromEntries(B.QUESTIONS.map((q) => [q.id, q.opts[0][0]])), sonstige: [], items: {}, research: {} };
    const saved = state.settings.nkWizard?.[objectId];
    if (saved) Object.assign(w, { answers: { ...w.answers, ...saved.answers }, sonstige: saved.sonstige || [] });
    ui.nkWiz = w;
  }
  return ui.nkWiz;
}

function wizPrefill(w) {
  const found = C.nkItemsFromExpenses(state, w.objectId, w.from, w.to);
  for (const c of B.relevantItems(w.answers)) {
    if (w.items[c.id]) continue;
    const f = found.find((x) => x.kind === c.id);
    w.items[c.id] = { use: !!f, amount: f?.amount || 0, key: c.key, expenseIds: f?.expenseIds || [], label: c.label.split(" (")[0] };
  }
  for (const sid of w.sonstige) {
    const so = B.SONSTIGE.find((x) => x.id === sid);
    if (!w.items[`s_${sid}`]) w.items[`s_${sid}`] = { use: true, amount: 0, key: "flaeche", expenseIds: [], label: so.label, sonstige: true };
  }
}

function viewNkWizard() {
  if (!state.objects.length) return head("Nebenkosten-Assistent") + '<div class="card muted">Bitte zuerst ein Objekt anlegen.</div>';
  const w = nkWizState();
  const steps = ["Grundlagen", "Kosten abfragen", "Prüfen & übernehmen"];
  const stepper = `<div class="stepper">${steps.map((s, i) => `<span class="${w.step === i + 1 ? "on" : w.step > i + 1 ? "done" : ""}">${i + 1}. ${s}</span>`).join("")}</div>`;
  if (w.step === 1) {
    return head("Nebenkosten-Assistent", "Ich frage dich Schritt für Schritt ab, was du umlegen kannst – vermieterfreundlich und rechtssicher", `<a class="btn" href="#/nebenkosten">Zur normalen Ansicht</a>`) + stepper + `
      <form class="card" data-form="nkwiz1"><div class="fgrid">
        <label class="f"><span>Objekt</span><select name="objectId">${opt(state.objects.map((o) => [o.id, o.name]), w.objectId)}</select></label>
        <div class="inline"><label class="f"><span>Abrechnungszeitraum von</span><input type="date" name="from" value="${w.from}"></label><label class="f"><span>bis</span><input type="date" name="to" value="${w.to}"></label></div></div>
        ${B.QUESTIONS.map((q) => `<div class="q"><div>${esc(q.label)}</div><div class="checks">${q.opts.map(([v, l]) => `<label><input type="radio" name="q_${q.id}" value="${v}" ${w.answers[q.id] === v ? "checked" : ""}> ${l}</label>`).join("")}</div></div>`).join("")}
        <div class="q"><div>Welche <b>sonstigen Betriebskosten</b> stehen ausdrücklich in deinen Mietverträgen? <span class="small muted">(nur diese dürfen zusätzlich umgelegt werden)</span></div>
          <div class="checks">${B.SONSTIGE.map((x) => `<label title="${esc(x.note)}"><input type="checkbox" name="sonstige" value="${x.id}" ${w.sonstige.includes(x.id) ? "checked" : ""}> ${esc(x.label)}</label>`).join("")}</div></div>
        <div class="toolbar" style="margin-top:12px"><button class="btn primary">Weiter: Kosten abfragen →</button></div>
      </form>`;
  }
  wizPrefill(w);
  const items = [...B.relevantItems(w.answers).map((c) => ({ id: c.id, c })), ...w.sonstige.map((sid) => ({ id: `s_${sid}`, c: { label: B.SONSTIGE.find((x) => x.id === sid).label, nr: 17, incl: [], excl: [], tips: [B.SONSTIGE.find((x) => x.id === sid).note].filter(Boolean), key: "flaeche" } }))];
  const objExp = state.expenses.filter((e) => e.objectId === w.objectId && e.date >= w.from && e.date <= w.to);
  const hidden = objExp.filter((e) => !C.EXPENSE_CATEGORIES[e.category]?.umlage && !e.betrkv && typeof e.umlageAmount !== "number").map((e) => ({ e, hint: B.HIDDEN_HINTS.find(([re]) => re.test(`${e.vendor} ${e.note}`))?.[1] })).filter((x) => x.hint);
  const total = sum(Object.values(w.items).filter((x) => x.use), (x) => x.amount);
  if (w.step === 2) {
    return head("Nebenkosten-Assistent", `${esc(byId("objects", w.objectId)?.name)} · ${d(w.from)} – ${d(w.to)}`, `<a class="btn" href="#/nebenkosten">Zur normalen Ansicht</a>`) + stepper + `
      ${w.answers.vertrag !== "ja" ? `<div class="note warn"><b>Wichtig:</b> Betriebskosten dürfen nur umgelegt werden, wenn der Mietvertrag es vorsieht. ${w.answers.vertrag === "nein" ? "Bei Pauschale oder Inklusivmiete ist keine Abrechnung möglich." : "Bitte den Mietvertrag prüfen – üblich ist „Betriebskosten gemäß § 2 BetrKV“."}</div>` : ""}
      ${hidden.length ? `<div class="note"><b>💡 Mögliche umlagefähige Anteile in deinen Ausgaben:</b>${hidden.map(({ e, hint }) => `<div class="small">${d(e.date)} ${esc(e.vendor)} ${eur(e.amount)} – ${esc(hint)} ${btn("editExpense", "zuordnen", "sm link", e.id)}</div>`).join("")}</div>` : ""}
      ${items.map(({ id, c }) => { const it = w.items[id]; const r = w.research[id];
        return `<div class="card wiz ${it.use ? "" : "off"}">
          <div class="head" style="margin-bottom:6px"><div><h2 style="margin:0">${c.nr ? `<span class="badge grey">Nr. ${c.nr}</span> ` : ""}${esc(c.label)}</h2></div>
            <div class="checks"><label><input type="radio" name="use_${id}" data-wizitem="${id}" data-f="use" value="1" ${it.use ? "checked" : ""}> Kosten vorhanden</label><label><input type="radio" name="use_${id}" data-wizitem="${id}" data-f="use" value="0" ${!it.use ? "checked" : ""}> nicht vorhanden</label></div></div>
          ${it.use ? `<div class="inline" style="margin-bottom:6px"><label class="small">Gesamtkosten im Zeitraum (€) <input inputmode="decimal" data-wizitem="${id}" data-f="amount" value="${esc(C.fmtNum(it.amount))}" style="width:130px"></label>
            <label class="small">verteilen nach <select data-wizitem="${id}" data-f="key">${opt(Object.entries(C.NK_KEYS), it.key)}</select></label>
            ${it.expenseIds.length ? `<span class="small muted">aus ${it.expenseIds.length} erfassten Ausgabe(n)</span>` : '<span class="small neg">keine Ausgabe erfasst – Beleg scannen oder Betrag eintragen</span>'}</div>` : ""}
          <details ${it.use ? "" : ""}><summary class="small">Was gehört dazu? Tipps</summary><div class="small cols">
            ${c.incl.length ? `<div><b class="pos">✓ umlagefähig</b><ul>${c.incl.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
            ${c.excl.length ? `<div><b class="neg">✗ nicht umlagefähig</b><ul>${c.excl.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
            ${c.tips.length ? `<div><b>💡 Vermieter-Tipp</b><ul>${c.tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}</div></details>
          <div style="margin-top:6px">${btn("wizResearch", ui.researchBusy === id ? "⏳ recherchiert im Internet …" : "🔎 Im Internet prüfen (KI)", "sm", id)}</div>
          ${r ? `<div class="note small research">${fmtAnswer(r.text)}${r.sources.length ? `<div class="muted" style="margin-top:6px">Quellen: ${r.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title.slice(0, 60))}</a>`).join(" · ")}</div>` : ""}</div>` : ""}
        </div>`; }).join("")}
      <div class="card"><div class="head" style="margin:0"><div><b>Umlagefähig gesamt: ${eur(total)}</b></div><div class="toolbar">${btn("wizStep", "← Zurück", "", 1)}${btn("wizResearchAll", "🔎 Gesamtcheck im Internet", "")}${btn("wizStep", "Weiter: Prüfen →", "primary", 3)}</div></div>
        ${w.research._all ? `<div class="note small research" style="margin-top:10px">${fmtAnswer(w.research._all.text)}${w.research._all.sources.length ? `<div class="muted" style="margin-top:6px">Quellen: ${w.research._all.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title.slice(0, 60))}</a>`).join(" · ")}</div>` : ""}</div>` : ""}</div>`;
  }
  const used = items.filter(({ id }) => w.items[id].use && w.items[id].amount);
  const missing = items.filter(({ id }) => w.items[id].use && !w.items[id].amount);
  return head("Nebenkosten-Assistent", `${esc(byId("objects", w.objectId)?.name)} · ${d(w.from)} – ${d(w.to)}`, "") + stepper + `
    <div class="card"><h2>Zusammenfassung</h2><table>${used.map(({ id }) => `<tr><td>${esc(w.items[id].label)}</td><td class="small">${esc(C.NK_KEYS[w.items[id].key])}</td><td class="num">${eur(w.items[id].amount)}</td></tr>`).join("")}</table>
      <p style="margin-top:8px"><b>Summe umlagefähig: ${eur(total)}</b></p>
      ${missing.length ? `<div class="note warn">Ohne Betrag: ${missing.map(({ id }) => esc(w.items[id].label)).join(", ")} – diese werden nicht übernommen.</div>` : ""}
      <p class="small muted">Nach der Übernahme siehst du die Verteilung je Mieter (tagegenau, Leerstand beim Vermieter), kannst Verbrauchswerte aus den Zählerständen übernehmen und die Anschreiben drucken.</p>
      <div class="toolbar">${btn("wizStep", "← Zurück", "", 2)}${btn("wizApply", "In Nebenkostenabrechnung übernehmen →", "primary")}</div></div>`;
}

async function wizResearch(id) {
  if (!K.hasKey()) return toast("Für die Internet-Recherche bitte unter Einstellungen den KI-Schlüssel eintragen.");
  const w = nkWizState();
  const label = id === "_all" ? null : (w.items[id]?.label || id);
  const q = id === "_all"
    ? `Ich erstelle als Vermieter die Betriebskostenabrechnung für ${d(w.from)}–${d(w.to)}. Geplante Positionen: ${Object.values(w.items).filter((x) => x.use).map((x) => `${x.label} ${eur(x.amount)} nach ${C.NK_KEYS[x.key]}`).join("; ")}. Situation: ${B.QUESTIONS.map((qq) => `${qq.label} → ${qq.opts.find((o) => o[0] === w.answers[qq.id])?.[1]}`).join(" | ")}. Prüfe anhand aktueller Rechtslage und Rechtsprechung: Ist alles umlagefähig? Was könnte ich zusätzlich rechtssicher umlegen, was oft vergessen wird? Gibt es aktuelle Änderungen (z. B. Kabel-TV, CO2-Kostenaufteilung nach CO2KostAufG bei Gas/Öl)?`
    : `Ist folgende Position in der Betriebskostenabrechnung einer Wohnung umlagefähig und was genau darf darunter abgerechnet werden: „${label}“? Bitte vermieterfreundlich, aber rechtssicher beantworten, mit aktueller Rechtsprechung.`;
  ui.researchBusy = id; render();
  try { w.research[id] = await K.research(q); }
  catch (e) { alert("Recherche fehlgeschlagen: " + K.friendlyError(e)); }
  ui.researchBusy = null; render();
}

// ---------------------------------------------------------------- Live-Synchronisation (Bank, Smoobu, iCal)

const SYNC_TOKEN_KEY = "hausops-immo-sync-token";
const getSyncToken = () => { try { return localStorage.getItem(SYNC_TOKEN_KEY) || ""; } catch { return ""; } };

async function callFn(name, body) {
  const headers = { "Content-Type": "application/json" };
  if (isCloud()) { const s = await Cloud.session(); if (s) headers.Authorization = `Bearer ${s.access_token}`; }
  const tok = getSyncToken(); if (tok) headers["X-Immo-Token"] = tok;
  const res = await fetch(`/.netlify/functions/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({ success: false, error: `Funktion ${name} nicht erreichbar (${res.status}) – läuft die App über Netlify?` }));
  if (!res.ok || !out.success) throw Object.assign(new Error(out.error || `Fehler ${res.status}`), { status: res.status });
  return out;
}

const syncStatus = () => (state.settings.sync ||= { bank: {}, ical: {}, smoobu: null });

// Alles abrufen, was verbunden ist. silent = beim Start/automatisch (nur bei Neuigkeiten melden)
async function syncAll({ silent = false } = {}) {
  if (ui.syncing || (isCloud() && !canWrite())) return;
  const bankAccs = state.accounts.filter((a) => a.eb?.uid);
  const feeds = fewoUnits().flatMap((u) => (u.icalFeeds || []).map((f) => ({ ...f, unitId: u.id })));
  const smoobu = !!state.settings.smoobuAuto;
  if (!bankAccs.length && !feeds.length && !smoobu) { if (!silent) toast("Noch nichts verbunden – Bank unter „Bank“, Kalender unter „Ferienwohnung“ verbinden."); return; }
  ui.syncing = true; setSyncBadge();
  const st = syncStatus(), msgs = [], errors = [];
  let newTx = 0, assigned = 0;
  for (const a of bankAccs) {
    try {
      if (a.eb.validUntil && a.eb.validUntil < new Date().toISOString()) { errors.push(`${a.name}: Bankfreigabe abgelaufen – neu verbinden`); continue; }
      const since = st.bank[a.id]?.at ? C.addDaysIso(st.bank[a.id].at.slice(0, 10), -7) : C.addDaysIso(today(), -90);
      const r = await callFn("immo-bank", { action: "transactions", accountUid: a.eb.uid, dateFrom: since });
      const fresh = C.mergeBankTx(state.transactions, a.id, r.transactions);
      state.transactions.push(...fresh);
      newTx += fresh.length; assigned += autoAssign(fresh);
      st.bank[a.id] = { at: new Date().toISOString(), ok: true };
    } catch (e) { st.bank[a.id] = { at: new Date().toISOString(), ok: false, error: e.message }; errors.push(`${a.name}: ${e.message}`); if (e.status === 410) a.eb.validUntil = new Date(0).toISOString(); }
  }
  if (newTx) msgs.push(`${newTx} neue Bankumsätze (${assigned} automatisch zugeordnet)`);
  let bAdd = 0, bUpd = 0, bCan = 0;
  for (const f of feeds) {
    try {
      const r = await callFn("immo-ical", { url: f.url });
      const m = C.mergeIcal(state.bookings, { unitId: f.unitId, feedId: f.id, channel: f.channel, events: C.parseIcs(r.ics), todayIso: today() });
      state.bookings = m.bookings; bAdd += m.added; bUpd += m.updated; bCan += m.cancelled;
      st.ical[f.id] = { at: new Date().toISOString(), ok: true };
    } catch (e) { st.ical[f.id] = { at: new Date().toISOString(), ok: false, error: e.message }; errors.push(`${f.channel}-Kalender: ${e.message}`); }
  }
  if (smoobu) {
    try { const r = await smoobuImport({ silent: true }); bAdd += r.added; bUpd += r.updated; st.smoobu = { at: new Date().toISOString(), ok: true }; }
    catch (e) { st.smoobu = { at: new Date().toISOString(), ok: false, error: e.message }; errors.push(`Smoobu: ${e.message}`); }
  }
  if (bAdd || bUpd || bCan) msgs.push(`Buchungen: ${bAdd} neu, ${bUpd} geändert${bCan ? `, ${bCan} storniert` : ""}`);
  st.lastRun = new Date().toISOString();
  ui.syncing = false;
  if (msgs.length || errors.length) commit(); else { persist(); render(); }
  if (msgs.length) toast(`🔄 ${msgs.join(" · ")}`);
  else if (!silent && !errors.length) toast("🔄 Alles aktuell – keine neuen Umsätze oder Buchungen.");
  if (errors.length && !silent) alert(`Synchronisation teilweise fehlgeschlagen:\n• ${errors.join("\n• ")}`);
  setSyncBadge();
}

function setSyncBadge() {
  const el = $("#livesync");
  if (!el) return;
  const st = syncStatus();
  el.innerHTML = ui.syncing ? "🔄 synchronisiert …" : st.lastRun ? `🔄 aktuell: ${new Date(st.lastRun).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : "";
}

function startAutoSync() {
  if (ui.autoSyncStarted) return;
  ui.autoSyncStarted = true;
  setTimeout(() => syncAll({ silent: true }), 1500);
  setInterval(() => { if (document.visibilityState === "visible") syncAll({ silent: true }); }, 15 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    const last = syncStatus().lastRun;
    if (document.visibilityState === "visible" && (!last || Date.now() - new Date(last) > 10 * 60 * 1000)) syncAll({ silent: true });
  });
}

// ---------------------------------------------------------------- Bank live verbinden (Enable Banking)

async function connectBank() {
  let banks;
  try { banks = (await callFn("immo-bank", { action: "banks", country: "DE" })).banks; }
  catch (e) { return alert(`Live-Bankanbindung nicht verfügbar: ${e.message}\n\nEinrichtung siehe README („Bank live verbinden“). Bis dahin: CSV/CAMT-Import.`); }
  dialog({
    title: "Bankkonto live verbinden", submit: "Weiter zur Bank",
    body: `<p class="small" style="margin-bottom:10px">Du wirst zu deiner Bank weitergeleitet und gibst dort mit deinem Online-Banking-Zugang <b>nur Lesezugriff</b> auf Kontostand und Umsätze frei (PSD2, lizenzierter Kontoinformationsdienst Enable Banking). Überweisungen sind damit nicht möglich. Die Freigabe gilt bis zu 180 Tage und kann jederzeit widerrufen werden.</p>
      <label class="f"><span>Bank suchen</span><input name="q" placeholder="z. B. Sparkasse, Volksbank, ING …" autocomplete="off"></label>
      <label class="f"><span>Bank</span><select name="bank" size="8" required>${opt(banks.map((b) => [b.name, b.name]), "")}</select></label>`,
    onOpen: (form) => {
      form.q.addEventListener("input", () => {
        const q = C.normalize(form.q.value);
        form.bank.innerHTML = opt(banks.filter((b) => !q || C.normalize(b.name).includes(q)).map((b) => [b.name, b.name]), "");
      });
    },
    onSubmit: (form) => {
      if (!form.bank.value) { toast("Bitte eine Bank auswählen."); return false; }
      const stateKey = C.uid("eb_");
      try { localStorage.setItem("hausops-eb-pending", JSON.stringify({ state: stateKey, bank: form.bank.value, at: Date.now() })); } catch {}
      callFn("immo-bank", { action: "connect", bank: form.bank.value, country: "DE", state: stateKey, redirectUrl: `${location.origin}${location.pathname}` })
        .then((r) => { location.href = r.url; })
        .catch((e) => alert("Verbindung konnte nicht gestartet werden: " + e.message));
    },
  });
}

// Rückkehr von der Bank: ?code=…&state=…
async function finishBankConnect() {
  const qs = new URLSearchParams(location.search);
  const code = qs.get("code"), st = qs.get("state");
  if (!code || !st?.startsWith("eb_")) return;
  history.replaceState(null, "", location.pathname + "#/bank");
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem("hausops-eb-pending") || "null"); localStorage.removeItem("hausops-eb-pending"); } catch {}
  if (!pending || pending.state !== st) return alert("Die Rückmeldung der Bank passt nicht zur gestarteten Verbindung. Bitte erneut verbinden.");
  try {
    const r = await callFn("immo-bank", { action: "session", code });
    for (const acc of r.accounts) {
      let a = state.accounts.find((x) => x.iban && C.normIban(x.iban) === C.normIban(acc.iban));
      if (!a) { a = { id: C.uid("a_"), name: `${pending.bank} ${acc.name}`.trim(), bank: pending.bank, iban: C.normIban(acc.iban) }; state.accounts.push(a); }
      a.eb = { uid: acc.uid, validUntil: r.validUntil, connectedAt: new Date().toISOString(), bank: pending.bank };
    }
    commit(`${r.accounts.length} Konto/Konten live verbunden – Umsätze werden abgerufen …`);
    await syncAll();
  } catch (e) { alert("Bankverbindung fehlgeschlagen: " + e.message); }
}

function bankLiveCard() {
  const live = state.accounts.filter((a) => a.eb?.uid);
  const st = syncStatus();
  const soon = (iso) => iso && new Date(iso) - new Date() < 14 * 864e5;
  return `<div class="card noprint"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">🔄 Live-Verbindung zur Bank</h2>
      <div class="toolbar">${live.length ? btn("syncNow", ui.syncing ? "⏳ ruft ab …" : "Jetzt abrufen", "") : ""}${btn("connectBank", "+ Bank verbinden", "primary")}</div></div>
    ${live.length ? live.map((a) => { const s = st.bank[a.id]; const expired = a.eb.validUntil && a.eb.validUntil < new Date().toISOString();
      return `<div class="kv"><span><b>${esc(a.name)}</b> <span class="small muted">${esc(a.iban || "")}</span></span><span class="small">${expired ? `<span class="badge bad">Freigabe abgelaufen</span> ${btn("connectBank", "neu verbinden", "sm link")}` : `${soon(a.eb.validUntil) ? `<span class="badge warn">Freigabe endet ${d(a.eb.validUntil.slice(0, 10))}</span> ${btn("connectBank", "verlängern", "sm link")}` : `<span class="badge ok">verbunden</span>`} ${s ? (s.ok ? `zuletzt ${new Date(s.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` : `<span class="neg" title="${esc(s.error)}">Fehler beim Abruf</span>`) : ""}`} ${btn("unlinkBank", "trennen", "sm link", a.id)}</span></div>`; }).join("")
      : '<p class="small muted">Verbinde dein Mietkonto einmal mit deiner Bank – danach kommen neue Umsätze automatisch beim Öffnen der App und alle 15 Minuten, Mieten werden sofort zugeordnet. (Lesezugriff über PSD2; die Freigabe musst du alle 180 Tage bei der Bank bestätigen.)</p>'}
  </div>`;
}

// ---------------------------------------------------------------- Kanäle der Ferienwohnung (iCal, Smoobu, Export)

function channelsCard() {
  const st = syncStatus();
  const units = fewoUnits();
  const feedUrl = (u, x) => isCloud() && u.icalToken ? `${location.origin}/.netlify/functions/immo-ical-feed?u=${wsId()}&unit=${u.id}&t=${u.icalToken}${x ? `&x=${encodeURIComponent(x)}` : ""}` : "";
  return `<div class="card noprint"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">🔄 Kanäle: Airbnb, Booking.com & Co.</h2><div class="toolbar">${btn("syncNow", ui.syncing ? "⏳ synchronisiert …" : "Jetzt synchronisieren", "")}</div></div>
    ${smoobuBox()}
    <label class="f inline small"><input type="checkbox" data-change="smoobuAuto" ${state.settings.smoobuAuto ? "checked" : ""}> <b>Smoobu automatisch abrufen</b> (empfohlen: alle Portale mit Gastnamen, Preisen und Kontaktdaten) ${st.smoobu ? `<span class="muted">· zuletzt ${new Date(st.smoobu.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}${st.smoobu.ok ? "" : ` · <span class="neg">${esc(st.smoobu.error)}</span>`}</span>` : ""}</label>
    ${units.map((u) => `<div class="channel"><b>${esc(u.name)}</b>
      ${(u.icalFeeds || []).map((f) => { const s = st.ical[f.id]; return `<div class="kv small"><span>📥 ${esc(f.channel)}-Kalender <span class="muted">${esc(f.url.slice(0, 48))}…</span></span><span>${s ? (s.ok ? `<span class="badge ok">ok</span> ${new Date(s.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : `<span class="badge bad" title="${esc(s.error)}">Fehler</span>`) : ""} ${btn("delFeed", "✕", "sm link", `${u.id}|${f.id}`)}</span></div>`; }).join("")}
      <div class="toolbar" style="margin-top:6px">${btn("addFeed", "+ Kalender importieren (iCal)", "sm", u.id)}${isCloud() ? btn("exportFeed", "📤 Export-Kalender für Portale", "sm", u.id) : ""}</div>
      ${isCloud() && u.icalToken ? `<div class="small muted" style="margin-top:6px">Export-Links (in Airbnb/Booking unter „Kalender importieren“ eintragen):<br>Airbnb: <code>${esc(feedUrl(u, "airbnb"))}</code><br>Booking.com: <code>${esc(feedUrl(u, "booking"))}</code></div>` : ""}
    </div>`).join("")}
    <p class="small muted" style="margin-top:8px">iCal liefert nur die Belegung (keine Preise/Gastnamen) – ideal gegen Doppelbuchungen. Vollständige Buchungsdaten kommen über Smoobu. Airbnb und Booking.com bieten privaten Vermietern keine offene Schnittstelle; ein Abgleich in Echtzeit ist nur über einen Channel-Manager wie Smoobu möglich.${isCloud() ? "" : " Der Export-Kalender für die Portale ist im Cloud-Modus verfügbar."}</p>
  </div>`;
}

function addFeed(unitId) {
  formDialog({
    title: "Kalender eines Portals importieren", data: { channel: "Airbnb" },
    intro: `<div class="note small">So findest du den Link: <b>Airbnb</b> → Kalender → Verfügbarkeit → Kalender verbinden → „Kalender exportieren“. <b>Booking.com</b> → Extranet → Preise & Verfügbarkeit → Kalender synchronisieren → „Kalender exportieren“. <b>FeWo-direkt/Vrbo</b> → Kalender → Import/Export.</div>`,
    spec: [{ k: "channel", l: "Portal", t: "select", opts: ["Airbnb", "Booking.com", "FeWo-direkt / Vrbo", "Traum-Ferienwohnungen", "Holidu", "Sonstige"].map((x) => [x, x]) }, { k: "url", l: "iCal-Link (https://… .ics)", req: 1, full: 1 }],
    onSave: (v) => {
      const u = byId("units", unitId);
      if (!/^(https|webcal):\/\//.test(v.url)) { toast("Bitte den vollständigen Link (https://…) einfügen."); return false; }
      u.icalFeeds = [...(u.icalFeeds || []), { id: C.uid("f_"), channel: v.channel, url: v.url.trim() }];
      commit("Kalender hinzugefügt – wird abgerufen …");
      syncAll();
    },
  });
}

// ---------------------------------------------------------------- Steuererklärung selbst machen (ELSTER-Ausfüllhilfe)

function copyField(v) { copyText(String(v)); }

function viewTaxReturn(yearArg) {
  const y = Number(yearArg) || Number(today().slice(0, 4)) - 1;
  const tab = ui.erklTab || "pruefung";
  const checks = T.taxChecks(state, y, today());
  const bad = checks.filter((c) => c.level === "bad").length;
  const s = state.settings;
  const deadline = `31.07.${y + 1}`;
  const row = (label, cents, { up = false, hint = "", zero = false } = {}) => {
    const v = up ? T.euroUp(cents) : T.euroDown(cents);
    if (!v && !zero) return "";
    return `<tr><td>${label}${hint ? `<div class="small muted">${hint}</div>` : ""}</td><td class="num"><b>${v.toLocaleString("de-DE")}</b> €</td><td>${btn("copyVal", "📋", "sm", String(v))}</td></tr>`;
  };
  const txt = (label, v) => (v ? `<tr><td>${label}</td><td class="num">${esc(v)}</td><td>${btn("copyVal", "📋", "sm", v)}</td></tr>` : "");
  const objects = state.objects.map((o) => {
    const f = T.taxFigures(state, o.id, y);
    const units = state.units.filter((u) => u.objectId === o.id);
    const fewo = units.filter((u) => u.type === "ferienwohnung");
    const onlyFewo = fewo.length && fewo.length === units.length;
    const owners = C.parseOwners(o.owners);
    const quote = fewo.length ? T.fewoUsage(state, fewo[0].id, y).costQuote : 1;
    const wk = (c) => Math.round(c * (onlyFewo ? quote : 1));
    return { o, f, fewo, onlyFewo, owners, quote, wk };
  });
  const tabs = [["pruefung", `1. Vorprüfung${bad ? ` (${bad} ⚠)` : " ✓"}`], ["anlage", "2. Anlage V / V-FeWo"], ["ust", "3. Umsatzsteuer"], ["abgabe", "4. Abgabe in ELSTER"]];
  const body = {
    pruefung: `<div class="card"><h2>Vorprüfung ${y}</h2>
      <p class="small muted" style="margin-bottom:10px">Diese Punkte prüft sonst der Steuerberater. Rote Punkte bitte vor der Abgabe klären, gelbe sind Hinweise und Chancen.</p>
      ${checks.length ? checks.map((c) => `<div class="note small ${c.level === "bad" ? "warn" : ""}">${c.level === "bad" ? "⛔" : c.level === "warn" ? "⚠️" : "ℹ️"} <b>${esc(c.area)}:</b> ${esc(c.text)} ${c.fix ? `<a href="${c.fix}">beheben →</a>` : ""}</div>`).join("") : '<div class="note">✅ Keine Auffälligkeiten gefunden.</div>'}
      <h3>Gut zu wissen – häufig vergessene Werbungskosten</h3>
      <ul class="small" style="margin-left:18px">
        <li>Fahrten zum Objekt (Besichtigung, Handwerker, Übergabe): 0,30 €/km je gefahrenem Kilometer – als Ausgabe „Fahrtkosten“ erfassen.</li>
        <li>Kontoführung des Mietkontos, Porto, Telefon, Fachliteratur, Software (auch dieses Programm), Mitgliedsbeitrag Haus & Grund.</li>
        <li>Finanzierung: Bereitstellungszinsen, Notar/Grundbuch für die Grundschuld (Geldbeschaffungskosten), Disagio.</li>
        <li>Große Reparaturen an Wohngebäuden kannst du auf 2–5 Jahre verteilen (§ 82b EStDV) – sinnvoll bei schwankendem Einkommen. Einstellbar je Ausgabe.</li>
        <li>Neubau mit Baubeginn zwischen 1.10.2023 und 30.9.2029: degressive AfA 5 % möglich (§ 7 Abs. 5a EStG); Sonder-AfA § 7b bei Mietwohnungsneubau.</li>
      </ul></div>`,
    anlage: `<div class="note small">So geht's: In <b>Mein ELSTER</b> → Formulare → Einkommensteuer ${y} → <b>Anlage V</b> (je Objekt eine) bzw. <b>Anlage V-FeWo</b> für Ferienwohnungen hinzufügen. Feldbezeichnung suchen, Wert mit 📋 kopieren und einfügen. Beträge in vollen Euro: Einnahmen abgerundet, Werbungskosten aufgerundet. Belege nicht mitschicken – nur aufbewahren.</div>
      ${objects.map(({ o, f, fewo, onlyFewo, owners, quote, wk }) => `<div class="card"><h2>${onlyFewo ? "Anlage V-FeWo" : "Anlage V"} – ${esc(o.name)}</h2>
        <table class="taxform"><tbody>
          <tr class="sec"><td colspan="3">Allgemeine Angaben</td></tr>
          ${txt("Lage des Grundstücks: Straße, Hausnummer", o.street)}${txt("Postleitzahl", o.zip)}${txt("Ort", o.city)}
          ${txt("Aktenzeichen (Grundsteuerwert-/Einheitswertbescheid)", o.aktenzeichen || "")}
          ${txt("Angeschafft am", o.purchaseDate ? d(o.purchaseDate) : "")}
          ${f.flaecheWohnen ? txt("Gesamtwohnfläche (m²)", String(f.flaecheWohnen).replace(".", ",")) : ""}
          ${owners.length > 1 ? `<tr><td colspan="3" class="small">Miteigentum: ${owners.map((x) => `${esc(x.name)} ${x.share} %`).join(", ")}${o.ehegatten ? " – Gesamtbeträge eintragen, Anteile in der Anlage angeben" : " – <b>Feststellungserklärung nötig</b> (siehe Vorprüfung)"}</td></tr>` : ""}
          ${onlyFewo ? `<tr><td colspan="3" class="small">Vermietungstage ${T.fewoUsage(state, fewo[0].id, y).rented}, Eigennutzung ${T.fewoUsage(state, fewo[0].id, y).own} Tage, Leerstand ${T.fewoUsage(state, fewo[0].id, y).empty} Tage${quote < 1 ? ` → Werbungskosten zu ${Math.round(quote * 100)} % (bereits unten berücksichtigt)` : ""}</td></tr>` : ""}
          <tr class="sec"><td colspan="3">Einnahmen</td></tr>
          ${row(`Mieteinnahmen für Wohnungen (ohne Umlagen)${f.wohnungen ? ` – ${f.wohnungen} Wohnung(en)` : ""}`, f.wohnen)}
          ${row("Mieteinnahmen für andere Räume / Garagen / Stellplätze / Gewerbe (netto)", f.andere)}
          ${row(onlyFewo ? "Einnahmen aus der Vermietung der Ferienwohnung (netto, ohne Kurtaxe)" : "Einnahmen Ferienwohnung (netto)", f.fewo)}
          ${row("Einnahmen aus Umlagen (Nebenkosten-Vorauszahlungen und -Nachzahlungen)", f.umlagen)}
          ${row("Vereinnahmte Umsatzsteuer", f.ustEingenommen, { hint: "nur bei Regelbesteuerung" })}
          ${row("Sonstige Einnahmen", f.sonstige)}
          ${row("davon: Mieten für frühere Jahre (Nachzahlungen)", f.nachzahlungVorjahre, { hint: "nur zur Information – sind oben enthalten (Zuflussprinzip)" })}
          <tr class="sec"><td colspan="3">Werbungskosten</td></tr>
          ${row(`Absetzung für Abnutzung (AfA) – linear ${String(o.afaRate || 0).replace(".", ",")} %`, wk(f.afa), { up: true, hint: o.buildingShare ? `Bemessungsgrundlage Gebäude ${eur(o.buildingShare)}` : "" })}
          ${row("Schuldzinsen (laut Zinsbescheinigung, ohne Tilgung)", wk(f.zinsen), { up: true })}
          ${row("Erhaltungsaufwendungen, sofort abziehbar", wk(f.erhaltung), { up: true })}
          ${row(`Erhaltungsaufwendungen – auf mehrere Jahre verteilt (§ 82b EStDV), Anteil ${y}`, wk(f.erhaltungVerteilt), { up: true })}
          ${row("Grundsteuer, Straßenreinigung, Müll, Wasser, Entwässerung, Heizung, Schornstein, Versicherungen, Hauswart, Treppenreinigung …", wk(f.betrieb), { up: true })}
          ${row("Verwaltungskosten (Hausverwaltung, Steuerberatung, Software, Bankgebühren)", wk(f.verwaltung), { up: true })}
          ${row("Sonstige Werbungskosten (Fahrtkosten, Portal-Provisionen, Reinigung FeWo, Hausgeld-Anteile …)", wk(f.sonstigeWk), { up: true })}
          ${row("An das Finanzamt gezahlte Umsatzsteuer / Vorsteuer", wk(f.vorsteuer), { up: true, hint: "nur bei Regelbesteuerung" })}
          <tr class="sum"><td>Überschuss / Verlust (zur Kontrolle, ELSTER rechnet selbst)</td><td class="num"><b>${eur(f.einnahmen - (onlyFewo ? Math.round(f.werbungskosten * quote) : f.werbungskosten))}</b></td><td></td></tr>
        </tbody></table></div>`).join("") || '<div class="card muted">Noch keine Objekte.</div>'}`,
    ust: (() => {
      if (s.kleinunternehmer) return `<div class="card"><h2>Umsatzsteuer</h2><p>Du bist als <b>Kleinunternehmer</b> (§ 19 UStG) eingestellt: keine Umsatzsteuer-Voranmeldungen. Prüfe jährlich die Grenzen: Vorjahresumsatz höchstens 25.000 €, laufendes Jahr höchstens 100.000 € (seit 2025). Wohnungsmieten zählen als steuerfreie Umsätze nicht mit.</p></div>`;
      const q = [1, 2, 3, 4].map((n) => { const m1 = String((n - 1) * 3 + 1).padStart(2, "0"); const m3 = (n - 1) * 3 + 3; return { label: `${n}. Quartal ${y}`, ...T.ustVa(state, `${y}-${m1}-01`, `${y}-${String(m3).padStart(2, "0")}-${C.daysInMonth(`${y}-${String(m3).padStart(2, "0")}`)}`) }; });
      const yr = T.ustVa(state, `${y}-01-01`, `${y}-12-31`);
      const kz = (v, label) => `<td class="num">${(v / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} ${btn("copyVal", "📋", "sm", (v / 100).toFixed(2).replace(".", ","))}</td>`;
      return `<div class="card"><h2>Umsatzsteuer-Voranmeldung</h2>
        <p class="small muted" style="margin-bottom:8px">Für Ferienwohnung (7 %) und separat vermietete Stellplätze (19 %) bei Regelbesteuerung. In Mein ELSTER: Formulare → Umsatzsteuer → <b>Umsatzsteuer-Voranmeldung</b> (monatlich, wenn die Steuer im Vorjahr über 9.000 € lag, sonst vierteljährlich – bei höchstens 2.000 € kann das Finanzamt davon befreien; Abgabe bis zum 10. des Folgemonats). Grundlage: vereinnahmte Entgelte (Ist-Versteuerung). Vorsteuer aus Rechnungen bei den Ausgaben im Feld „Vorsteuer“ erfassen.</p>
        <div class="table-wrap"><table><thead><tr><th>Zeitraum</th><th class="num">Kz 81 Umsätze 19 % (netto)</th><th class="num">Kz 86 Umsätze 7 % (netto)</th><th class="num">Kz 66 Vorsteuer</th><th class="num">Zahllast / Erstattung</th></tr></thead><tbody>
          ${q.map((x) => `<tr><td>${x.label}</td>${kz(x.kz81)}${kz(x.kz86)}${kz(x.kz66)}<td class="num ${x.zahllast < 0 ? "pos" : ""}"><b>${eur(x.zahllast)}</b></td></tr>`).join("")}
        </tbody><tfoot><tr><td>Jahr ${y} (Umsatzsteuererklärung)</td>${kz(yr.kz81)}${kz(yr.kz86)}${kz(yr.kz66)}<td class="num">${eur(yr.zahllast)}</td></tr></tfoot></table></div>
        <p class="small muted" style="margin-top:6px">Die Kennzahlen (Kz) sind die der Umsatzsteuer-Voranmeldung; in ELSTER bitte anhand der Bezeichnung kontrollieren.</p></div>`;
    })(),
    abgabe: `<div class="card"><h2>So gibst du die Erklärung ${y} selbst ab</h2>
      <ol class="steps">
        <li><b>ELSTER-Konto anlegen</b> (einmalig, kostenlos) auf <a href="https://www.elster.de" target="_blank" rel="noopener">elster.de</a> → „Benutzerkonto erstellen“ mit Zertifikatsdatei. Die Aktivierungsdaten kommen per Brief – <b>rund 2 Wochen</b> einplanen.</li>
        <li><b>Frist:</b> ohne Steuerberater in der Regel bis <b>${deadline}</b>. Wer Verluste geltend machen will oder eine Erstattung erwartet, kann auch freiwillig bis zu 4 Jahre rückwirkend abgeben.</li>
        <li>In Mein ELSTER → <b>Formulare & Leistungen → Einkommensteuer ${y}</b>. Tipp: „Belegabruf“ aktivieren – Lohn-, Renten- und Versicherungsdaten werden dann automatisch übernommen.</li>
        <li>Hauptvordruck und deine übrigen Anlagen (z. B. N, Vorsorgeaufwand, Kind) ausfüllen – das ist unabhängig von der Vermietung.</li>
        <li>Je Objekt eine <b>Anlage V</b> (Ferienwohnung: <b>Anlage V-FeWo</b>) hinzufügen und die Werte aus Schritt 2 übertragen (📋 kopieren).</li>
        <li>„<b>Prüfen</b>“ klicken – ELSTER zeigt Fehler und Hinweise. Danach „Absenden“. Belege nicht mitschicken, aber aufbewahren (8 Jahre).</li>
        <li><b>Bescheid prüfen:</b> Er kommt nach einigen Wochen. Mit der App vergleichen; bei Abweichungen innerhalb eines Monats Einspruch einlegen (geht auch über ELSTER).</li>
        ${!s.kleinunternehmer ? `<li><b>Umsatzsteuer:</b> Voranmeldungen laufend, dazu jährlich die Umsatzsteuererklärung (Schritt 3).</li>` : ""}
      </ol>
      <div class="note small">Wann sich der Steuerberater trotzdem lohnt: Miteigentum ohne Ehe (Feststellungserklärung), gewerbliche Ferienvermietung, Verkauf einer Immobilie innerhalb von 10 Jahren, große Sanierung nach dem Kauf (15-%-Grenze) oder Kaufpreisaufteilung, die das Finanzamt anzweifelt. Für den Rest bereitet die App alles so vor, dass du es sicher selbst kannst.</div>
      <p class="small muted">Keine Steuerberatung: Die App rechnet mit deinen erfassten Daten und weist auf typische Fehler hin. Für die Richtigkeit der Angaben bist du selbst verantwortlich.</p></div>`,
  }[tab];
  return head(`Steuererklärung ${y} selbst machen`, "Ausfüllhilfe für Mein ELSTER – Anlage V, Anlage V-FeWo, Umsatzsteuer", btn("erklYear", `‹ ${y - 1}`, "", y - 1) + btn("erklYear", `${y + 1} ›`, "", y + 1) + `<button class="btn primary" onclick="window.print()">🖨 Ausfüllhilfe drucken</button>`) + `
    <div class="tabs noprint">${tabs.map(([k, l]) => `<button data-act="erklTab" data-id="${k}" class="${tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    ${body}`;
}

// ---------------------------------------------------------------- Einfache Bedienung: Menü, Start „Heute zu tun“, Einrichtung, Handy-Leiste

// Menü in klaren Gruppen und Alltagssprache. Gruppen ohne Inhalt (z. B. Ferienwohnung) werden ausgeblendet.
function navGroups() {
  const hasFewo = fewoUnits().length > 0 || state.bookings.length > 0;
  return [
    [null, [["", "🏠", "Start"]]],
    ["Vermietung", [["objekte", "🏢", "Häuser & Wohnungen"], ["mieter", "👥", "Mieter"], ["mieten", "💶", "Mieteingänge"], ["nebenkosten", "🧾", "Nebenkosten"], ["instand", "🔧", "Reparaturen"], ...(isCloud() ? [["portal", "🔑", `Mieterportal${portalUnread() ? ` (${portalUnread()})` : ""}`]] : []), ["briefe", "✉️", "Briefe"]]],
    ["Geld & Belege", [["bank", "🏦", "Konto & Zahlungen"], ["ausgaben", "📉", "Ausgaben"], ["dokumente", "📷", "Belege & Dokumente"], ["ablage", "📂", "Ablage je Objekt"]]],
    ...(hasFewo ? [["Ferienwohnung", [["ferien", "🏖️", "Belegung & Buchungen"], ["rechnungen", "🧾", "Gäste-Rechnungen"]]]] : []),
    ["Steuer", [["erklaerung", "🧮", "Steuererklärung"], ["monat", "📬", "Monatsbericht StB"], ["steuer", "📊", "Anlage V & DATEV"]]],
    ["Mehr", [["ki", "✨", "KI-Assistent"], ...(isCloud() ? [["konto", "👤", "Mein Konto"]] : []), ...(isAdmin() ? [["admin", "🛡️", "Admin"]] : []), ["einstellungen", "⚙️", "Einstellungen"]]],
  ];
}

// Welcher Menüpunkt gehört zur aktuellen Seite?
function navKeyFor(route) {
  return { rechnung: "rechnungen", bericht: "steuer", paket: "steuer", nkbrief: "nebenkosten", nkassistent: "nebenkosten", brief: "briefe", protokoll: "mieter", auskunft: "mieter" }[route] ?? route;
}

function navHtml(route) {
  const active = navKeyFor(route);
  return navGroups().map(([title, items]) => `${title ? `<div class="navgroup">${title}</div>` : ""}${items.map(([r, ic, l]) => `<a href="#/${r}" class="${active === r ? "active" : ""}"><span class="ic">${ic}</span>${l}</a>`).join("")}`).join("");
}

// Untere Leiste am Handy
function tabbarHtml(route) {
  const a = navKeyFor(route);
  const t = (href, ic, l, on) => `<a href="${href}" class="${on ? "on" : ""}"><span>${ic}</span>${l}</a>`;
  return t("#/", "🏠", "Start", a === "") + t("#/mieter", "👥", "Mieter", a === "mieter") +
    `<button class="plus" data-act="quickAdd" aria-label="Neu erfassen">＋</button>` +
    t("#/bank", "🏦", "Geld", ["bank", "ausgaben", "mieten"].includes(a)) + `<button data-act="openMenu"><span>☰</span>Menü</button>`;
}

function openMenu() {
  dialog({ title: "Menü", body: `<nav class="menu-sheet">${navHtml(location.hash.replace(/^#\/?/, "").split("/")[0])}${isCloud() ? `<button class="logout-btn wide" data-act="logout">⎋ Abmelden</button>` : ""}</nav>` });
  $("#modal").classList.add("sheet");
  $("#modal .menu-sheet").addEventListener("click", (e) => { if (e.target.closest("a")) $("#modal").close(); });
}

// „＋“: die häufigsten Aufgaben mit einem Tipp
function quickAdd() {
  const tile = (ic, l, attrs) => `<button class="qtile" ${attrs}><span>${ic}</span>${l}</button>`;
  dialog({
    title: "Was möchtest du erfassen?",
    body: `<div class="qgrid">
      <label class="qtile"><span>📷</span>Beleg fotografieren<input type="file" accept="image/*" capture="environment" data-change="docScan" hidden></label>
      <label class="qtile"><span>📄</span>PDF / Datei ablegen<input type="file" accept="image/*,application/pdf" multiple data-change="docUpload" hidden></label>
      ${tile("🔑", "Neuer Mieter / Einzug", 'data-act="moveWizard" data-id=""')}
      ${tile("📉", "Ausgabe erfassen", 'data-act="newExpense"')}
      ${tile("💶", "Miete bar erhalten", 'data-act="newPayment"')}
      ${tile("🔧", "Reparatur / Schaden", 'data-act="editRepair" data-id=""')}
      ${tile("📝", "Notiz", 'data-act="quickNote"')}
      ${fewoUnits().length ? tile("🏖️", "Ferien-Buchung", 'data-act="newBooking"') : ""}
      ${tile("🏢", "Haus / Wohnung", 'data-act="newObject"')}
    </div>`,
  });
  $("#modal").classList.add("sheet");
  $("#modal .qgrid").addEventListener("click", (e) => { if (e.target.closest("button.qtile")) $("#modal").close(); });
  $("#modal .qgrid").addEventListener("change", () => setTimeout(() => $("#modal").open && $("#modal").close(), 0));
}

function quickNote() {
  const ts = state.tenants.filter((t) => state.contracts.some((c) => c.tenantIds.includes(t.id) && (!c.end || c.end >= today())));
  if (!ts.length) return toast("Noch keine Mieter – zuerst einen Mieter eintragen.");
  formDialog({
    title: "Notiz oder Mangel erfassen", data: { type: "mangel", tenantId: ts[0].id },
    spec: [{ k: "tenantId", l: "Zu welchem Mieter?", t: "select", opts: ts.map((t) => [t.id, t.name]), full: 1 }, { k: "type", l: "Art", t: "select", opts: Object.entries(NOTE_TYPES) }],
    onSave: (v) => { setTimeout(() => editNote(null, { type: v.type, tenantId: v.tenantId, contractId: state.contracts.find((c) => c.tenantIds.includes(v.tenantId))?.id || "" }), 50); },
  });
}

// Alles, was gerade zu tun ist – mit einem Knopf zum Erledigen
function buildTodos() {
  const t = [], y = Number(today().slice(0, 4)), key = C.monthKey(today());
  const open = state.transactions.filter((x) => !x.link);
  if (open.length) {
    const good = open.filter((x) => (C.suggestAssignment(x, state)?.score || 0) >= 60).length;
    t.push({ ic: "🏦", text: `${open.length} Kontobewegung${open.length > 1 ? "en" : ""} zuordnen${good ? ` – ${good} kann die App sofort erledigen` : ""}`, btn: good ? btnRaw("acceptAll", `✓ ${good} übernehmen`) : `<a class="btn sm primary" href="#/bank">Ansehen</a>` });
  }
  const back = C.sollIst(state, C.addMonths(key, -11), key).filter((r) => r.diff < 0);
  const byC = {};
  for (const r of back) byC[r.contractId] = (byC[r.contractId] || 0) - r.diff;
  for (const [cid, v] of Object.entries(byC).slice(0, 3)) t.push({ ic: "⚠️", text: `${esc(tenantNames(byId("contracts", cid)))} ist mit ${eur(v)} im Rückstand`, btn: btnRaw("letterFor", "Erinnerung schreiben", `zahlungserinnerung|${cid}`) });
  for (const n of openTasks().slice(0, 3)) t.push({ ic: n.type === "mangel" ? "🔧" : "📅", text: `${esc(n.title)} – ${esc(byId("tenants", n.tenantId)?.name || "")}${n.due ? ` (fällig ${d(n.due)})` : ""}`, btn: `<a class="btn sm" href="#/mieter/${n.tenantId}" data-folder-tab="vorgaenge">Öffnen</a>` });
  for (const r of (state.repairs || []).filter((x) => I.REPAIR_OPEN.includes(x.status) && x.priority !== "normal").slice(0, 3)) t.push({ ic: "🚨", text: `${esc(r.title)} – ${esc(byId("objects", r.objectId)?.name || "")} (${I.PRIORITIES[r.priority]})`, btn: btnRaw("editRepair", "Öffnen", r.id) });
  const newRep = (state.repairs || []).filter((x) => x.status === "gemeldet" && x.priority === "normal").length;
  if (newRep) t.push({ ic: "🔧", text: `${newRep} gemeldete Reparatur${newRep > 1 ? "en" : ""} noch nicht beauftragt`, btn: `<a class="btn sm" href="#/instand">Ansehen</a>` });
  for (const m of I.maintenanceDue(state, today()).slice(0, 3)) t.push({ ic: "🛠", text: `Wartung ${m.overdue ? "überfällig" : "fällig"}: ${esc(m.title)} – ${esc(byId("objects", m.objectId)?.name || "")} (${d(m.due)})`, btn: btnRaw("maintDone", "✓ Erledigt", m.id) });
  if (isCloud() && portalUnread()) t.push({ ic: "🔑", text: `${portalUnread()} neue Meldung${portalUnread() > 1 ? "en" : ""} im Mieterportal`, btn: `<a class="btn sm primary" href="#/portal">Ansehen</a>` });
  { const prev = C.addMonths(C.monthKey(today()), -1), day = Number(today().slice(8, 10));
    if (day <= 15 && (state.contracts.length || state.bookings.length) && !(state.settings.monthReports || {})[prev]?.sentAt) t.push({ ic: "📬", text: `Monatsbericht ${C.fmtMonth(prev)} an den Steuerberater senden`, btn: `<a class="btn sm primary" href="#/monat/${prev}">Ansehen & senden</a>` }); }
  const inbox = state.documents.filter((x) => x.status === "neu").length;
  if (inbox) t.push({ ic: "📷", text: `${inbox} Beleg${inbox > 1 ? "e" : ""} im Eingang – buchen`, btn: `<a class="btn sm primary" href="#/dokumente">Buchen</a>` });
  const drafts = state.invoices.filter((i) => i.status === "entwurf").length;
  if (drafts) t.push({ ic: "🧾", text: `${drafts} Rechnungsentwurf${drafts > 1 ? "e" : ""} noch festschreiben`, btn: `<a class="btn sm" href="#/rechnungen">Ansehen</a>` });
  // Nebenkostenabrechnung des Vorjahres fällig?
  for (const o of state.objects) {
    const hasTenants = state.contracts.some((c) => byId("units", c.unitId)?.objectId === o.id && c.start <= `${y - 1}-12-31` && (!c.end || c.end >= `${y - 1}-01-01`));
    const done = (state.nkStatements || []).some((st) => st.objectId === o.id && st.to.startsWith(String(y - 1)));
    if (hasTenants && !done) t.push({ ic: "🧾", text: `Nebenkosten ${y - 1} für ${esc(o.name)} abrechnen – Frist 31.12.${y}`, btn: `<a class="btn sm primary" href="#/nkassistent">Starten</a>` });
  }
  const m = Number(today().slice(5, 7));
  if (m <= 7 && state.objects.length) t.push({ ic: "🧮", text: `Steuererklärung ${y - 1} vorbereiten – Frist ohne Steuerberater 31.07.${y}`, btn: `<a class="btn sm" href="#/erklaerung/${y - 1}">Starten</a>` });
  for (const a of state.accounts.filter((x) => x.eb?.validUntil && new Date(x.eb.validUntil) - new Date() < 14 * 864e5)) t.push({ ic: "🔐", text: `Bankfreigabe für ${esc(a.name)} ${a.eb.validUntil < new Date().toISOString() ? "ist abgelaufen" : "läuft bald ab"}`, btn: btnRaw("connectBank", "Erneuern") });
  const inc = state.contracts.filter((c) => c.start <= today() && (!c.end || c.end >= today()) && folderChecklist(c).missing.length).length;
  if (inc) t.push({ ic: "📁", text: `${inc} Mieterakte${inc > 1 ? "n" : ""} unvollständig (z. B. Mietvertrag fehlt)`, btn: `<a class="btn sm" href="#/mieter">Ansehen</a>` });
  const opp = R.increaseOpportunities(state, today());
  if (opp.length) t.push({ ic: "💡", text: `Mieterhöhung bei ${opp.length} Wohnung${opp.length > 1 ? "en" : ""} möglich`, btn: btnRaw("letterFor", "Brief vorbereiten", `mieterhoehung|${opp[0].contractId}`), chance: true });
  return t;
}
const btnRaw = (act, label, id = "") => `<button class="btn sm primary" data-act="${act}" ${id ? `data-id="${esc(id)}"` : ""}>${label}</button>`;

function viewStart() {
  if (!state.objects.length) return viewSetup();
  const h = new Date().getHours();
  const name = (state.settings.ownerName || auth.profile?.full_name || "").split(" ")[0];
  const key = C.monthKey(today());
  const rows = C.sollIst(state, key, key);
  const soll = sum(rows, (r) => r.soll), ist = sum(rows, (r) => r.ist);
  const todos = buildTodos();
  const tile = (ic, l, attrs) => `<a class="qtile" ${attrs}><span>${ic}</span>${l}</a>`;
  return `<div class="hello"><h1>${h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend"}${name ? `, ${esc(name)}` : ""} 👋</h1>
      <p class="muted">${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}</p></div>
    <div class="bigstats">
      <div><span>Miete ${C.MONTHS_DE[Number(key.slice(5)) - 1]}</span><b>${eur(ist)}</b><small>von ${eur(soll)}</small><div class="bar"><i style="width:${soll ? Math.min(100, Math.round((ist / soll) * 100)) : 0}%"></i></div></div>
      <div><span>Offen</span><b class="${soll - ist > 0 ? "neg" : "pos"}">${eur(Math.max(0, soll - ist))}</b><small>${rows.filter((r) => r.diff < 0).length} Mieter</small></div>
      <div><span>Einheiten</span><b>${state.units.length}</b><small>${state.units.filter((u) => u.type !== "ferienwohnung" && !currentContract(u.id)).length} frei</small></div>
    </div>
    <div class="card todo"><h2>✅ Heute zu tun</h2>
      ${todos.length ? todos.map((x) => `<div class="todoitem ${x.chance ? "chance" : ""}"><span class="ic">${x.ic}</span><span class="tx">${x.text}</span>${x.btn}</div>`).join("") : '<div class="done">🎉 Alles erledigt – nichts zu tun!</div>'}
    </div>
    <h2 class="section">Was möchtest du tun?</h2>
    <div class="qgrid">
      <label class="qtile"><span>📷</span>Beleg fotografieren<input type="file" accept="image/*" capture="environment" data-change="docScan" hidden></label>
      ${tile("🔑", "Neuer Mieter", 'href="#/mieter" data-act="moveWizard" data-id=""')}
      ${tile("🏦", "Konto abrufen", 'href="#/bank" data-act="syncNow"')}
      ${tile("💶", "Mieten prüfen", 'href="#/mieten"')}
      ${tile("🧾", "Nebenkosten", 'href="#/nkassistent"')}
      ${tile("🧮", "Steuererklärung", 'href="#/erklaerung"')}
    </div>
    <details class="more"><summary>📊 Alle Zahlen und Details anzeigen</summary>${viewDashboard().replace(/^<div class="head">[\s\S]*?<\/div><div class="toolbar noprint"><\/div><\/div>/, "")}</details>`;
}

// ---------------------------------------------------------------- Einrichtungs-Assistent für den ersten Start

function viewSetup() {
  const w = ui.setup || (ui.setup = { step: 1, counts: { haus: 0, wohnung: 1, garage: 0, stellplatz: 0, keller: 0, ferienwohnung: 0, gewerbe: 0 }, type: "mfh" });
  const s = state.settings;
  const steps = ["Über dich", "Dein Haus", "Was gehört dazu?", "Fertig"];
  const bar = `<div class="setupbar">${steps.map((x, i) => `<span class="${w.step === i + 1 ? "on" : w.step > i + 1 ? "done" : ""}">${w.step > i + 1 ? "✓" : i + 1}<em>${x}</em></span>`).join("")}</div>`;
  const types = [["mfh", "🏢", "Mehrfamilienhaus"], ["efh", "🏠", "Einfamilienhaus"], ["etw", "🚪", "Eigentumswohnung"], ["ferien", "🏖️", "Ferienwohnung / -haus"], ["garagenhof", "🚗", "Garagen / Stellplätze"]];
  const counter = (k, l, ic) => `<div class="counter"><span>${ic} ${l}</span><div><button type="button" data-act="setupCount" data-id="${k}|-1">−</button><b>${w.counts[k]}</b><button type="button" data-act="setupCount" data-id="${k}|1">＋</button></div></div>`;
  const body = {
    1: `<form data-form="setup1" class="setup"><h1>Willkommen! 👋</h1><p class="muted">In 2 Minuten ist alles eingerichtet. Zuerst: Wer vermietet?</p>
      <label class="f"><span>Dein Name (oder Firma)</span><input name="ownerName" value="${esc(s.ownerName || auth.profile?.full_name || "")}" required autocomplete="name"></label>
      <label class="f"><span>Deine Straße und Hausnummer</span><input name="ownerStreet" value="${esc(s.ownerStreet || "")}" autocomplete="street-address"></label>
      <div class="fgrid"><label class="f"><span>PLZ</span><input name="ownerZip" value="${esc(s.ownerZip || "")}" inputmode="numeric" autocomplete="postal-code"></label><label class="f"><span>Ort</span><input name="ownerCity" value="${esc(s.ownerCity || "")}" autocomplete="address-level2"></label></div>
      <button class="btn primary big">Weiter →</button>
      <p class="small muted" style="margin-top:14px">Erst mal nur umschauen? ${btn("loadDemo", "Demo-Daten ansehen", "sm")}</p></form>`,
    2: `<form data-form="setup2" class="setup"><h1>Dein erstes Haus 🏠</h1><p class="muted">Weitere kannst du später jederzeit hinzufügen.</p>
      <div class="typepick">${types.map(([k, ic, l]) => `<button type="button" data-act="setupType" data-id="${k}" class="${w.type === k ? "on" : ""}"><span>${ic}</span>${l}</button>`).join("")}</div>
      <label class="f"><span>Straße und Hausnummer</span><input name="street" value="${esc(w.street || "")}" required></label>
      <div class="fgrid"><label class="f"><span>PLZ</span><input name="zip" value="${esc(w.zip || "")}" inputmode="numeric"></label><label class="f"><span>Ort</span><input name="city" value="${esc(w.city || "")}"></label></div>
      <label class="f"><span>Kurzer Name (optional)</span><input name="name" value="${esc(w.name || "")}" placeholder="z. B. Haus Lindenstraße"></label>
      <div class="toolbar">${btn("setupBack", "← Zurück")}<button class="btn primary big">Weiter →</button></div></form>`,
    3: `<div class="setup"><h1>Was gehört dazu? 🔢</h1><p class="muted">Einfach mit ＋ und − zählen. Namen und Größen kannst du später ändern.</p>
      ${counter("haus", "Ganzes Haus (an eine Partei)", "🏠")}${counter("wohnung", "Wohnungen", "🚪")}${counter("garage", "Garagen", "🚗")}${counter("stellplatz", "Stellplätze", "🅿️")}${counter("keller", "Keller / Abstellräume", "📦")}${counter("ferienwohnung", "Ferienwohnungen", "🏖️")}${counter("gewerbe", "Gewerbe / Büros", "🏬")}
      <div class="toolbar" style="margin-top:16px">${btn("setupBack", "← Zurück")}${btn("setupFinish", "Fertig – anlegen ✓", "primary big")}</div></div>`,
    4: `<div class="setup"><h1>Geschafft! 🎉</h1><p class="muted">Dein Haus ist angelegt. Womit möchtest du weitermachen?</p>
      <div class="qgrid">
        <a class="qtile" href="#/mieter" data-act="moveWizard" data-id=""><span>🔑</span>Ersten Mieter eintragen</a>
        <a class="qtile" href="#/bank" data-act="connectBank"><span>🏦</span>Bankkonto verbinden</a>
        <label class="qtile"><span>📷</span>Ersten Beleg fotografieren<input type="file" accept="image/*" capture="environment" data-change="docScan" hidden></label>
        <a class="qtile" href="#/" data-act="setupDone"><span>🏠</span>Zur Startseite</a>
      </div></div>`,
  }[w.step];
  return `<div class="setupwrap">${bar}<div class="card">${body}</div></div>`;
}

function setupFinish() {
  const w = ui.setup;
  const o = { id: C.uid("o_"), name: w.name || w.street, short: (w.name || w.street || "").replace(/[^A-Za-zÄÖÜ]/g, "").slice(0, 3).toUpperCase(), type: w.type, street: w.street, zip: w.zip, city: w.city, afaRate: 2, notes: "" };
  state.objects.push(o);
  const labels = { haus: "Haus", wohnung: "Wohnung", garage: "Garage", stellplatz: "Stellplatz", keller: "Keller", ferienwohnung: "Ferienwohnung", gewerbe: "Gewerbe" };
  for (const [k, n] of Object.entries(w.counts)) for (let i = 1; i <= n; i++) state.units.push({ id: C.uid("u_"), objectId: o.id, name: n > 1 ? `${labels[k]} ${i}` : labels[k], type: k, area: 0, rooms: 0, floor: "", vat: k === "ferienwohnung" ? 7 : 0 });
  w.step = 4;
  commit(`${o.name} mit ${state.units.filter((u) => u.objectId === o.id).length} Einheiten angelegt`);
}

// ---------------------------------------------------------------- Konten, Cloud-Sync & Admin

// Markenname: aus den Admin-Einstellungen, alter Standardname wird automatisch zu „Homevio“
const BRAND = "Homevio";
const productName = () => { const n = (auth.settings?.product_name || "").trim(); return !n || /^HausOps/i.test(n) ? BRAND : n; };
const brandLogo = (cls = "") => `<div class="logo ${cls}"><img src="./assets/icon.svg" alt="" class="logo-icon"><span class="wm">${productName() === BRAND ? "home<em>vio</em>" : esc(productName())}</span></div>`;
const auth = { mode: "local", user: null, profile: null, settings: null, plans: [], version: 0, sync: "ok", syncTimer: null, pending: false, ws: null, role: "owner", workspaces: [], lastChange: null };
const isCloud = () => auth.mode === "cloud" && !!auth.user;
// Team: aktueller Bestand (Inhaber-ID) und eigene Rolle darin
const wsId = () => auth.ws || auth.user?.id;
const isOwnWs = () => !auth.ws || auth.ws === auth.user?.id;
const isViewer = () => isCloud() && auth.role === "viewer";
const ROLE_LABEL = { owner: "Inhaber", editor: "Bearbeiten", viewer: "Nur lesen" };
const curWs = () => auth.workspaces.find((w) => w.owner_id === wsId());
const isAdmin = () => isCloud() && auth.profile?.role === "admin";
const planOf = () => auth.plans.find((p) => p.id === auth.profile?.plan);
const canWrite = () => { if (isViewer()) return false; if (!isOwnWs()) return true; const p = auth.profile; return !p || p.role === "admin" || p.plan !== "trial" || !p.trial_ends_at || new Date(p.trial_ends_at) > new Date(); };
const buyablePlans = () => auth.plans.filter((x) => x.active && !["trial", "intern"].includes(x.id));

async function startBilling(action, planId) {
  try {
    toast(action === "portal" ? "Öffne Kundenportal …" : "Öffne sichere Bezahlseite (Stripe) …");
    await syncNow();
    const r = await Cloud.billing(action, planId);
    if (r.notConfigured) {
      const st = auth.settings || {}, plan = auth.plans.find((x) => x.id === planId);
      if (!st.support_email) return alert("Die Online-Bezahlung ist noch nicht eingerichtet. Bitte wende dich an den Anbieter.");
      location.href = `mailto:${st.support_email}?subject=${encodeURIComponent(`Tarif ${plan?.name || ""} buchen`)}&body=${encodeURIComponent(`Bitte stellt mein Konto ${auth.profile.email} auf den Tarif ${plan?.name || ""} um.`)}`;
      return;
    }
    location.href = r.url;
  } catch (e) { alert("Bezahlung konnte nicht gestartet werden: " + e.message); }
}

function planCards(current) {
  return `<div class="plans">${buyablePlans().map((x) => `<div class="plan ${x.id === current ? "current" : ""}"><b>${esc(x.name)}</b><div class="v">${eur(x.price_month_cents)}<span class="small"> / Monat</span></div><div class="small">${esc(x.description)}${x.max_units ? ` · bis ${x.max_units} Einheiten` : " · unbegrenzt"} · ${x.max_members == null ? "Team unbegrenzt" : x.max_members ? `+ ${x.max_members} Person${x.max_members === 1 ? "" : "en"} im Team` : "1 Person"}</div><div class="small muted">${esc(auth.settings?.price_note || "")} Monatlich kündbar.</div>
    ${x.id === current ? '<span class="badge ok">aktuell</span>' : btn("buyPlan", hasSubscription() ? "Wechseln" : "Jetzt buchen", "sm primary", x.id)}</div>`).join("")}</div>`;
}
const hasSubscription = () => ["active", "trialing", "past_due"].includes(auth.profile?.subscription_status);

// Bestellübersicht vor Vertragsschluss (§ 312j BGB „Button-Lösung“, Widerrufsrecht §§ 355, 356 BGB)
function orderOverview(planId) {
  if (hasSubscription()) return startBilling("checkout", planId); // Tarifwechsel läuft über das Stripe-Kundenportal
  const p = auth.plans.find((x) => x.id === planId), st = auth.settings || {};
  if ($("#modal").open) $("#modal").close();
  dialog({
    title: "Bestellübersicht", submit: "Zahlungspflichtig bestellen",
    body: `<table class="lines"><tbody>
        <tr><td>Tarif</td><td><b>${esc(p.name)}</b> – ${esc(p.description)}${p.max_units ? `, bis ${p.max_units} Einheiten` : ""}</td></tr>
        <tr><td>Preis</td><td><b>${eur(p.price_month_cents)} pro Monat</b> ${esc(st.price_note || "")}</td></tr>
        <tr><td>Laufzeit</td><td>monatlich, verlängert sich automatisch um einen Monat; jederzeit zum Ende des laufenden Monats kündbar (auch über „Verträge hier kündigen“)</td></tr>
        <tr><td>Zahlung</td><td>im Voraus über Stripe (Karte, SEPA-Lastschrift u. a.); Rechnung per E-Mail</td></tr>
        <tr><td>Vertragspartner</td><td>${esc(st.product_name || "")} – siehe ${legalLink("impressum", "Impressum")}</td></tr></tbody></table>
      <p class="small" style="margin:10px 0">Es gelten die ${legalLink("agb", "AGB")}, die ${legalLink("datenschutz", "Datenschutzerklärung")} und der ${legalLink("avv", "Auftragsverarbeitungsvertrag")}. Verbraucher haben ein 14-tägiges ${legalLink("widerruf", "Widerrufsrecht")}.</p>
      <label class="f inline small"><input type="checkbox" name="consentStart" required> Ich verlange ausdrücklich, dass mit der Leistung vor Ablauf der Widerrufsfrist begonnen wird. Mir ist bekannt, dass ich bei einem Widerruf Wertersatz für die bis dahin erbrachte Leistung schulde und mein Widerrufsrecht bei vollständiger Vertragserfüllung erlischt (§§ 356 Abs. 4, 357a BGB).</label>
      <p class="small muted">Im nächsten Schritt gibst du deine Zahlungsdaten auf der sicheren Seite von Stripe ein.</p>`,
    onSubmit: (form) => {
      if (!form.consentStart.checked) { toast("Bitte die Zustimmung zum sofortigen Leistungsbeginn bestätigen."); return false; }
      startBilling("checkout", planId);
    },
  });
}

// Kündigungsbutton nach § 312k BGB – erreichbar ohne Anmeldung
function viewCancelForm() {
  const r = ui.cancelResult, st = auth.settings || {};
  const back = auth.user ? `<a href="#/konto">← Mein Konto</a>` : `<a href="#/">← Zur Anmeldung</a>`;
  if (r) return `<div class="cancel-page"><div class="head noprint">${back}<button class="btn primary" onclick="window.print()">Bestätigung drucken / speichern</button></div>
    <div class="paper"><h1>Ihre Kündigung ist eingegangen</h1><p style="white-space:pre-wrap">${esc(r.confirmationText)}</p>
    <p class="small muted" style="margin-top:12px">${r.mailed ? "Eine Bestätigung wurde zusätzlich an Ihre E-Mail-Adresse gesendet." : "Bitte speichern oder drucken Sie diese Bestätigung."}</p></div></div>`;
  return `<div class="cancel-page"><div class="head">${back}</div><form class="card" data-form="cancel" style="max-width:640px">
    <h1>${ui.cancelKind === "widerruf" ? "Vertrag widerrufen" : "Verträge hier kündigen"}</h1>
    <p class="small muted" style="margin-bottom:12px">Kündigung deines Abos bei ${esc(productName())}. Ohne Angabe eines Datums wirkt sie zum nächstmöglichen Zeitpunkt (Ende des bezahlten Monats). Deine Daten kannst du bis dahin exportieren.</p>
    <div class="fgrid">
      <label class="f"><span>Dein Name *</span><input name="name" required value="${esc(auth.profile?.full_name || "")}"></label>
      <label class="f"><span>E-Mail für die Bestätigung *</span><input name="email" type="email" required value="${esc(auth.profile?.email || "")}"></label>
      <label class="f"><span>E-Mail-Adresse des Kontos</span><input name="accountEmail" type="email" value="${esc(auth.profile?.email || "")}"></label>
      <label class="f"><span>Vertrags-/Kundennummer (optional)</span><input name="contractRef"></label>
      <label class="f"><span>Art</span><select name="kind">${opt([["ordentlich", "ordentliche Kündigung"], ["ausserordentlich", "außerordentliche Kündigung"], ["widerruf", "Widerruf (innerhalb von 14 Tagen nach Vertragsschluss)"]], ui.cancelKind || "ordentlich")}</select></label>
      <label class="f"><span>Zeitpunkt</span><select name="wishedDate">${opt([["naechstmoeglich", "zum nächstmöglichen Zeitpunkt"], ["sofort", "sofort (nur bei außerordentlicher Kündigung)"]], "naechstmoeglich")}</select></label>
      <label class="f full"><span>Grund (nur bei außerordentlicher Kündigung erforderlich)</span><textarea name="reason"></textarea></label>
    </div>
    <button class="btn primary" style="background:var(--bad);border-color:var(--bad)">${ui.cancelKind === "widerruf" ? "Widerruf bestätigen" : "jetzt kündigen"}</button>
  </form></div>`;
}

function paywall() {
  dialog({
    title: "Testphase abgelaufen – Tarif wählen", wide: true,
    body: `<p style="margin-bottom:12px">Deine Daten sind sicher gespeichert und bleiben lesbar und exportierbar. Zum Bearbeiten wähle bitte einen Tarif:</p>${planCards(null)}
      <p class="small muted" style="margin-top:10px">Monatlich kündbar. Bezahlung sicher über Stripe (Karte, SEPA-Lastschrift u. a.). Rechnungen findest du danach unter „Mein Konto“.</p>`,
  });
}

// Belege: lokal zwischenspeichern, im Cloud-Modus zusätzlich hochladen / nachladen
async function putDocBlob(id, blob) {
  await F.putFile(id, blob);
  if (isCloud()) await Cloud.uploadFile(wsId(), id, blob);
}
async function getDocBlob(id) {
  const local = await F.getFile(id).catch(() => null);
  if (local || !isCloud()) return local;
  const remote = await Cloud.downloadFile(wsId(), id).catch(() => null);
  if (remote) await F.putFile(id, remote).catch(() => {});
  return remote;
}
async function deleteDocBlob(id) {
  await F.deleteFile(id).catch(() => {});
  if (isCloud()) await Cloud.removeFile(wsId(), id).catch(() => {});
}

function scheduleSync() {
  if (!isCloud()) return;
  auth.pending = true;
  setSync("saving");
  clearTimeout(auth.syncTimer);
  auth.syncTimer = setTimeout(syncNow, 1200);
}

async function syncNow() {
  if (!isCloud() || !auth.pending) return;
  auth.pending = false;
  try {
    const sent = JSON.stringify(state);
    auth.version = await Cloud.saveState(state, auth.version, isOwnWs() ? null : wsId());
    auth.snapshot = sent; auth.mergeTries = 0;
    auth.lastChange = { updated_by: auth.user.id, updated_at: new Date().toISOString() };
    setSync("ok");
  } catch (e) {
    if (e.code === "conflict" && (auth.mergeTries || 0) < 3) {
      // Jemand aus dem Team (oder ein anderes Gerät) hat gleichzeitig gespeichert: Änderungen zusammenführen statt verwerfen
      auth.mergeTries = (auth.mergeTries || 0) + 1;
      const remote = await Cloud.loadState(wsId());
      const base = auth.snapshot ? JSON.parse(auth.snapshot) : remote.data;
      const { merged, conflicts, duplicateNumbers } = S.mergeStates(base, state, remote.data);
      state = S.normalizeState(merged); auth.version = remote.version;
      auth.snapshot = JSON.stringify(S.normalizeState(remote.data)); S.save(state);
      render();
      toast(conflicts ? `🔄 Änderungen aus dem Team übernommen – bei ${conflicts} gleichzeitig geänderten Angabe(n) gilt deine Eingabe.` : "🔄 Änderungen aus dem Team übernommen.");
      if (duplicateNumbers.length) alert(`Achtung: Die Rechnungsnummer(n) ${duplicateNumbers.join(", ")} wurden gleichzeitig von zwei Personen vergeben. Bitte eine der Rechnungen stornieren und neu festschreiben (fortlaufende Nummern, § 14 UStG).`);
      auth.pending = true;
      return syncNow();
    } else if (e.code === "conflict") {
      auth.mergeTries = 0;
      const remote = await Cloud.loadState(wsId());
      state = S.normalizeState(remote.data); auth.version = remote.version; auth.snapshot = JSON.stringify(state); S.save(state);
      alert("Die Daten wurden zwischenzeitlich von jemand anderem geändert. Die neueste Version wurde geladen – bitte die letzte Änderung ggf. wiederholen.");
      setSync("ok"); render();
    } else if (e.code === "read_only" || e.code === "no_access") {
      if (auth.snapshot) state = S.normalizeState(JSON.parse(auth.snapshot));
      setSync("ok"); render();
      alert(e.code === "read_only" ? "Du hast in diesem Bestand nur Lesezugriff. Die Änderung wurde nicht gespeichert." : "Du hast keinen Zugriff (mehr) auf diesen Bestand. Bitte neu anmelden.");
    } else if (e.code === "plan_limit") {
      const remote = await Cloud.loadState(wsId());
      state = S.normalizeState(remote.data); auth.version = remote.version; S.save(state);
      alert(`Dein Tarif „${planOf()?.name || ""}“ erlaubt höchstens ${e.limit} Einheiten. Bitte Tarif wechseln (Mein Konto).`);
      setSync("ok"); render();
    } else if (e.code === "trial_expired") {
      if (auth.snapshot) state = S.normalizeState(JSON.parse(auth.snapshot));
      if (!isOwnWs()) { setSync("ok"); render(); alert(`Die Testphase bzw. das Abo von ${curWs()?.owner_name || "dem Inhaber"} ist abgelaufen. Der Bestand ist bis zur Verlängerung nur lesbar.`); return; }
      auth.profile = await Cloud.profile(auth.user.id).catch(() => auth.profile);
      setSync("ok"); render(); paywall();
    } else if (e.code === "blocked") {
      setSync("error"); alert(isOwnWs() ? "Dein Konto ist gesperrt. Bitte wende dich an den Support." : "Dieser Bestand ist derzeit gesperrt.");
    } else {
      auth.pending = true; setSync("offline");
      clearTimeout(auth.syncTimer); auth.syncTimer = setTimeout(syncNow, 15000);
    }
  }
}

function wsFoot() {
  const w = curWs();
  const portals = auth.portals || [];
  const sel = auth.workspaces.length > 1 || portals.length ? `<select id="wssel" data-change="switchWs" title="Bestand wechseln" style="margin:4px 0;width:100%">${auth.workspaces.map((x) => `<option value="${esc(x.owner_id)}" ${x.owner_id === wsId() ? "selected" : ""}>${x.role === "owner" ? "🏠 Mein Bestand" : `👥 ${esc(x.owner_name)}`}</option>`).join("")}${portals.map((x) => `<option value="portal:${esc(x.id)}">🔑 Mieterportal: ${esc(x.owner_name)}</option>`).join("")}</select><br>` : "";
  const role = !isOwnWs() ? `<span class="badge ${auth.role === "viewer" ? "grey" : "ok"}">${auth.role === "viewer" ? "👁 nur lesen" : "✎ bearbeiten"}</span><br>` : "";
  return sel + role + (isOwnWs() ? `${esc(planOf()?.name || "")}<br>` : `<span class="small muted">Bestand von ${esc(w?.owner_name || "")}</span><br>`);
}
function lastChangeLabel() {
  const c = auth.lastChange;
  if (!c?.updated_by || c.updated_by === auth.user?.id) return "";
  return `<span class="small muted">zuletzt geändert: ${esc(c.updated_by_name || "Team")}, ${new Date(c.updated_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><br>`;
}

function setSync(s) {
  auth.sync = s;
  const el = $("#sync");
  if (el) el.innerHTML = syncLabel();
}
const syncLabel = () => ({ ok: "☁︎ gespeichert", saving: "☁︎ speichert …", offline: "⚠︎ offline – wird nachgeholt", error: "⚠︎ nicht gespeichert" }[auth.sync]);

window.addEventListener("online", () => syncNow());
window.addEventListener("beforeunload", (e) => { if (auth.pending) { syncNow(); e.preventDefault(); } });

// Änderungen der anderen holen (Team / weitere Geräte) – leichtgewichtig über die Versionsnummer
async function pullRemote({ force = false } = {}) {
  if (!isCloud() || auth.pending || ui.pulling) return false;
  ui.pulling = true;
  try {
    const info = await Cloud.stateInfo(wsId());
    if (!info) return false;
    auth.lastChange = info;
    if (info.version <= auth.version) { const el = $("#lastchange"); if (el) el.innerHTML = lastChangeLabel(); return false; }
    const a = document.activeElement;
    if (!force && ($("#modal").open || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== "gsearch"))) return false; // nicht beim Tippen stören
    const remote = await Cloud.loadState(wsId());
    if (auth.pending) return false;
    state = S.normalizeState(remote.data); auth.version = remote.version; auth.snapshot = JSON.stringify(state); S.save(state);
    render();
    if (info.updated_by && info.updated_by !== auth.user.id) toast(`🔄 Aktualisiert – Änderung von ${info.updated_by_name || "Teammitglied"}`);
    return true;
  } catch { return false; } finally { ui.pulling = false; }
}

function startTeamPull() {
  if (ui.teamPullStarted) return;
  ui.teamPullStarted = true;
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    pullRemote();
    const before = portalUnread();
    loadPortal().then(() => { if (portalUnread() !== before) { const a = document.activeElement; if (!$("#modal").open && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) render(); } });
  }, 30 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullRemote(); });
}

const INVITE_KEY = "hausops-immo-invite";
const wsKey = () => `hausops-immo-ws:${auth.user.id}`;

async function loadWorkspaces() {
  try { auth.workspaces = (await Cloud.myWorkspaces()) || []; }
  catch { auth.workspaces = []; } // Team-Funktion (Migration) noch nicht eingespielt
  if (!auth.workspaces.some((w) => w.role === "owner")) auth.workspaces.unshift({ owner_id: auth.user.id, owner_name: auth.profile?.company || auth.profile?.full_name || auth.user.email, owner_email: auth.user.email, role: "owner" });
}

function useWorkspace(w) {
  auth.ws = w.owner_id; auth.role = w.role;
  S.useUser(w.owner_id === auth.user.id ? auth.user.id : `${auth.user.id}@${w.owner_id}`);
  try { localStorage.setItem(wsKey(), w.owner_id); } catch {}
}

async function loadWsState() {
  const remote = await Cloud.loadState(wsId());
  auth.version = remote.version;
  state = S.normalizeState(remote.data);
  auth.snapshot = JSON.stringify(state);
  S.save(state);
}

async function switchWorkspace(ownerId) {
  const w = auth.workspaces.find((x) => x.owner_id === ownerId);
  if (!w || ownerId === wsId()) return;
  clearTimeout(auth.syncTimer); await syncNow();
  if (auth.pending) return alert("Deine letzten Änderungen konnten noch nicht gespeichert werden. Bitte Internetverbindung prüfen und erneut versuchen.");
  useWorkspace(w);
  try { await loadWsState(); } catch (e) { alert("Bestand konnte nicht geladen werden: " + e.message); }
  Object.assign(ui, { nk: null, letter: null, chat: [], folderTenant: null, portal: null });
  location.hash = "#/"; render(); loadPortal();
  toast(`Bestand gewechselt: ${w.owner_name}${w.role === "viewer" ? " (nur lesen)" : ""}`);
}

// Einladungen: per Link (#/einladung/<token>) oder automatisch beim Anmelden mit der eingeladenen E-Mail
async function handleInvites() {
  let token = null;
  try { token = sessionStorage.getItem(INVITE_KEY); sessionStorage.removeItem(INVITE_KEY); } catch {}
  if (token) {
    try {
      const owner = await Cloud.acceptInvite(token);
      await loadWorkspaces();
      const w = auth.workspaces.find((x) => x.owner_id === owner);
      if (w) { useWorkspace(w); toast(`Willkommen im Bestand von ${w.owner_name}!`); }
    } catch (e) { alert(e.message); }
  }
  const open = await Cloud.myInvites().catch(() => []);
  if (!open?.length) return;
  const i = open[0];
  if (confirm(`${i.owner_name} hat dich eingeladen, gemeinsam die Immobilien zu verwalten (${ROLE_LABEL[i.role]}).\n\nEinladung annehmen?`)) {
    try {
      const owner = await Cloud.acceptInvite(i.token);
      await loadWorkspaces();
      const w = auth.workspaces.find((x) => x.owner_id === owner);
      if (w) { useWorkspace(w); await loadWsState(); toast(`Du hast jetzt Zugriff auf den Bestand von ${w.owner_name}.`); render(); }
    } catch (e) { alert(e.message); }
  }
}

async function boot() {
  const pinv = location.hash.match(/^#\/mieterportal\/([0-9a-fA-F-]{36})/);
  if (pinv) {
    try { sessionStorage.setItem(PORTAL_INVITE_KEY, pinv[1]); } catch {}
    history.replaceState(null, "", location.pathname + location.search + "#/");
    ui.portalInvite = { token: pinv[1], info: null };
  }
  const inv = location.hash.match(/^#\/einladung\/([0-9a-fA-F-]{36})/);
  if (inv) {
    try { sessionStorage.setItem(INVITE_KEY, inv[1]); } catch {}
    history.replaceState(null, "", location.pathname + location.search + "#/");
    ui.authMsg = "Du wurdest eingeladen! Melde dich an – oder registriere dich mit der E-Mail-Adresse, an die die Einladung ging.";
  }
  const cloud = await Cloud.init().catch(() => false);
  if (!cloud) { auth.mode = "local"; render(); afterStart(); return; }
  auth.mode = "cloud";
  auth.settings = await Cloud.appSettings().catch(() => null);
  auth.plans = await Cloud.plans().catch(() => []);
  if (ui.portalInvite) ui.portalInvite.info = await Cloud.portalInviteInfo(ui.portalInvite.token).catch(() => null);
  Cloud.onAuth(async (event, s) => {
    if (event === "PASSWORD_RECOVERY") { ui.authTab = "newpw"; render(); }
    if (event === "SIGNED_OUT") { ui.authTab = "login"; ui.authMsg = ""; Object.assign(ui, { adminUsers: null, chat: [], letter: null, nk: null, team: null }); auth.user = null; auth.profile = null; Object.assign(auth, { ws: null, role: "owner", workspaces: [], lastChange: null, portals: [], portalView: null }); ui.portal = null; ui.tp = null; S.useUser(null); state = S.emptyState(); render(); }
  });
  const s = await Cloud.session().catch(() => null);
  if (s) await enterAccount(s.user); else render();
  const ret = new URLSearchParams(location.search).get("checkout");
  if (ret && s) {
    history.replaceState(null, "", location.pathname + location.hash);
    if (ret === "success") {
      toast("Danke! Zahlung erfolgreich – dein Tarif wird freigeschaltet …");
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        auth.profile = await Cloud.profile(s.user.id).catch(() => auth.profile);
        if (hasSubscription()) break;
      }
      render(); toast(hasSubscription() ? `Tarif „${planOf()?.name}“ ist aktiv.` : "Die Freischaltung dauert etwas – bitte gleich neu laden.");
    }
  }
}

async function afterStart() {
  await finishBankConnect();
  startAutoSync();
}

async function enterAccount(user) {
  auth.user = user;
  try {
    auth.profile = await Cloud.profile(user.id);
    if (auth.profile.status !== "active") { render(); return; }
    await handlePortalInvites().catch(() => {});
    if (auth.profile.account_type === "mieter") {
      auth.portalView = auth.portals[0]?.id || "none";
      Cloud.touch(); location.hash = "#/"; render(); startPortalPoll();
      return;
    }
    await loadWorkspaces();
    let saved = null; try { saved = localStorage.getItem(wsKey()); } catch {}
    useWorkspace(auth.workspaces.find((w) => w.owner_id === saved) || auth.workspaces.find((w) => w.role === "owner"));
    await handleInvites().catch(() => {});
    await loadWsState();
    Cloud.touch();
    // Erster Login: vorhandene lokale Daten (aus dem lokalen Modus) übernehmen?
    const legacy = S.legacyLocal();
    if (isOwnWs() && !state.objects.length && legacy?.objects?.length && confirm(`Auf diesem Gerät gibt es lokale Daten (${legacy.objects.length} Objekte). In dein Konto übernehmen?`)) {
      state = legacy; S.save(state); auth.pending = true; await syncNow();
      for (const doc of state.documents || []) { const b = await F.getFile(doc.id).catch(() => null); if (b) await Cloud.uploadFile(user.id, doc.id, b).catch(() => {}); }
    }
  } catch (e) {
    alert("Anmeldung fehlgeschlagen: " + Cloud.friendlyAuthError(e));
    await Cloud.signOut();
  }
  if (!location.hash || location.hash === "#/") location.hash = "#/";
  render();
  if (auth.profile?.status === "active") { afterStart(); startTeamPull(); loadPortal().then(() => { if (portalUnread()) render(); }); }
}

function legalLink(k, label) { return `<button class="btn link small" data-act="legal" data-id="${k}">${label}</button>`; }

function viewAuth() {
  const tab = ui.authTab || "login";
  const st = auth.settings || {};
  const plans = auth.plans.filter((p) => p.active && p.id !== "intern");
  const form = {
    login: `<form data-form="login"><h2>Anmelden</h2>
      <label class="f"><span>E-Mail</span><input name="email" type="email" autocomplete="email" required></label>
      <label class="f"><span>Passwort</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary" style="width:100%;justify-content:center">Anmelden</button>
      <p class="small" style="margin-top:10px"><button type="button" class="btn link" data-act="authTab" data-id="reset">Passwort vergessen?</button></p></form>`,
    register: st.registration_open === false ? `<h2>Registrierung</h2><p class="muted">Die Registrierung ist derzeit geschlossen.${st.support_email ? ` Kontakt: ${esc(st.support_email)}` : ""}</p>` : `<form data-form="register"><h2>Kostenlos testen</h2>
      <p class="small muted" style="margin-bottom:10px">${st.trial_days || 30} Tage alle Funktionen – ohne Zahlungsdaten.</p>
      <div class="fgrid"><label class="f"><span>Name</span><input name="fullName" required autocomplete="name"></label>
      <label class="f"><span>Firma (optional)</span><input name="company" autocomplete="organization"></label></div>
      <label class="f"><span>E-Mail</span><input name="email" type="email" required autocomplete="email"></label>
      <label class="f"><span>Passwort (mind. 8 Zeichen)</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <label class="f inline small"><input type="checkbox" name="terms" required> Ich akzeptiere die ${legalLink("agb", "AGB")} und habe die ${legalLink("datenschutz", "Datenschutzerklärung")} und die ${legalLink("widerruf", "Widerrufsbelehrung")} zur Kenntnis genommen.</label>
      <label class="f inline small"><input type="checkbox" name="avv" required> Ich schließe den ${legalLink("avv", "Auftragsverarbeitungsvertrag (Art. 28 DSGVO)")} für die Daten meiner Mieter und Gäste ab.</label>
      <button class="btn primary" style="width:100%;justify-content:center">Konto erstellen</button></form>`,
    reset: `<form data-form="reset"><h2>Passwort zurücksetzen</h2><p class="small muted" style="margin-bottom:10px">Du bekommst eine E-Mail mit einem Link zum Festlegen eines neuen Passworts.</p>
      <label class="f"><span>E-Mail</span><input name="email" type="email" required></label>
      <button class="btn primary" style="width:100%;justify-content:center">Link senden</button></form>`,
    newpw: `<form data-form="newpw"><h2>Neues Passwort festlegen</h2>
      <label class="f"><span>Neues Passwort (mind. 8 Zeichen)</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <button class="btn primary" style="width:100%;justify-content:center">Speichern</button></form>`,
  }[tab];
  return `<div class="auth">
    <div class="auth-hero">${brandLogo()}
      <h1>Deine Immobilien. Einfach verwaltet.</h1>
      <ul><li>Wohnungen, Häuser, Garagen, Stellplätze & Ferienwohnungen</li><li>Bankabgleich: Mieteingänge automatisch erkannt</li><li>Nebenkostenabrechnung nach BetrKV mit Mieterbrief</li><li>Belege fotografieren – die KI liest sie aus</li><li>Anlage V, DATEV-Export & Steuerberater-Paket</li></ul>
      ${plans.length ? `<div class="plans">${plans.map((p) => `<div class="plan"><b>${esc(p.name)}</b><div class="v">${p.price_month_cents ? eur(p.price_month_cents) + "<span class=\"small\"> / Monat</span>" : "kostenlos"}</div><div class="small">${esc(p.description)}</div></div>`).join("")}</div><p class="small" style="margin-top:8px;color:#dce8eb">${esc(st.price_note || "")}</p>` : ""}
    </div>
    <div class="auth-box card">
      ${st.announcement ? `<div class="note warn">${esc(st.announcement)}</div>` : ""}
      ${tab !== "newpw" ? `<div class="tabs"><button data-act="authTab" data-id="login" class="${tab === "login" ? "active" : ""}">Anmelden</button><button data-act="authTab" data-id="register" class="${tab === "register" ? "active" : ""}">Registrieren</button></div>` : ""}
      ${ui.authMsg ? `<div class="note">${esc(ui.authMsg)}</div>` : ""}
      ${form}
      <div class="small muted" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">${legalLink("impressum", "Impressum")}${legalLink("datenschutz", "Datenschutz")}${legalLink("agb", "AGB")}${legalLink("widerruf", "Widerruf")}<a class="btn link small" href="#/kuendigen" data-act="setKuendigung">Verträge hier kündigen</a><a class="btn link small" href="#/kuendigen" data-act="setWiderruf">Vertrag widerrufen</a></div>
    </div></div>`;
}

function viewBlocked() {
  return `<div class="auth"><div class="auth-box card" style="margin:auto"><h2>Konto gesperrt</h2><p>Dein Konto ist derzeit gesperrt. Bitte wende dich an den Support${auth.settings?.support_email ? `: <a href="mailto:${esc(auth.settings.support_email)}">${esc(auth.settings.support_email)}</a>` : ""}.</p><br>${btn("logout", "Abmelden")}</div></div>`;
}

function trialInfo() {
  const p = auth.profile;
  if (!p?.trial_ends_at || p.plan !== "trial") return null;
  const days = Math.ceil((new Date(p.trial_ends_at) - new Date()) / 86400000);
  return { days, expired: days < 0, end: p.trial_ends_at.slice(0, 10) };
}

function banners() {
  if (!isCloud()) return "";
  const out = [];
  if (auth.settings?.announcement) out.push(`<div class="note warn noprint">📣 ${esc(auth.settings.announcement)}</div>`);
  if (!isOwnWs()) out.push(`<div class="note noprint">👥 Du arbeitest im Bestand von <b>${esc(curWs()?.owner_name || "")}</b> – ${isViewer() ? "👁 nur lesen (Einsicht & Export)" : "✎ mit Bearbeitungsrecht"}. ${btn("switchWs", "Zu meinem Bestand", "sm", auth.user.id)}</div>`);
  const t = isOwnWs() ? trialInfo() : null;
  if (t && (t.expired || t.days <= 7)) out.push(`<div class="note warn noprint">${t.expired ? "🔒 Deine Testphase ist abgelaufen – Nur-Lesen-Modus. Daten bleiben erhalten und exportierbar." : `Deine Testphase endet in ${t.days} Tag(en).`} ${btn("paywall", "Tarif wählen", "sm primary")}</div>`);
  const p = auth.profile;
  if (p && auth.settings?.legal_version && (!p.avv_accepted_at || (p.legal_version || "") !== auth.settings.legal_version) && p.role !== "admin") out.push(`<div class="note warn noprint">📄 Unsere ${legalLink("agb", "AGB")} bzw. der ${legalLink("avv", "Auftragsverarbeitungsvertrag")} wurden aktualisiert. ${btn("acceptLegal", "Zustimmen", "sm primary")}</div>`);
  if (p?.subscription_status === "past_due") out.push(`<div class="note warn noprint">⚠️ Die letzte Zahlung ist fehlgeschlagen. Bitte Zahlungsmethode aktualisieren. ${btn("billingPortal", "Zahlungsmethode ändern", "sm primary")}</div>`);
  if (p?.cancel_at_period_end && p.current_period_end) out.push(`<div class="note noprint">Dein Abo ist gekündigt und endet am ${d(p.current_period_end.slice(0, 10))}. ${btn("billingPortal", "Kündigung zurücknehmen", "sm")}</div>`);
  return out.join("");
}

function viewKonto() {
  const p = auth.profile, plan = planOf(), t = trialInfo();
  const st = auth.settings || {};
  return head("Mein Konto", esc(p.email), btn("logout", "Abmelden")) + `
    <form class="card" data-form="profile"><h2>Profil</h2><div class="fgrid">
      <label class="f"><span>Name</span><input name="full_name" value="${esc(p.full_name)}"></label>
      <label class="f"><span>Firma</span><input name="company" value="${esc(p.company)}"></label></div>
      <button class="btn primary">Speichern</button></form>
    ${teamCard()}
    <div class="card"><h2>Tarif</h2>
      <p><b>${esc(plan?.name || p.plan)}</b> ${plan?.price_month_cents ? `· ${eur(plan.price_month_cents)} / Monat` : ""} ${t ? (t.expired ? '<span class="badge bad">Testphase abgelaufen</span>' : `<span class="badge warn">Test bis ${d(t.end)}</span>`) : ""}</p>
      <p class="small muted">Nutzung: ${state.units.length} Einheiten${plan?.max_units ? ` von max. ${plan.max_units}` : ""} · ${state.objects.length} Objekte · ${state.documents.length} Dokumente</p>
      ${p.subscription_status ? `<p class="small">Abo: ${esc({ active: "aktiv", trialing: "Testzeitraum", past_due: "Zahlung offen", canceled: "beendet", unpaid: "unbezahlt", incomplete: "unvollständig" }[p.subscription_status] || p.subscription_status)}${p.current_period_end ? ` · ${p.cancel_at_period_end ? "endet" : "verlängert sich"} am ${d(p.current_period_end.slice(0, 10))}` : ""}</p>` : ""}
      <div style="margin-top:10px">${planCards(p.plan)}</div>
      <div class="toolbar" style="margin-top:10px">${p.stripe_customer_id ? btn("billingPortal", "💳 Zahlungen, Rechnungen & Kündigung", "") : ""}</div>
      <p class="small muted" style="margin-top:8px">Monatlich kündbar. Bezahlung sicher über Stripe; Rechnungen werden automatisch per E-Mail versandt.</p></div>
    <form class="card" data-form="password"><h2>Passwort ändern</h2>
      <label class="f"><span>Neues Passwort (mind. 8 Zeichen)</span><input name="password" type="password" minlength="8" required autocomplete="new-password" style="max-width:340px"></label>
      <button class="btn">Passwort ändern</button></form>
    <div class="card"><h2>Daten & Datenschutz</h2>
      <p class="small muted" style="margin-bottom:8px">Deine Daten sind von allen anderen Konten getrennt gespeichert. Zugriff haben nur du und die Personen, die du unter „Team & Zugriff“ einlädst – auch Administratoren sehen keine Objekt- oder Mieterdaten.</p>
      <div class="toolbar">${btn("backupFull", "⬇ Alle Daten exportieren")}${btn("deleteSelf", "Konto & alle Daten löschen", "danger")}</div>
      <div class="small" style="margin-top:10px">${legalLink("impressum", "Impressum")} · ${legalLink("datenschutz", "Datenschutz")} · ${legalLink("agb", "AGB")} · ${legalLink("avv", "Auftragsverarbeitung")} · ${legalLink("widerruf", "Widerruf")} · <a href="#/kuendigen" data-act="setKuendigung">Verträge hier kündigen</a> · <a href="#/kuendigen" data-act="setWiderruf">Vertrag widerrufen</a></div></div>`;
}

// ---------------------------------------------------------------- Reparaturen & Instandhaltung

const objName = (id) => byId("objects", id)?.name || "";
const repairWhere = (r) => [objName(r.objectId), byId("units", r.unitId)?.name].filter(Boolean).join(" · ");
const repBadge = (s) => `<span class="badge ${s === "erledigt" ? "ok" : s === "abgelehnt" ? "grey" : s === "gemeldet" ? "warn" : ""}">${I.REPAIR_STATUS[s] || s}</span>`;
const activeContractFor = (unitId) => state.contracts.find((c) => c.unitId === unitId && c.start <= today() && (!c.end || c.end >= today()));

function viewInstand() {
  const tab = ui.instTab || "auftraege", y = ui.year, obj = ui.instObj || "";
  const st = I.repairStats(state, y, obj);
  const due = I.maintenanceDue(state, today(), 60);
  const tabs = [["auftraege", `Aufträge (${st.open} offen)`], ["wartung", `Wartungsplan${due.length ? ` (${due.length} fällig)` : ""}`], ["kosten", "Kosten & Steuer"]];
  const filter = ui.instFilter || "offen";
  const list = (state.repairs || []).filter((r) => (!obj || r.objectId === obj) && (filter === "alle" || (filter === "offen" ? I.REPAIR_OPEN.includes(r.status) : r.status === "erledigt")))
    .sort((a, b) => (I.REPAIR_OPEN.includes(a.status) && a.priority !== "normal" ? -1 : 0) - (I.REPAIR_OPEN.includes(b.status) && b.priority !== "normal" ? -1 : 0) || ((b.reportedAt || "") > (a.reportedAt || "") ? 1 : -1));
  const card = (r) => {
    const cost = I.repairCost(state, r);
    return `<div class="todoitem click" data-act="editRepair" data-id="${r.id}"><span class="ic">${r.priority === "notfall" ? "🚨" : r.priority === "dringend" ? "⚠️" : r.kind === "wartung" ? "🛠" : "🔧"}</span>
      <span class="tx"><b>${esc(r.title)}</b> ${repBadge(r.status)}<br><span class="small muted">${esc(repairWhere(r))} · gemeldet ${d(r.reportedAt)}${r.reportedBy === "mieter" ? " vom Mieter" : ""}${r.contractor?.name ? ` · ${esc(r.contractor.name)}` : ""}${(r.docIds || []).length ? ` · 📷 ${(r.docIds || []).length}` : ""}</span></span>
      <span class="num small rc">${cost ? `<b>${eur(cost)}</b>` : r.quote ? `Angebot ${eur(r.quote)}` : ""}${r.payer && r.payer !== "vermieter" ? `<br><span class="muted">${esc(I.PAYERS[r.payer].split(" (")[0].split(" – ")[1] || I.PAYERS[r.payer])}</span>` : ""}</span></div>`;
  };
  const maintRows = (state.maintenance || []).filter((m) => !obj || m.objectId === obj).map((m) => ({ ...m, due: I.nextDue(m) })).sort((a, b) => ((a.due || "9") < (b.due || "9") ? -1 : 1));
  const fp = state.objects.map((o) => ({ o, f: I.fifteenPercent(state, o, today()) })).filter((x) => x.f && x.f.active && (!obj || x.o.id === obj));
  const body = {
    auftraege: `<div class="inline" style="margin-bottom:10px"><div class="tabs" style="margin:0">${[["offen", "Offen"], ["erledigt", "Erledigt"], ["alle", "Alle"]].map(([k, l]) => `<button data-act="instFilter" data-id="${k}" class="${filter === k ? "active" : ""}">${l}</button>`).join("")}</div></div>
      ${list.length ? list.map(card).join("") : `<p class="muted">${filter === "offen" ? "Keine offenen Reparaturen. 👍" : "Noch keine Einträge."}</p>`}`,
    wartung: `<p class="small muted" style="margin-bottom:10px">Regelmäßige Wartungen und Prüfungen mit Erinnerung auf der Startseite. Umlagefähige Wartungen landen beim Erfassen der Kosten automatisch in der Nebenkostenabrechnung.</p>
      ${maintRows.length ? `<div class="table-wrap"><table><thead><tr><th>Wartung</th><th>Objekt</th><th>Intervall</th><th>Zuletzt</th><th>Nächste</th><th></th></tr></thead><tbody>${maintRows.map((m) => `<tr><td class="click" data-act="editMaint" data-id="${m.id}"><b>${esc(m.title)}</b>${m.contractor ? `<div class="small muted">${esc(m.contractor)}</div>` : ""}<div class="small muted">${esc(m.note || "")}</div></td><td>${esc(objName(m.objectId))}</td><td>${m.months} Mon.</td><td>${m.lastDone ? d(m.lastDone) : "–"}</td><td class="${m.due && m.due < today() ? "neg" : ""}">${m.due ? d(m.due) : "–"}</td><td>${btn("maintDone", "✓ Erledigt", "sm", m.id)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">Noch kein Wartungsplan.</p>'}
      <div class="toolbar" style="margin-top:10px">${btn("editMaint", "+ Wartung", "")}${btn("maintTemplates", "⚡ Typische Wartungen vorschlagen", "primary")}</div>`,
    kosten: `<div class="kpis">
        <div class="kpi"><div class="l">Kosten ${y}</div><div class="v">${eur(st.total)}</div><div class="s">${st.count} Aufträge</div></div>
        <div class="kpi"><div class="l">davon Vermieter</div><div class="v">${eur(st.landlord)}</div><div class="s">Erhaltungsaufwand (Anlage V)</div></div>
        <div class="kpi"><div class="l">Mieter / Versicherung</div><div class="v">${eur((st.byPayer.kleinreparatur || 0) + (st.byPayer.mieter_schaden || 0) + (st.byPayer.versicherung || 0))}</div><div class="s">weiterberechnet bzw. erstattet</div></div>
        <div class="kpi"><div class="l">Offene Angebote</div><div class="v">${eur(st.quotesOpen)}</div></div></div>
      <div class="card"><h3>Nach Art</h3><table>${Object.entries(st.byKind).map(([k, v]) => `<tr><td>${esc(I.REPAIR_KINDS[k] || k)}</td><td class="num">${eur(v)}</td></tr>`).join("") || '<tr><td class="muted">Keine Kosten im Jahr.</td></tr>'}</table></div>
      ${fp.map(({ o, f }) => `<div class="note ${f.pct > 0.8 ? "warn" : ""}"><b>${esc(o.name)}: 15-%-Grenze</b> (anschaffungsnahe Herstellungskosten, § 6 Abs. 1 Nr. 1a EStG) – bis ${d(f.until)} höchstens ca. ${eur(f.limit)} netto für Instandsetzung, sonst nur über AfA absetzbar. Bisher: ${eur(f.sum)} (${Math.round(f.pct * 100)} %), Rest ${eur(Math.max(0, f.left))}.${f.pct > 0.8 ? " Größere Maßnahmen ggf. nach Ablauf der 3 Jahre planen." : ""}</div>`).join("")}
      <p class="small muted">Tipp: Größere Erhaltungsaufwendungen an Wohngebäuden können auf 2–5 Jahre verteilt werden (§ 82b EStDV) – Einstellung beim Erfassen der Kosten. Modernisierungen können zu einer Mieterhöhung berechtigen (§ 559 BGB, 8 % der Kosten pro Jahr; Ankündigung 3 Monate vorher, § 555c BGB).</p>`,
  };
  return head("Reparaturen & Instandhaltung", "Mängel, Aufträge an Handwerker, Kosten und Wartungsplan",
    `<select data-change="instObj" style="width:auto">${opt([["", "Alle Objekte"], ...state.objects.map((o) => [o.id, o.name])], obj)}</select>` + (tab === "kosten" ? btn("year", "‹", "", y - 1) + `<b style="padding:0 6px">${y}</b>` + btn("year", "›", "", y + 1) : "") + btn("editRepair", "+ Reparatur", "primary")) + `
    <div class="bigstats four"><div><b>${st.open}</b><span>offen</span></div><div><b>${st.urgent}</b><span>dringend</span></div><div><b>${due.length}</b><span>Wartungen fällig</span></div><div><b>${eur(st.total)}</b><span>Kosten ${y}</span></div></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-act="instTab" data-id="${k}" class="${tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    <div class="card">${body[tab]}</div>`;
}

function editRepair(id, preset = {}) {
  if (!state.objects.length) return toast("Bitte zuerst ein Objekt anlegen.");
  const r = (state.repairs || []).find((x) => x.id === id) || { id: C.uid("r_"), status: "gemeldet", kind: "reparatur", priority: "normal", reportedAt: today(), payer: "vermieter", objectId: ui.instObj || state.objects[0].id, expenseIds: [], docIds: [], ...preset };
  const c = activeContractFor(r.unitId);
  const cost = I.repairCost(state, r);
  const kr = r.payer === "kleinreparatur" && c ? I.kleinreparaturCheck(c, cost || r.quote || 0, kleinRepSpent(c, r.id), (c.kalt || 0) * 12) : null;
  const docs = (r.docIds || []).map((x) => byId("documents", x)).filter(Boolean);
  const exps = (r.expenseIds || []).map((x) => byId("expenses", x)).filter(Boolean);
  const isNew = !(state.repairs || []).some((x) => x.id === r.id);
  dialog({
    title: isNew ? "Neue Reparatur / Mangel" : `🔧 ${r.title}`, wide: true,
    body: `<div class="fgrid">
        <label class="f full"><span>Was ist kaputt? *</span><input name="title" value="${esc(r.title || "")}" placeholder="z. B. Heizung im Bad wird nicht warm" required></label>
        <label class="f"><span>Objekt</span><select name="objectId">${opt(state.objects.map((o) => [o.id, o.name]), r.objectId)}</select></label>
        <label class="f"><span>Einheit (optional)</span><select name="unitId">${opt([["", "Gemeinschaftseigentum / ganzes Haus"], ...state.units.filter((u) => u.objectId === r.objectId).map((u) => [u.id, u.name])], r.unitId || "")}</select></label>
        <label class="f"><span>Art</span><select name="kind">${opt(Object.entries(I.REPAIR_KINDS), r.kind)}</select></label>
        <label class="f"><span>Dringlichkeit</span><select name="priority">${opt(Object.entries(I.PRIORITIES), r.priority)}</select></label>
        <label class="f"><span>Status</span><select name="status">${opt(Object.entries(I.REPAIR_STATUS), r.status)}</select></label>
        <label class="f"><span>Gemeldet am</span><input type="date" name="reportedAt" value="${esc(r.reportedAt || today())}"></label>
        <label class="f full"><span>Beschreibung</span><textarea name="description" placeholder="Was genau, seit wann, Zugang/Termin beim Mieter …">${esc(r.description || "")}</textarea></label>
        <label class="f"><span>Handwerker / Firma</span><input name="cname" value="${esc(r.contractor?.name || "")}" list="contractorList"></label>
        <label class="f"><span>Telefon</span><input name="cphone" value="${esc(r.contractor?.phone || "")}"></label>
        <label class="f"><span>E-Mail Handwerker</span><input name="cemail" type="email" value="${esc(r.contractor?.email || "")}"></label>
        <label class="f"><span>Termin / fällig bis</span><input type="date" name="dueDate" value="${esc(r.dueDate || "")}"></label>
        <label class="f"><span>Angebot / Kostenvoranschlag (€)</span><input name="quote" inputmode="decimal" value="${r.quote ? esc(C.fmtNum(r.quote)) : ""}"></label>
        <label class="f"><span>Kosten (€) ${exps.length ? "– aus verknüpften Ausgaben" : ""}</span><input name="cost" inputmode="decimal" value="${cost ? esc(C.fmtNum(cost)) : ""}" ${exps.length ? "disabled" : ""}></label>
        <label class="f full"><span>Wer trägt die Kosten?</span><select name="payer">${opt(Object.entries(I.PAYERS), r.payer || "vermieter")}</select></label>
      </div>
      <datalist id="contractorList">${[...new Set((state.repairs || []).map((x) => x.contractor?.name).filter(Boolean))].map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      ${kr ? `<div class="note ${kr.applies ? "" : "warn"} small">${esc(kr.reason)}${(kr.warn || []).map((w) => `<br>⚠️ ${esc(w)}`).join("")}</div>` : ""}
      ${r.payer === "kleinreparatur" && !c ? '<div class="note warn small">Für die Kleinreparaturklausel bitte die vermietete Einheit auswählen (aktiver Mietvertrag mit Klausel nötig).</div>' : ""}
      ${!isNew ? `<h3 style="margin:12px 0 6px">Fotos & Belege</h3><div class="inline">${docs.map((x) => `<span class="att" data-act="openDoc" data-id="${x.id}">${x.thumb ? `<img src="${x.thumb}">` : "📄"} ${esc(x.name.slice(0, 22))}</span>`).join("")}
          <label class="btn sm">📷 Foto<input type="file" accept="image/*" capture="environment" data-change="repairUpload" data-id="${r.id}" hidden></label><label class="btn sm">📄 Datei<input type="file" accept="image/*,application/pdf" multiple data-change="repairUpload" data-id="${r.id}" hidden></label></div>
        <h3 style="margin:12px 0 6px">Rechnungen / Kosten</h3>${exps.map((e) => `<div class="small click" data-act="editExpense" data-id="${e.id}">📉 ${d(e.date)} · ${esc(e.vendor || C.EXPENSE_CATEGORIES[e.category]?.label || "")} · <b>${eur(e.amount)}</b></div>`).join("") || '<p class="small muted">Noch keine Rechnung erfasst.</p>'}
        <div class="toolbar" style="margin-top:8px">${btnRaw("repairExpense", "+ Handwerkerrechnung erfassen", r.id)}${btnRaw("repairOrder", "✉️ Auftrag an Handwerker", r.id)}${r.unitId ? btnRaw("repairNotice", "📣 Mieter informieren", r.id) : ""}</div>
        ${(r.log || []).length ? `<h3 style="margin:12px 0 6px">Verlauf</h3>${r.log.slice(-8).map((l) => `<div class="small muted">${new Date(l.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · ${esc(l.text)}</div>`).join("")}` : ""}` : '<p class="small muted">Nach dem Speichern kannst du Fotos anhängen, den Auftrag an den Handwerker schicken und die Rechnung erfassen.</p>'}`,
    onOpen: (form) => { form.objectId.addEventListener("change", () => { form.unitId.innerHTML = opt([["", "Gemeinschaftseigentum / ganzes Haus"], ...state.units.filter((u) => u.objectId === form.objectId.value).map((u) => [u.id, u.name])], ""); }); },
    onDelete: !isNew && (() => { state.repairs = state.repairs.filter((x) => x.id !== r.id); commit("Auftrag gelöscht"); }),
    onSubmit: (form) => {
      if (!form.title.value.trim()) { toast("Bitte kurz beschreiben, was kaputt ist."); return false; }
      const before = r.status;
      const v = {
        title: form.title.value.trim(), objectId: form.objectId.value, unitId: form.unitId.value, kind: form.kind.value, priority: form.priority.value, status: form.status.value,
        reportedAt: form.reportedAt.value || today(), description: form.description.value.trim(), dueDate: form.dueDate.value,
        contractor: { name: form.cname.value.trim(), phone: form.cphone.value.trim(), email: form.cemail.value.trim() },
        quote: C.parseAmount(form.quote.value) || 0, payer: form.payer.value,
      };
      if (!exps.length) v.cost = C.parseAmount(form.cost.value) || 0;
      if (v.status === "erledigt" && !r.doneAt) v.doneAt = today();
      const log = [...(r.log || [])];
      if (isNew) log.push({ at: new Date().toISOString(), text: "angelegt" });
      else if (before !== v.status) log.push({ at: new Date().toISOString(), text: `Status: ${I.REPAIR_STATUS[v.status]}` });
      state.repairs = state.repairs || [];
      upsert("repairs", { ...r, ...v, log });
      const note = (state.notes || []).find((n) => n.repairId === r.id);
      if (note && v.status === "erledigt" && !note.done) { note.done = true; note.doneAt = today(); }
      commit(isNew ? "Reparatur angelegt" : "Gespeichert");
      if (r.portalItemId && isCloud() && before !== v.status) {
        Cloud.portalUpdateItem(r.portalItemId, { status: v.status === "erledigt" || v.status === "abgelehnt" ? "erledigt" : "in_bearbeitung" }).catch(() => {});
        if (v.status === "erledigt" && r.tenantId && confirm("Mieter im Portal informieren, dass die Reparatur erledigt ist?")) Cloud.portalPost({ owner_id: wsId(), tenant_key: r.tenantId, direction: "vermieter", kind: "nachricht", title: `Erledigt: ${v.title}`, body: "Die gemeldete Reparatur ist erledigt. Bitte melden Sie sich, falls noch etwas nicht in Ordnung ist.", created_by: auth.user.id }).catch(() => {});
      }
      if (isNew) setTimeout(() => editRepair(r.id), 50);
    },
  });
}

// Bereits im laufenden Jahr vom Mieter getragene Kleinreparaturen
function kleinRepSpent(c, exceptId) {
  const y = today().slice(0, 4);
  return sum((state.repairs || []).filter((x) => x.id !== exceptId && x.payer === "kleinreparatur" && x.unitId === c.unitId && (x.doneAt || x.reportedAt || "").startsWith(y)), (x) => I.repairCost(state, x));
}

function repairExpense(id) {
  const r = state.repairs.find((x) => x.id === id);
  const e = { id: C.uid("e_"), date: today(), category: r.kind === "modernisierung" ? "herstellung" : r.payer === "umlage" ? "versorgung" : "erhaltung", objectId: r.objectId, vendor: r.contractor?.name || "", note: `Reparatur: ${r.title}`, amount: r.quote || 0, txId: null, distribute: "1" };
  if ($("#modal").open) $("#modal").close();
  formDialog({
    title: `Handwerkerrechnung zu „${r.title}“`, spec: SPEC.expense, data: e,
    intro: `<div class="note small">Wird als Ausgabe gebucht (Anlage V, DATEV) und mit dem Auftrag verknüpft. ${r.payer === "kleinreparatur" ? "Kleinreparatur: Den Betrag vom Mieter anfordern (Brief „Kostenbeteiligung“) – die Erstattung als Einnahme erfassen." : r.payer === "versicherung" ? "Versicherungsfall: Die Erstattung der Versicherung später als Einnahme erfassen." : ""}</div>`,
    onSave: (v) => {
      const exp = { ...e, ...v, amount: Math.abs(v.amount), repairId: r.id };
      state.expenses.push(exp);
      r.expenseIds = [...(r.expenseIds || []), exp.id];
      (r.log ||= []).push({ at: new Date().toISOString(), text: `Rechnung ${eur(exp.amount)} erfasst` });
      if (r.status !== "erledigt" && confirm("Auftrag als erledigt markieren?")) { r.status = "erledigt"; r.doneAt = today(); }
      commit("Kosten erfasst");
      setTimeout(() => editRepair(r.id), 50);
    },
  });
}

function repairOrderText(id) {
  const r = state.repairs.find((x) => x.id === id), s = state.settings, o = byId("objects", r.objectId), u = byId("units", r.unitId);
  const c = activeContractFor(r.unitId), t = c ? state.tenants.find((x) => c.tenantIds.includes(x.id)) : null;
  const text = `Sehr geehrte Damen und Herren,

hiermit beauftrage ich Sie mit folgender Arbeit:

${r.title}${r.description ? `\n${r.description}` : ""}

Ort: ${[o?.street, [o?.zip, o?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}${u ? `, ${u.name}` : ""}
${t ? `Ansprechpartner vor Ort (Mieter): ${t.name}${t.phone ? `, Tel. ${t.phone}` : ""}\n` : ""}${r.dueDate ? `Gewünschter Termin bis: ${d(r.dueDate)}\n` : ""}${r.quote ? `Grundlage: Ihr Angebot über ${eur(r.quote)}.\n` : "Bitte informieren Sie mich vorab, falls die Kosten 500 € übersteigen.\n"}
Bitte stellen Sie die Rechnung auf:
${s.ownerName}, ${[s.ownerStreet, [s.ownerZip, s.ownerCity].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
und weisen Sie den Lohnanteil gesondert aus (Steuerermäßigung § 35a EStG für den Mieter bei umlagefähigen Kosten).

Mit freundlichen Grüßen
${s.ownerName}${s.ownerPhone ? `\nTel. ${s.ownerPhone}` : ""}`;
  textShareDialog(`Auftrag an ${r.contractor?.name || "Handwerker"}`, text, r.contractor?.email, `Auftrag: ${r.title}`, () => {
    if (r.status === "gemeldet") r.status = "beauftragt";
    (r.log ||= []).push({ at: new Date().toISOString(), text: `Auftrag an ${r.contractor?.name || "Handwerker"} verschickt` });
    commit("Als beauftragt markiert");
  });
}

// Ankündigung an den Mieter (Erhaltungsmaßnahme § 555a BGB: rechtzeitig ankündigen, Duldungspflicht)
function repairNoticeText(id) {
  const r = state.repairs.find((x) => x.id === id), s = state.settings, u = byId("units", r.unitId);
  const c = activeContractFor(r.unitId), t = c ? state.tenants.find((x) => c.tenantIds.includes(x.id)) : null;
  const text = `Guten Tag${t ? " " + t.name : ""},

${r.reportedBy === "mieter" ? "vielen Dank für Ihre Meldung. " : ""}wegen „${r.title}“ in Ihrer Wohnung (${u?.name || ""}) habe ich ${r.contractor?.name ? `die Firma ${r.contractor.name}` : "einen Handwerker"} beauftragt.${r.dueDate ? ` Geplant ist der Termin bis ${d(r.dueDate)}.` : ""}${r.contractor?.phone ? ` Die Firma meldet sich zur Terminabsprache bei Ihnen (Tel. ${r.contractor.phone}).` : ""}

Bitte ermöglichen Sie den Zugang zur Wohnung. Es handelt sich um eine Erhaltungsmaßnahme (§ 555a BGB).

Mit freundlichen Grüßen
${s.ownerName}`;
  textShareDialog("Mieter informieren", text, t?.email, `Reparatur: ${r.title}`, () => { (r.log ||= []).push({ at: new Date().toISOString(), text: "Mieter informiert" }); commit(); });
}

function textShareDialog(title, text, email, subject, onSent) {
  if ($("#modal").open) $("#modal").close();
  dialog({
    title, submit: "📋 Kopieren", wide: true,
    body: `<label class="f"><span>Text (anpassbar)</span><textarea name="text" style="min-height:300px">${esc(text)}</textarea></label>
      <div class="toolbar"><a class="btn" data-mail href="#">✉️ Im Mail-Programm öffnen${email ? ` (${esc(email)})` : ""}</a><a class="btn" data-wa target="_blank" rel="noopener" href="#">💬 WhatsApp</a></div>`,
    onOpen: (form) => {
      form.querySelector("[data-mail]").onclick = (e) => { e.preventDefault(); location.href = `mailto:${encodeURIComponent(email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(form.text.value)}`; onSent?.(); $("#modal").close(); };
      form.querySelector("[data-wa]").onclick = () => { form.querySelector("[data-wa]").href = `https://wa.me/?text=${encodeURIComponent(form.text.value)}`; onSent?.(); };
    },
    onSubmit: (form) => { copyText(form.text.value); onSent?.(); },
  });
}

function editMaint(id, preset = {}) {
  const m = (state.maintenance || []).find((x) => x.id === id) || { id: C.uid("w_"), months: 12, objectId: ui.instObj || state.objects[0]?.id, active: true, ...preset };
  formDialog({
    title: id ? "Wartung bearbeiten" : "Neue Wartung / Prüfung", data: { ...m, active: m.active !== false },
    spec: [
      { k: "title", l: "Was?", req: 1, full: 1, ph: "z. B. Heizungswartung" },
      { k: "objectId", l: "Objekt", t: "select", opts: () => objectOpts() },
      { k: "months", l: "Intervall (Monate)", t: "number" },
      { k: "lastDone", l: "Zuletzt erledigt", t: "date" },
      { k: "firstDue", l: "Erstmals fällig (wenn noch nie erledigt)", t: "date" },
      { k: "contractor", l: "Firma / Ansprechpartner" },
      { k: "betrkv", l: "Kostenart in der NK-Abrechnung", t: "select", opts: () => [["", "nicht umlagefähig"], ...C.BETRKV.map(([k, l]) => [k, l])] },
      { k: "note", l: "Hinweis", full: 1 },
      { k: "active", l: "aktiv (Erinnerung)", t: "checkbox" },
    ],
    onSave: (v) => { state.maintenance = state.maintenance || []; upsert("maintenance", { ...m, ...v, months: Number(v.months) || 12 }); commit("Wartung gespeichert"); },
    onDelete: id && (() => { state.maintenance = state.maintenance.filter((x) => x.id !== id); commit("Wartung gelöscht"); }),
  });
}

function maintDone(id) {
  const m = state.maintenance.find((x) => x.id === id);
  formDialog({
    title: `✓ ${m.title} erledigt`, data: { date: today(), amount: "" },
    spec: [{ k: "date", l: "Erledigt am", t: "date", req: 1 }, { k: "amount", l: "Kosten brutto (€, optional)", t: "moneyOpt" }, { k: "vendor", l: "Firma", ph: m.contractor || "" }],
    intro: `<p class="small muted" style="margin-bottom:8px">Der nächste Termin wird automatisch berechnet (${m.months} Monate).${m.betrkv ? " Die Kosten werden als umlagefähige Betriebskosten gebucht." : ""}</p>`,
    onSave: (v) => {
      m.lastDone = v.date;
      if (typeof v.amount === "number" && v.amount > 0) {
        const exp = { id: C.uid("e_"), date: v.date, amount: Math.abs(v.amount), category: m.betrkv ? "versorgung" : "erhaltung", objectId: m.objectId, betrkv: m.betrkv || "", vendor: v.vendor || m.contractor || "", note: `Wartung: ${m.title}`, txId: null, distribute: "1" };
        state.expenses.push(exp);
        state.repairs = state.repairs || [];
        state.repairs.push({ id: C.uid("r_"), title: m.title, objectId: m.objectId, unitId: "", kind: "wartung", priority: "normal", status: "erledigt", reportedAt: v.date, doneAt: v.date, payer: m.betrkv ? "umlage" : "vermieter", expenseIds: [exp.id], docIds: [], contractor: { name: v.vendor || m.contractor || "" }, log: [{ at: new Date().toISOString(), text: "aus Wartungsplan" }] });
      }
      commit(`Erledigt – nächster Termin ${d(I.nextDue(m))}`);
    },
  });
}

function maintTemplates() {
  if (!state.objects.length) return toast("Bitte zuerst ein Objekt anlegen.");
  const objId = ui.instObj || state.objects[0].id;
  const have = new Set((state.maintenance || []).filter((m) => m.objectId === objId).map((m) => m.key));
  dialog({
    title: `Typische Wartungen für ${objName(objId)}`, submit: "Übernehmen",
    body: `<p class="small muted" style="margin-bottom:8px">Häkchen setzen, was es im Haus gibt. Erstmals fällig: in 30 Tagen (anpassbar).</p>
      ${I.MAINT_TEMPLATES.map((t) => `<label class="f inline"><input type="checkbox" name="t_${t.key}" ${have.has(t.key) ? "disabled" : ["heizung", "rauchmelder", "schornstein"].includes(t.key) ? "checked" : ""}> <span><b>${esc(t.title)}</b> · alle ${t.months} Monate<br><span class="small muted">${esc(t.note)}</span></span></label>`).join("")}`,
    onSubmit: (form) => {
      state.maintenance = state.maintenance || [];
      let n = 0;
      for (const t of I.MAINT_TEMPLATES) if (form[`t_${t.key}`]?.checked && !have.has(t.key)) { state.maintenance.push({ id: C.uid("w_"), key: t.key, title: t.title, months: t.months, betrkv: t.betrkv, note: t.note, objectId: objId, firstDue: addDays(today(), 30), active: true }); n++; }
      commit(`${n} Wartungen in den Plan übernommen`);
    },
  });
}

// ---------------------------------------------------------------- Mieterportal – Vermieter-Seite

const PORTAL_INVITE_KEY = "hausops-immo-portal-invite";
const portalLink = (token) => `${location.origin}${location.pathname}#/mieterportal/${token}`;
const PKIND = { nachricht: "✉️ Nachricht", mangel: "🔧 Schadensmeldung", zaehler: "📟 Zählerstand", dokument: "📄 Dokument" };
const PSTATUS = { neu: "neu", gesehen: "gesehen", in_bearbeitung: "in Bearbeitung", erledigt: "erledigt" };
const ROOMS = ["Küche", "Bad", "WC", "Wohnzimmer", "Schlafzimmer", "Kinderzimmer", "Flur", "Balkon / Terrasse", "Keller", "Treppenhaus", "Außenbereich", "Sonstiges"];
const portalData = () => (ui.portal && ui.portal.ws === wsId() ? ui.portal : null);
const portalUnread = () => (portalData()?.items || []).filter((i) => i.direction === "mieter" && !i.read_by_owner_at).length;
const portalRowFor = (tid) => portalData()?.tenants.find((t) => t.tenant_key === tid);
const fmtAt = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

async function loadPortal() {
  if (!isCloud() || auth.portalView || ui.portalBusy) return;
  ui.portalBusy = true;
  const ws = wsId();
  try {
    const [tenants, items] = await Promise.all([Cloud.portalTenants(ws), Cloud.portalItems(ws)]);
    ui.portal = { tenants, items, ws, at: Date.now() };
  } catch { ui.portal = { tenants: [], items: [], ws, unavailable: true }; }
  ui.portalBusy = false;
}

// Was der Mieter im Portal sieht – nur seine eigenen Vertragsdaten
function portalInfo(tid) {
  const t = byId("tenants", tid), s = state.settings;
  const cs = state.contracts.filter((c) => c.tenantIds.includes(tid)).sort((a, b) => (a.start < b.start ? 1 : -1));
  const c = cs.find((x) => x.start <= today() && (!x.end || x.end >= today())) || cs[0];
  const u = c && byId("units", c.unitId), o = u && byId("objects", u.objectId);
  const r = c ? C.rentForMonth(c, C.monthKey(today())) : null;
  return {
    name: t?.name || "", unit: u?.name || "", address: o ? [o.street, [o.zip, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "",
    start: c?.start || "", end: c?.end || "", kaution: c?.kaution || 0,
    rent: r ? { kalt: r.kalt, nk: r.nk, extra: r.extra, total: r.total } : null,
    landlord: { name: s.ownerName || "", phone: s.ownerPhone || "", email: s.ownerEmail || "", address: [s.ownerStreet, [s.ownerZip, s.ownerCity].filter(Boolean).join(" ")].filter(Boolean).join(", ") },
    bank: s.invoiceIban ? { iban: s.invoiceIban, bank: s.invoiceBank || "", purpose: `Miete ${u?.name || ""} ${t?.name || ""}`.trim() } : null,
    emergency: s.portalEmergency || "",
    meterTypes: [...new Set((state.meterReadings || []).filter((m) => m.unitId === u?.id).map((m) => m.type))],
    updated: today(),
  };
}

function portalCard(tid) {
  if (!isCloud()) return `<div class="card"><h2>🔑 Mieterportal</h2><p class="small muted">Mieter melden Schäden mit Foto, schicken Zählerstände und sehen ihre Dokumente – im Konto-Modus (mit Anmeldung) verfügbar.</p></div>`;
  const pd = portalData();
  if (!pd) { loadPortal().then(() => location.hash.startsWith("#/mieter/") && render()); return `<div class="card"><h2>🔑 Mieterportal</h2><p class="muted small">Lade …</p></div>`; }
  if (pd.unavailable) return `<div class="card"><h2>🔑 Mieterportal</h2><div class="note small">Das Mieterportal ist auf dem Server noch nicht eingerichtet (Datenbank-Update „portal“ fehlt – siehe README).</div></div>`;
  const row = portalRowFor(tid);
  const items = pd.items.filter((i) => i.tenant_key === tid);
  if (row && !row.revoked_at && (row.info?.updated || "") !== today() && canWrite()) { row.info = portalInfo(tid); Cloud.portalUpdateTenant(row.id, { info: row.info }).catch(() => {}); } // Infos aktuell halten
  const status = !row || row.revoked_at ? '<span class="badge grey">nicht eingeladen</span>' : row.accepted_at ? '<span class="badge ok">aktiv</span>' : '<span class="badge warn">eingeladen</span>';
  return `<div class="card"><h2>🔑 Mieterportal ${status}</h2>
    ${row && !row.revoked_at ? `<p class="small muted" style="margin-bottom:8px">${row.accepted_at ? `Aktiv seit ${d(row.accepted_at.slice(0, 10))}` : `Eingeladen am ${d(row.invited_at.slice(0, 10))} (${esc(row.email)})`} · ${items.length} Einträge${items.some((i) => i.direction === "mieter" && !i.read_by_owner_at) ? " · <b>neue Nachricht</b>" : ""}</p>` : '<p class="small muted" style="margin-bottom:8px">Der Mieter kann Schäden mit Foto melden, Zählerstände schicken, Nachrichten schreiben und freigegebene Dokumente ansehen – er sieht nur seine eigenen Daten.</p>'}
    <div class="toolbar">${!row || row.revoked_at ? btn("portalInvite", "🔑 Zum Portal einladen", "primary", tid) : `${!row.accepted_at ? btn("portalInvite", "Einladung erneut senden", "", tid) : ""}${btn("portalWrite", "✉️ Nachricht", "", tid)}<a class="btn" href="#/portal">Postfach</a>${btn("portalRevoke", "Zugang entziehen", "danger", tid)}`}</div></div>`;
}

function portalInvite(tid) {
  if (!isCloud()) return alert("Das Mieterportal gibt es im Konto-Modus (mit Anmeldung, Daten online).");
  if (!canWrite()) return blockedWrite();
  const t = byId("tenants", tid), row = portalRowFor(tid);
  dialog({
    title: `${t.name} zum Mieterportal einladen`, submit: "Einladung erstellen",
    body: `<label class="f"><span>E-Mail-Adresse des Mieters *</span><input name="email" type="email" required value="${esc(row?.email || t.email || "")}"></label>
      <label class="f"><span>Notfall-Kontakte für alle Mieter (optional)</span><textarea name="emergency" placeholder="z. B. Wasserrohrbruch / Heizungsausfall: Hausmeister Müller 0171 …">${esc(state.settings.portalEmergency || "")}</textarea></label>
      <div class="note small">Der Mieter sieht nur: Wohnung & Anschrift, Miete und Kaution laut Vertrag, Bankverbindung für die Miete, deine Kontaktdaten, Notfall-Kontakte, freigegebene Dokumente und eure Nachrichten. Rechtlich bist du Verantwortlicher (Art. 4 Nr. 7 DSGVO); der Mieter muss seinen Zugang selbst anlegen und den Datenschutzhinweisen zustimmen.</div>`,
    onSubmit: (form) => {
      const email = form.email.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Bitte eine gültige E-Mail-Adresse eingeben."); return false; }
      if (form.emergency.value.trim() !== (state.settings.portalEmergency || "")) { state.settings.portalEmergency = form.emergency.value.trim(); persist(); }
      if (!t.email) { t.email = email; persist(); }
      (async () => {
        try {
          const changed = !row || row.email !== email || row.revoked_at;
          const saved = await Cloud.portalSaveTenant({ owner_id: wsId(), tenant_key: tid, email, info: portalInfo(tid), revoked_at: null,
            expires_at: new Date(Date.now() + 30 * 864e5).toISOString(), invited_at: new Date().toISOString(),
            ...(changed ? { token: crypto.randomUUID(), user_id: null, accepted_at: null } : {}) });
          if (!row) await Cloud.portalPost({ owner_id: wsId(), tenant_key: tid, direction: "vermieter", kind: "nachricht", title: "Willkommen im Mieterportal", body: `Hier können Sie Schäden mit Foto melden, Zählerstände schicken und mir schreiben. Ihre Unterlagen finden Sie unter „Dokumente“.\n\nViele Grüße\n${state.settings.ownerName || ""}`, created_by: auth.user.id }).catch(() => {});
          await loadPortal(); render();
          const text = `Guten Tag ${t.name},\n\nfür Ihre Wohnung gibt es ab sofort ein Mieterportal. Dort können Sie Schäden mit Foto melden, Zählerstände übermitteln, mir Nachrichten schreiben und Ihre Unterlagen abrufen.\n\nBitte öffnen Sie diesen Link und legen Sie mit ${email} einen Zugang an:\n${portalLink(saved.token)}\n\nDer Link ist 30 Tage gültig.\n\nViele Grüße\n${state.settings.ownerName || ""}`;
          textShareDialog("Einladung zum Mieterportal verschicken", text, email, "Ihr Zugang zum Mieterportal", null);
        } catch (e) { alert("Einladung fehlgeschlagen: " + e.message); }
      })();
    },
  });
}

async function portalRevoke(tid) {
  const row = portalRowFor(tid), t = byId("tenants", tid);
  if (!row || !confirm(`${t?.name || "Mieter"} den Zugang zum Mieterportal entziehen? Nachrichten und Meldungen bleiben bei dir gespeichert.`)) return;
  try { await Cloud.portalUpdateTenant(row.id, { revoked_at: new Date().toISOString() }); await loadPortal(); toast("Zugang entzogen"); render(); } catch (e) { alert(e.message); }
}

function portalWrite(tid, replyTo = null) {
  const t = byId("tenants", tid), it = replyTo && portalData()?.items.find((x) => x.id === Number(replyTo));
  dialog({
    title: `Nachricht an ${t?.name || "Mieter"}`, submit: "Senden",
    body: `<label class="f"><span>Betreff</span><input name="title" value="${esc(it ? `Re: ${it.title}` : "")}" required></label>
      <label class="f"><span>Nachricht</span><textarea name="body" style="min-height:140px" required></textarea></label>
      <p class="small muted">Erscheint sofort im Mieterportal${t?.email ? `; der Mieter sieht sie beim nächsten Öffnen` : ""}.</p>`,
    onSubmit: (form) => {
      if (!form.title.value.trim() || !form.body.value.trim()) { toast("Bitte Betreff und Text eingeben."); return false; }
      Cloud.portalPost({ owner_id: wsId(), tenant_key: tid, direction: "vermieter", kind: "nachricht", title: form.title.value.trim(), body: form.body.value.trim(), data: it ? { replyTo: it.id } : {}, created_by: auth.user.id })
        .then(async () => { if (it && it.status === "neu") await Cloud.portalUpdateItem(it.id, { status: "gesehen" }).catch(() => {}); await loadPortal(); toast("Nachricht gesendet"); render(); }, (e) => alert(e.message));
    },
  });
}

async function portalShareDoc(docId, tid) {
  if (!isCloud()) return alert("Dokumente teilen geht im Konto-Modus mit Mieterportal.");
  const doc = byId("documents", docId), row = portalRowFor(tid);
  if (!row || row.revoked_at) return alert("Bitte den Mieter zuerst zum Mieterportal einladen.");
  if (!confirm(`„${doc.name}“ im Mieterportal für ${byId("tenants", tid)?.name} freigeben?`)) return;
  try {
    const blob = await getDocBlob(docId);
    if (!blob) throw new Error("Datei nicht gefunden");
    const path = `${wsId()}/portal/${tid}/${docId}-${doc.name.replace(/[^\w.äöüÄÖÜß -]+/g, "_").slice(0, 60)}`;
    await Cloud.uploadPath(path, blob);
    await Cloud.portalPost({ owner_id: wsId(), tenant_key: tid, direction: "vermieter", kind: "dokument", title: doc.name, body: DOC_KINDS[doc.kind] || "", data: { path, type: doc.type, docId }, created_by: auth.user.id });
    doc.sharedWith = [...new Set([...(doc.sharedWith || []), tid])]; commit("Im Mieterportal freigegeben");
    await loadPortal();
  } catch (e) { alert("Teilen fehlgeschlagen: " + e.message); }
}

// Schadensmeldung → Reparaturauftrag (Fotos werden in die eigene Ablage übernommen)
async function portalToRepair(itemId) {
  const it = portalData().items.find((x) => x.id === Number(itemId));
  if (!canWrite()) return blockedWrite();
  const tid = it.tenant_key, c = state.contracts.find((x) => x.tenantIds.includes(tid) && x.start <= today() && (!x.end || x.end >= today())) || state.contracts.find((x) => x.tenantIds.includes(tid));
  const u = byId("units", c?.unitId), rid = C.uid("r_"), docIds = [];
  toast("Übernehme Meldung und Fotos …");
  for (const path of it.data?.photos || []) {
    try {
      const blob = await Cloud.downloadPath(path);
      const id = C.uid("d_");
      await putDocBlob(id, blob);
      let thumb = ""; try { thumb = (await F.prepareImage(new File([blob], "foto.jpg", { type: blob.type || "image/jpeg" }), false)).thumb; } catch {}
      state.documents.push({ id, name: `Foto Mieter – ${it.title}`.slice(0, 80), type: blob.type || "image/jpeg", size: blob.size, thumb, created: new Date().toISOString(), kind: "foto", objectId: u?.objectId || "", contractId: c?.id || "", status: "verarbeitet", note: "aus Mieterportal", repairId: rid, ki: null });
      docIds.push(id);
    } catch {}
  }
  state.repairs = state.repairs || [];
  state.repairs.push({ id: rid, title: it.title, description: [it.data?.room && `Raum: ${it.data.room}`, it.body].filter(Boolean).join("\n"), objectId: u?.objectId || state.objects[0]?.id, unitId: u?.id || "", kind: "reparatur",
    priority: it.data?.urgent ? "dringend" : "normal", status: "gemeldet", reportedAt: it.created_at.slice(0, 10), reportedBy: "mieter", tenantId: tid, payer: "vermieter", expenseIds: [], docIds, portalItemId: it.id,
    log: [{ at: new Date().toISOString(), text: "aus Mieterportal übernommen" }] });
  commit("Reparaturauftrag angelegt");
  await Cloud.portalUpdateItem(it.id, { status: "in_bearbeitung", data: { ...(it.data || {}), repairId: rid } }).catch(() => {});
  await loadPortal();
  editRepair(rid);
}

async function portalToMeter(itemId) {
  const it = portalData().items.find((x) => x.id === Number(itemId));
  if (!canWrite()) return blockedWrite();
  const tid = it.tenant_key, c = state.contracts.find((x) => x.tenantIds.includes(tid) && x.start <= today() && (!x.end || x.end >= today()));
  if (!c) return alert("Kein aktiver Mietvertrag für diesen Mieter gefunden.");
  const v = Number(String(it.data?.value ?? "").replace(",", "."));
  if (!Number.isFinite(v)) return alert("Der gemeldete Zählerstand ist keine Zahl.");
  state.meterReadings.push({ id: C.uid("m_"), unitId: c.unitId, contractId: c.id, type: it.data?.type || "sonstiges", number: it.data?.number || "", date: it.data?.date || it.created_at.slice(0, 10), value: v, reason: "mieter" });
  commit("Zählerstand übernommen");
  await Cloud.portalUpdateItem(it.id, { status: "erledigt" }).catch(() => {});
  await loadPortal(); render();
}

function viewPortalInbox() {
  if (!isCloud()) return head("Mieterportal") + `<div class="card empty"><div class="big">🔑</div><p>Mit dem Mieterportal melden deine Mieter Schäden mit Foto, schicken Zählerstände, schreiben dir Nachrichten und sehen ihre Unterlagen – ohne Zettelwirtschaft.</p><p class="muted">Verfügbar im Konto-Modus (Anmeldung, Daten sicher online).</p></div>`;
  const pd = portalData();
  if (!pd) { loadPortal().then(render); return head("Mieterportal") + '<div class="card muted">Lade …</div>'; }
  if (pd.unavailable) return head("Mieterportal") + '<div class="card"><div class="note">Das Mieterportal ist auf dem Server noch nicht eingerichtet (Datenbank-Update „portal“ in Supabase ausführen – siehe README).</div></div>';
  const unread = pd.items.filter((i) => i.direction === "mieter" && !i.read_by_owner_at);
  if (unread.length && !ui.portalMarking && canWrite()) { ui.portalMarking = true; Cloud.portalMarkOwnerRead(wsId()).then(() => { for (const i of unread) i.read_by_owner_at = new Date().toISOString(); }, () => {}).finally(() => { ui.portalMarking = false; }); }
  const f = ui.portalFilter || "offen";
  const tName = (k) => byId("tenants", k)?.name || "Mieter";
  const list = pd.items.filter((i) => i.direction === "mieter" && (f === "alle" || i.status !== "erledigt"));
  const active = state.contracts.filter((c) => c.start <= today() && (!c.end || c.end >= today()));
  const tenants = [...new Set(active.flatMap((c) => c.tenantIds))].map((id) => byId("tenants", id)).filter(Boolean);
  const card = (i) => `<div class="card pitem ${!i.read_by_owner_at ? "unread" : ""}">
      <div class="head" style="margin-bottom:4px"><div><b>${PKIND[i.kind]}</b> · ${esc(tName(i.tenant_key))} <span class="small muted">· ${fmtAt(i.created_at)}</span>${!i.read_by_owner_at ? ' <span class="badge warn">neu</span>' : ""}${i.data?.urgent ? ' <span class="badge bad">dringend</span>' : ""}</div>
        <select data-change="portalStatus" data-id="${i.id}" style="width:auto">${opt(Object.entries(PSTATUS), i.status)}</select></div>
      <div><b>${esc(i.title)}</b>${i.kind === "zaehler" ? `: <b>${esc(String(i.data?.value ?? "").replace(".", ","))}</b>${i.data?.number ? ` (Zähler ${esc(i.data.number)})` : ""}, abgelesen ${d(i.data?.date || i.created_at.slice(0, 10))}` : ""}${i.data?.room ? ` <span class="small muted">· ${esc(i.data.room)}</span>` : ""}</div>
      ${i.body ? `<div class="small" style="white-space:pre-wrap;margin-top:4px">${esc(i.body)}</div>` : ""}
      ${(i.data?.photos || []).length ? `<div class="inline" style="margin-top:6px">${i.data.photos.map((p) => `<img class="pphoto" data-ppath="${esc(p)}" alt="Foto">`).join("")}</div>` : ""}
      <div class="toolbar" style="margin-top:8px">${btn("portalReply", "↩ Antworten", "sm", `${i.tenant_key}|${i.id}`)}${i.kind === "mangel" ? (i.data?.repairId && (state.repairs || []).some((r) => r.id === i.data.repairId) ? btn("editRepair", "🔧 Zum Auftrag", "sm", i.data.repairId) : btn("portalToRepair", "🔧 Als Reparatur übernehmen", "sm primary", i.id)) : ""}${i.kind === "zaehler" && i.status !== "erledigt" ? btn("portalToMeter", "📟 Zählerstand übernehmen", "sm primary", i.id) : ""}</div></div>`;
  return head("Mieterportal", "Meldungen und Nachrichten deiner Mieter", `<div class="tabs" style="margin:0">${[["offen", "Offen"], ["alle", "Alle"]].map(([k, l]) => `<button data-act="portalFilter" data-id="${k}" class="${f === k ? "active" : ""}">${l}</button>`).join("")}</div>`) + `
    ${list.length ? list.map(card).join("") : '<div class="card muted">Keine offenen Meldungen. 👍</div>'}
    <div class="card"><h2>Mieter & Zugänge</h2><div class="table-wrap"><table><tbody>${tenants.map((t) => { const row = portalRowFor(t.id); return `<tr><td><a href="#/mieter/${t.id}">${esc(t.name)}</a></td><td>${!row || row.revoked_at ? '<span class="badge grey">nicht eingeladen</span>' : row.accepted_at ? '<span class="badge ok">aktiv</span>' : '<span class="badge warn">eingeladen</span>'}</td><td class="nowrap">${!row || row.revoked_at ? btn("portalInvite", "Einladen", "sm", t.id) : btn("portalWrite", "✉️ Nachricht", "sm", t.id)}</td></tr>`; }).join("") || '<tr><td class="muted">Keine aktiven Mietverhältnisse.</td></tr>'}</tbody></table></div>
      <label class="f" style="margin-top:10px"><span>Notfall-Kontakte (für alle Mieter sichtbar)</span><textarea data-change="portalEmergency" placeholder="z. B. Wasserrohrbruch / Heizungsausfall: Hausmeister Müller 0171 …">${esc(state.settings.portalEmergency || "")}</textarea></label></div>`;
}

// Fotos aus dem Portal nachladen
async function hydratePortalImages() {
  ui.pimg = ui.pimg || {};
  for (const img of document.querySelectorAll("img[data-ppath]:not([src])")) {
    const p = img.dataset.ppath;
    try {
      if (!ui.pimg[p]) ui.pimg[p] = URL.createObjectURL(await Cloud.downloadPath(p));
      img.src = ui.pimg[p];
      img.onclick = () => window.open(ui.pimg[p], "_blank");
    } catch { img.alt = "Foto nicht verfügbar"; }
  }
}

// ---------------------------------------------------------------- Mieterportal – Mieter-Seite

const curPortal = () => (auth.portals || []).find((x) => x.id === auth.portalView);

async function loadTenantItems() {
  const p = curPortal(); if (!p) return;
  try {
    const items = await Cloud.portalItems(p.owner_id, p.tenant_key);
    const changed = JSON.stringify(items.map((i) => [i.id, i.status])) !== JSON.stringify((ui.tp?.items || []).map((i) => [i.id, i.status]));
    ui.tp = { id: p.id, items };
    if (changed) render();
    if (items.some((i) => i.direction === "vermieter" && !i.read_by_tenant_at)) Cloud.portalMarkRead(p.owner_id, p.tenant_key).catch(() => {});
  } catch (e) { ui.tp = { id: p.id, items: [], error: e.message }; render(); }
}

function startPortalPoll() {
  if (ui.portalPoll) return;
  ui.portalPoll = setInterval(() => { if (document.visibilityState === "visible" && auth.portalView) loadTenantItems(); }, 45 * 1000);
}

const pfact = (l, v) => (v ? `<div><span class="muted small">${l}</span><br>${v}</div>` : "");
function viewTenantPortal() {
  const p = curPortal();
  const isLandlord = auth.profile?.account_type !== "mieter";
  const top = `<div class="tp-top"><div class="logo"><img src="./assets/icon.svg" alt="" class="logo-icon">Mieterportal</div><div class="toolbar">${isLandlord ? btn("portalLeave", "← Zu meinem Bestand", "sm") : ""}${btn("logout", "Abmelden", "sm")}</div></div>`;
  if (!p) return `<div class="tp">${top}<div class="card"><h2>Noch kein Zugang freigeschaltet</h2><p>Ihr Konto ist angelegt. Sobald Ihr Vermieter Sie einlädt (Einladung an <b>${esc(auth.user.email)}</b>), erscheint hier Ihr Portal. Bitte melden Sie sich dann erneut an.</p></div></div>`;
  if (!ui.tp || ui.tp.id !== p.id) { ui.tp = { id: p.id, items: null }; loadTenantItems(); }
  const info = p.info || {}, items = ui.tp.items, r = info.rent;
  const docs = (items || []).filter((i) => i.kind === "dokument");
  const timeline = (items || []).filter((i) => i.kind !== "dokument");
  const first = (info.name || auth.profile?.full_name || "").split(/\s+/)[0];
  const tile = (ic, label, act) => `<button class="qtile" data-act="${act}"><span>${ic}</span>${label}</button>`;
  return `<div class="tp">${top}
    <div class="tp-hello"><h1>Hallo ${esc(first)} 👋</h1><p class="muted">${esc([info.unit, info.address].filter(Boolean).join(" · "))}${p.owner_name ? ` · Vermieter: ${esc(p.owner_name)}` : ""}</p></div>
    <div class="qgrid tp-tiles">${tile("🔧", "Schaden melden", "tpReport")}${tile("📟", "Zählerstand melden", "tpMeter")}${tile("✉️", "Nachricht schreiben", "tpMessage")}${tile("📄", `Dokumente${docs.length ? ` (${docs.length})` : ""}`, "tpDocs")}</div>
    ${info.emergency ? `<div class="note warn"><b>🚨 Notfall</b> (z. B. Wasserrohrbruch, Heizungsausfall, Gasgeruch – bei Gasgeruch zuerst 112):<br>${esc(info.emergency).replace(/\n/g, "<br>")}</div>` : ""}
    <div class="grid g2">
      <div class="card"><h2>Ihre Miete</h2>${r ? `<div class="facts">${pfact("Kaltmiete", eur(r.kalt))}${pfact("Nebenkosten-Vorauszahlung", eur(r.nk))}${r.extra ? pfact("Zuschläge", eur(r.extra)) : ""}${pfact("Monatlich gesamt", `<b>${eur(r.total)}</b>`)}${info.kaution ? pfact("Kaution", eur(info.kaution)) : ""}${info.start ? pfact("Mietbeginn", d(info.start)) : ""}</div>` : '<p class="muted small">Keine Angaben.</p>'}
        ${info.bank ? `<p class="small" style="margin-top:8px">Überweisung an: <b>${esc(info.bank.iban)}</b>${info.bank.bank ? ` (${esc(info.bank.bank)})` : ""}<br>Verwendungszweck: ${esc(info.bank.purpose)}</p>` : ""}</div>
      <div class="card"><h2>Ihr Vermieter</h2><div class="facts">${pfact("Name", esc(info.landlord?.name || p.owner_name || ""))}${info.landlord?.phone ? pfact("Telefon", `<a href="tel:${esc(info.landlord.phone)}">${esc(info.landlord.phone)}</a>`) : ""}${info.landlord?.email ? pfact("E-Mail", `<a href="mailto:${esc(info.landlord.email)}">${esc(info.landlord.email)}</a>`) : ""}${info.landlord?.address ? pfact("Anschrift", esc(info.landlord.address)) : ""}</div></div>
    </div>
    <div class="card" id="tpdocs"><h2>📄 Dokumente</h2>${docs.length ? docs.map((x) => `<div class="docline"><span>📄 <b>${esc(x.title)}</b> <span class="small muted">${esc(x.body || "")} · ${d(x.created_at.slice(0, 10))}</span></span>${btn("tpOpenDoc", "Öffnen", "sm", x.id)}</div>`).join("") : '<p class="muted small">Noch keine Dokumente freigegeben.</p>'}</div>
    <div class="card"><h2>Verlauf</h2>${items === null ? '<p class="muted">Lade …</p>' : timeline.length ? timeline.map((i) => `<div class="timeline ${i.direction === "vermieter" ? "from-owner" : ""}"><div class="small muted">${fmtAt(i.created_at)} · ${i.direction === "vermieter" ? `von ${esc(p.owner_name || "Vermieter")}` : "von Ihnen"} · ${PKIND[i.kind]}${i.direction === "mieter" ? ` · <span class="badge ${i.status === "erledigt" ? "ok" : i.status === "neu" ? "warn" : ""}">${PSTATUS[i.status]}</span>` : ""}</div>
      <b>${esc(i.title)}</b>${i.kind === "zaehler" ? `: ${esc(String(i.data?.value ?? "").replace(".", ","))}` : ""}${i.body ? `<div class="small" style="white-space:pre-wrap">${esc(i.body)}</div>` : ""}
      ${(i.data?.photos || []).length ? `<div class="inline" style="margin-top:4px">${i.data.photos.map((ph) => `<img class="pphoto" data-ppath="${esc(ph)}" alt="Foto">`).join("")}</div>` : ""}</div>`).join("") : '<p class="muted small">Noch keine Nachrichten.</p>'}</div>
    <p class="small muted" style="text-align:center;margin:16px 0">Verantwortlich für Ihre Daten ist Ihr Vermieter. ${legalLink("datenschutz", "Datenschutz")} · ${legalLink("impressum", "Impressum")}</p>
  </div>`;
}

// Fotos verkleinern und in den eigenen Mieterordner hochladen
async function tpUploadPhotos(files) {
  const p = curPortal(), paths = [];
  for (const file of [...(files || [])].slice(0, 6)) {
    if (!file.type.startsWith("image/")) continue;
    const { blob } = await F.prepareImage(file, false);
    const path = `${p.owner_id}/portal/${p.tenant_key}/mieter/${C.uid("f_")}.jpg`;
    await Cloud.uploadPath(path, blob);
    paths.push(path);
  }
  return paths;
}

async function tpPost(kind, title, body, data, files) {
  const p = curPortal();
  toast("Wird gesendet …");
  try {
    const photos = files?.length ? await tpUploadPhotos(files) : [];
    await Cloud.portalPost({ owner_id: p.owner_id, tenant_key: p.tenant_key, direction: "mieter", kind, title, body, data: { ...data, ...(photos.length ? { photos } : {}) }, created_by: auth.user.id });
    toast("✅ Gesendet – Ihr Vermieter wurde benachrichtigt");
    await loadTenantItems(); render();
  } catch (e) { alert("Senden fehlgeschlagen: " + e.message); }
}

function tpReport() {
  dialog({
    title: "🔧 Schaden melden", submit: "Meldung senden",
    body: `<label class="f"><span>Was ist kaputt? *</span><input name="title" required placeholder="z. B. Heizung im Bad wird nicht warm"></label>
      <label class="f"><span>Wo?</span><select name="room">${opt([["", "– bitte wählen –"], ...ROOMS.map((r) => [r, r])], "")}</select></label>
      <label class="f"><span>Beschreibung</span><textarea name="body" placeholder="Seit wann? Was genau passiert? Wann sind Sie zu Hause (für den Handwerker)?"></textarea></label>
      <label class="f"><span>Fotos (bis zu 6)</span><input type="file" name="photos" accept="image/*" multiple></label>
      <label class="f inline"><input type="checkbox" name="urgent"> Dringend (z. B. Wasser läuft aus, keine Heizung im Winter)</label>
      <p class="small muted">Bei Gefahr (Gasgeruch, Brand) bitte sofort 112 anrufen. ${curPortal()?.info?.emergency ? "Notfall-Kontakte stehen auf der Startseite des Portals." : ""}</p>`,
    onSubmit: (form) => {
      if (!form.title.value.trim()) { toast("Bitte kurz beschreiben, was kaputt ist."); return false; }
      tpPost("mangel", form.title.value.trim(), form.body.value.trim(), { room: form.room.value, urgent: form.urgent.checked }, form.photos.files);
    },
  });
}

function tpMeter() {
  const types = curPortal()?.info?.meterTypes?.length ? curPortal().info.meterTypes : Object.keys(C.METER_TYPES);
  dialog({
    title: "📟 Zählerstand melden", submit: "Senden",
    body: `<label class="f"><span>Zähler</span><select name="type">${opt(types.map((k) => [k, C.METER_TYPES[k] || k]), types[0])}</select></label>
      <label class="f"><span>Zählerstand *</span><input name="value" inputmode="decimal" required placeholder="z. B. 123,45"></label>
      <label class="f"><span>Zählernummer (optional)</span><input name="number"></label>
      <label class="f"><span>Abgelesen am</span><input type="date" name="date" value="${today()}"></label>
      <label class="f"><span>Foto vom Zähler (empfohlen)</span><input type="file" name="photos" accept="image/*" capture="environment"></label>`,
    onSubmit: (form) => {
      const v = String(form.value.value).trim().replace(/\s/g, "");
      if (!/^\d+([.,]\d+)?$/.test(v)) { toast("Bitte nur die Zahl eingeben, z. B. 123,45"); return false; }
      tpPost("zaehler", C.METER_TYPES[form.type.value] || form.type.value, "", { type: form.type.value, value: Number(v.replace(",", ".")), number: form.number.value.trim(), date: form.date.value }, form.photos.files);
    },
  });
}

function tpMessage() {
  dialog({
    title: "✉️ Nachricht an Ihren Vermieter", submit: "Senden",
    body: `<label class="f"><span>Betreff *</span><input name="title" required></label><label class="f"><span>Nachricht *</span><textarea name="body" style="min-height:150px" required></textarea></label>`,
    onSubmit: (form) => {
      if (!form.title.value.trim() || !form.body.value.trim()) { toast("Bitte Betreff und Nachricht eingeben."); return false; }
      tpPost("nachricht", form.title.value.trim(), form.body.value.trim(), {}, null);
    },
  });
}

async function tpOpenDoc(id) {
  const it = (ui.tp?.items || []).find((x) => x.id === Number(id));
  try {
    const blob = await Cloud.downloadPath(it.data.path);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener";
    if (!/^image\/|pdf/.test(blob.type)) a.download = it.title;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { alert("Dokument konnte nicht geladen werden: " + e.message); }
}

// Einladungs-Seite (vor der Anmeldung)
function viewTenantAuth() {
  const pi = ui.portalInvite, info = pi.info, st = auth.settings || {};
  const tab = ui.authTab === "login" ? "login" : "mieter";
  return `<div class="auth"><div class="auth-box card" style="margin:24px auto;max-width:460px">
    <h1 style="margin-bottom:6px">🔑 Mieterportal</h1>
    <p style="margin-bottom:12px">${info ? `<b>${esc(info.owner_name)}</b> lädt Sie zum Mieterportal ein.` : "Sie wurden zum Mieterportal eingeladen."} Hier melden Sie Schäden mit Foto, schicken Zählerstände und finden Ihre Unterlagen.</p>
    ${info && !info.valid ? '<div class="note warn">Diese Einladung ist nicht mehr gültig. Bitte bitten Sie Ihren Vermieter um eine neue.</div>' : ""}
    ${info?.email_hint ? `<p class="small muted" style="margin-bottom:8px">Bitte verwenden Sie die E-Mail-Adresse, an die die Einladung ging (${esc(info.email_hint)}).</p>` : ""}
    <div class="tabs"><button data-act="authTab" data-id="mieter" class="${tab === "mieter" ? "active" : ""}">Zugang anlegen</button><button data-act="authTab" data-id="login" class="${tab === "login" ? "active" : ""}">Ich habe schon einen Zugang</button></div>
    ${ui.authMsg ? `<div class="note">${esc(ui.authMsg)}</div>` : ""}
    ${tab === "mieter" ? `<form data-form="tenantRegister">
      <label class="f"><span>Ihr Name</span><input name="fullName" required autocomplete="name"></label>
      <label class="f"><span>E-Mail</span><input name="email" type="email" required autocomplete="email"></label>
      <label class="f"><span>Passwort (mind. 8 Zeichen)</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <label class="f inline small"><input type="checkbox" name="privacy" required> Ich habe die ${legalLink("datenschutz", "Datenschutzhinweise")} gelesen. Verantwortlich für meine Daten im Portal ist mein Vermieter.</label>
      <button class="btn primary" style="width:100%;justify-content:center">Zugang anlegen</button></form>`
    : `<form data-form="login"><label class="f"><span>E-Mail</span><input name="email" type="email" autocomplete="email" required></label>
      <label class="f"><span>Passwort</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary" style="width:100%;justify-content:center">Anmelden</button>
      <p class="small" style="margin-top:10px"><button type="button" class="btn link" data-act="authTab" data-id="reset">Passwort vergessen?</button></p></form>`}
    <p class="small muted" style="margin-top:12px">${legalLink("impressum", "Impressum")} · ${legalLink("datenschutz", "Datenschutz")}${` · ${esc(productName())}`}</p></div></div>`;
}

async function handlePortalInvites() {
  let token = null;
  try { token = sessionStorage.getItem(PORTAL_INVITE_KEY); sessionStorage.removeItem(PORTAL_INVITE_KEY); } catch {}
  if (token) { try { await Cloud.acceptPortalInvite(token); toast("Willkommen im Mieterportal!"); } catch (e) { alert(e.message); } }
  ui.portalInvite = null;
  const open = await Cloud.myPortalInvites().catch(() => []);
  for (const i of open || []) {
    if (confirm(`${i.owner_name} lädt Sie zum Mieterportal ein. Einladung annehmen?`)) await Cloud.acceptPortalInvite(i.token).catch((e) => alert(e.message));
  }
  auth.portals = (await Cloud.myPortals().catch(() => [])) || [];
}

// ---------------------------------------------------------------- Monatsbericht für den Steuerberater

const eurS = (c) => eur(c || 0);
const monthTitle = (key) => `${C.MONTHS_DE[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

function viewMonthReport(arg) {
  const key = /^\d{4}-\d{2}$/.test(arg || "") ? arg : C.addMonths(C.monthKey(today()), -1);
  const r = M.monthReport(state, key), t = r.totals, s = state.settings;
  const sent = (s.monthReports || {})[key];
  const hasFewo = r.invoices.length || r.bookings.length || r.fewoPayments.length;
  const table = (head, rows, foot) => `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th${h.endsWith("€") ? ' class="num"' : ""}>${h.replace(" €", "")}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="muted">Keine Einträge</td></tr>`}</tbody>${foot ? `<tfoot><tr>${foot}</tr></tfoot>` : ""}</table></div>`;
  return head("Monatsbericht für den Steuerberater", `${monthTitle(key)} · Mieten und Ferienwohnung komplett`,
    btn("monthNav", "‹", "", C.addMonths(key, -1)) + `<input type="month" value="${key}" data-change="monthReportKey" style="width:auto">` + btn("monthNav", "›", "", C.addMonths(key, 1))) + `
    ${sent?.sentAt ? `<div class="note small">✅ Gesendet am ${new Date(sent.sentAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} an ${esc(sent.to || "")}${sent.via !== "email" ? " (eigenes Mail-Programm)" : ""}</div>` : ""}
    <div class="bigstats four"><div><b>${eurS(t.rentIst)}</b><span>Mieten erhalten (Soll ${eurS(t.rentSoll)})</span></div><div><b>${eurS(t.fewoGross)}</b><span>Ferienwohnung Rechnungen</span></div><div><b>${eurS(t.inflows + t.fewoPaid)}</b><span>Zahlungseingänge gesamt</span></div><div><b>${r.open.length}</b><span>offene Punkte</span></div></div>
    <div class="card"><h2>📤 An den Steuerberater</h2>
      <p class="small muted" style="margin-bottom:10px">Enthält: Bericht als PDF, alle Einzelposten als Excel-Tabelle (CSV) und den DATEV-Buchungsstapel des Monats. ${s.taxAdvisorEmail ? `Empfänger: <b>${esc(s.taxAdvisorName || "")} ${esc(s.taxAdvisorEmail)}</b>` : 'E-Mail des Steuerberaters unter <a href="#/einstellungen">Einstellungen → DATEV</a> eintragen.'}</p>
      <div class="toolbar">${btn("monthSend", "📧 An Steuerberater senden", "primary", key)}${btn("monthPdf", "📄 PDF", "", key)}${btn("monthCsv", "📊 Excel (CSV)", "", key)}${btn("monthDatev", "DATEV-Datei", "", key)}</div></div>
    <div class="card"><h2>🏠 Mieteinnahmen ${monthTitle(key)}</h2>
      ${table(["Objekt / Einheit", "Mieter", "Kalt €", "NK €", "USt €", "Soll €", "Erhalten €", "Eingang"], r.rent.map((x) => `<tr><td>${esc(x.where)}</td><td>${esc(x.tenant)}</td><td class="num">${eurS(x.kalt + x.extra)}</td><td class="num">${eurS(x.nk)}</td><td class="num">${x.vat ? eurS(x.vat) : ""}</td><td class="num">${eurS(x.soll)}</td><td class="num ${x.diff < 0 ? "neg" : ""}">${eurS(x.ist)}</td><td class="small">${x.dates.map(d).join(", ") || '<span class="neg">fehlt</span>'}</td></tr>`),
        `<td colspan="2"><b>Summe</b></td><td class="num">${eurS(t.kalt + t.extra)}</td><td class="num">${eurS(t.nk)}</td><td class="num">${eurS(t.rentVat)}</td><td class="num">${eurS(t.rentSoll)}</td><td class="num"><b>${eurS(t.rentIst)}</b></td><td></td>`)}
      ${r.inflows.length ? `<h3 style="margin-top:12px">Alle Zahlungseingänge im Monat (Zufluss)</h3>${table(["Datum", "Objekt / Einheit", "Art", "Betrag €"], r.inflows.map((p) => `<tr><td>${d(p.date)}</td><td>${esc(p.where)}</td><td class="small">${esc(C.INCOME_KINDS[p.kind] || p.kind)}${p.period && p.period !== key ? ` für ${C.fmtMonth(p.period)}` : ""}</td><td class="num">${eurS(p.amount)}</td></tr>`), `<td colspan="3"><b>Summe</b></td><td class="num"><b>${eurS(t.inflows)}</b></td>`)}` : ""}
      ${t.deposits ? `<p class="small muted">Kautionen ${eurS(t.deposits)} sind durchlaufend und keine Einnahme.</p>` : ""}</div>
    <div class="card"><h2>🏖️ Ferienwohnung ${monthTitle(key)}</h2>
      ${hasFewo ? `<h3>Rechnungen des Monats</h3>${table(["Nr.", "Datum", "Empfänger", "Netto 7 % €", "USt 7 % €", "19 % netto €", "Kurtaxe €", "Brutto €", "Bezahlt €"], r.invoices.map((i) => `<tr><td>${esc(i.number)}${i.type === "storno" ? ' <span class="badge grey">Storno</span>' : ""}</td><td>${d(i.date)}</td><td>${esc(i.recipient)}</td><td class="num">${eurS(i.net7)}</td><td class="num">${eurS(i.vat7)}</td><td class="num">${eurS(i.net19)}</td><td class="num">${eurS(i.kurtaxe)}</td><td class="num">${eurS(i.gross)}</td><td class="num">${eurS(i.paid)}</td></tr>`),
          `<td colspan="3"><b>Summe</b></td><td class="num">${eurS(t.fewoNet7)}</td><td class="num">${eurS(t.fewoVat7)}</td><td class="num">${eurS(t.fewoNet19)}</td><td class="num">${eurS(t.kurtaxe)}</td><td class="num"><b>${eurS(t.fewoGross)}</b></td><td></td>`)}
        <h3 style="margin-top:12px">Buchungen mit Anreise im Monat</h3>${table(["Anreise", "Gast", "Einheit", "Nächte", "Kanal", "Betrag €", "Rechnung"], r.bookings.map((b) => `<tr><td>${d(b.from)}</td><td>${esc(b.guest)}</td><td class="small">${esc(b.where)}</td><td>${b.nights}</td><td class="small">${esc(b.channel)}${b.ref ? `<br><span class="muted">Nr. ${esc(b.ref)}</span>` : ""}</td><td class="num">${eurS(b.total)}</td><td>${b.status === "storniert" ? '<span class="badge grey">storniert</span>' : b.invoice ? esc(b.invoice) : btn("invoiceFromBooking", "Rechnung erstellen", "sm", b.id)}</td></tr>`), `<td colspan="3"><b>Summe</b></td><td>${t.nights}</td><td></td><td class="num"><b>${eurS(t.bookings)}</b></td><td></td>`)}
        ${t.provisions ? `<p class="small muted">Portal-Provisionen im Monat: ${eurS(t.provisions)} (als Ausgabe gebucht)</p>` : ""}` : '<p class="muted">Keine Ferienwohnungs-Umsätze in diesem Monat.</p>'}</div>
    <div class="card"><h2>⚠️ Offene Punkte</h2>${r.open.length ? `<ul style="margin-left:18px">${r.open.map((x) => `<li class="small">${esc(x)}</li>`).join("")}</ul>` : '<p class="small muted">Alles vollständig. 👍</p>'}
      <p class="small muted" style="margin-top:8px">Ausgaben des Monats (${r.expenses.length}, ${eurS(t.expenses)}) sind in der Excel-Tabelle und im DATEV-Stapel enthalten.</p></div>`;
}

function monthPdfModel(key) {
  const r = M.monthReport(state, key), t = r.totals, s = state.settings;
  const n = (c) => eur(c || 0);
  return {
    title: `Monatsbericht ${monthTitle(key)} – Vermietung & Ferienwohnung`,
    subtitle: `${s.ownerName || ""}${s.taxNumber ? ` · St.-Nr. ${s.taxNumber}` : ""}${s.taxAdvisorName ? ` · für ${s.taxAdvisorName}` : ""} · erstellt am ${d(today())}`,
    author: s.ownerName,
    summary: [["Mieten Soll", n(t.rentSoll)], ["Mieten erhalten", n(t.rentIst), true], ["davon Kaltmiete + Zuschläge (Soll)", n(t.kalt + t.extra)], ["davon NK-Vorauszahlungen (Soll)", n(t.nk)], ...(t.rentVat ? [["davon Umsatzsteuer (gewerbliche Mieter)", n(t.rentVat)]] : []), ["Alle Zahlungseingänge Miete (Zufluss)", n(t.inflows)],
      ["FeWo Rechnungen brutto", n(t.fewoGross), true], ["FeWo netto 7 % / USt 7 %", `${n(t.fewoNet7)} / ${n(t.fewoVat7)}`], ["FeWo netto 19 % / USt 19 %", `${n(t.fewoNet19)} / ${n(t.fewoVat19)}`], ["Kurtaxe (durchlaufend)", n(t.kurtaxe)], ["FeWo Zahlungseingänge", n(t.fewoPaid)]],
    sections: [
      { heading: "1. Mieteinnahmen (Soll / Ist)", cols: [{ label: "Objekt / Einheit", w: 5 }, { label: "Mieter", w: 4 }, { label: "Kalt", w: 2, align: "right" }, { label: "NK", w: 2, align: "right" }, { label: "USt", w: 2, align: "right" }, { label: "Soll", w: 2, align: "right" }, { label: "Erhalten", w: 2, align: "right" }, { label: "Eingang", w: 3 }],
        rows: r.rent.map((x) => [x.where, x.tenant, n(x.kalt + x.extra), n(x.nk), x.vat ? n(x.vat) : "", n(x.soll), n(x.ist), x.dates.map(d).join(", ") || "fehlt"]),
        total: ["Summe", "", n(t.kalt + t.extra), n(t.nk), n(t.rentVat), n(t.rentSoll), n(t.rentIst), ""] },
      { heading: "2. Zahlungseingänge Miete im Monat (Zuflussprinzip)", note: t.deposits ? `Kautionen ${n(t.deposits)} sind durchlaufend und nicht enthalten.` : "", cols: [{ label: "Datum", w: 2 }, { label: "Objekt / Einheit", w: 6 }, { label: "Art", w: 6 }, { label: "Betrag", w: 2, align: "right" }],
        rows: r.inflows.map((p) => [d(p.date), p.where, `${C.INCOME_KINDS[p.kind] || p.kind}${p.period && p.period !== key ? ` für ${C.fmtMonth(p.period)}` : ""}`, n(p.amount)]), total: ["Summe", "", "", n(t.inflows)] },
      { heading: "3. Ferienwohnung – Rechnungen des Monats", cols: [{ label: "Nr.", w: 3 }, { label: "Datum", w: 2 }, { label: "Empfänger", w: 4 }, { label: "Netto 7 %", w: 2, align: "right" }, { label: "USt 7 %", w: 2, align: "right" }, { label: "Netto 19 %", w: 2, align: "right" }, { label: "USt 19 %", w: 2, align: "right" }, { label: "Kurtaxe", w: 2, align: "right" }, { label: "Brutto", w: 2, align: "right" }, { label: "Bezahlt", w: 2, align: "right" }],
        rows: r.invoices.map((i) => [`${i.number}${i.type === "storno" ? " (Storno)" : ""}`, d(i.date), i.recipient, n(i.net7), n(i.vat7), n(i.net19), n(i.vat19), n(i.kurtaxe), n(i.gross), n(i.paid)]),
        total: ["Summe", "", "", n(t.fewoNet7), n(t.fewoVat7), n(t.fewoNet19), n(t.fewoVat19), n(t.kurtaxe), n(t.fewoGross), ""] },
      { heading: "4. Ferienwohnung – Buchungen mit Anreise im Monat", note: t.provisions ? `Portal-Provisionen im Monat: ${n(t.provisions)} (als Ausgabe gebucht).` : "", cols: [{ label: "Anreise", w: 2 }, { label: "Abreise", w: 2 }, { label: "Gast", w: 4 }, { label: "Einheit", w: 4 }, { label: "Nächte", w: 1, align: "right" }, { label: "Kanal", w: 3 }, { label: "Betrag", w: 2, align: "right" }, { label: "Rechnung", w: 3 }],
        rows: r.bookings.map((b) => [d(b.from), d(b.to), b.guest, b.where, String(b.nights), `${b.channel}${b.ref ? ` ${b.ref}` : ""}`, n(b.total), b.status === "storniert" ? "storniert" : b.invoice || "noch keine"]),
        total: ["Summe", "", "", "", String(t.nights), "", n(t.bookings), ""] },
      { heading: "5. Ausgaben des Monats", cols: [{ label: "Datum", w: 2 }, { label: "Empfänger", w: 5 }, { label: "Kategorie", w: 6 }, { label: "Beleg", w: 2 }, { label: "Betrag", w: 2, align: "right" }],
        rows: r.expenses.map((e) => [d(e.date), e.vendor, C.EXPENSE_CATEGORIES[e.category]?.label || e.category, e.beleg ? "ja" : "fehlt", n(e.amount)]), total: ["Summe", "", "", "", n(t.expenses)] },
      { heading: "6. Offene Punkte", cols: [{ label: "Hinweis", w: 1 }], rows: r.open.map((x) => [x]) },
    ],
    footer: `Erstellt mit ${productName()} · Zahlen aus den in der App erfassten Daten; DATEV-Buchungsstapel liegt bei.`,
  };
}

async function monthFiles(key) {
  const P = await import("./pdf.js");
  const pdf = P.reportPdf(monthPdfModel(key));
  const r = M.monthReport(state, key);
  const csv = new Blob([M.monthCsv(r, C.INCOME_KINDS)], { type: "text/csv;charset=utf-8" });
  const datev = new Blob([C.toWin1252(C.datevCsv(state, r.from, r.to))], { type: "text/csv;charset=windows-1252" });
  const base = `Monatsbericht_${key}`;
  return [{ name: `${base}.pdf`, blob: pdf, type: "application/pdf" }, { name: `${base}_Einzelposten.csv`, blob: csv, type: "text/csv" }, { name: `EXTF_Buchungsstapel_${key}.csv`, blob: datev, type: "text/csv" }];
}

function markMonthSent(key, to, via) {
  if (isCloud() && !canWrite()) return;
  state.settings.monthReports = { ...(state.settings.monthReports || {}), [key]: { sentAt: new Date().toISOString(), to, via } };
  commit();
}

async function archiveMonthPdf(key, blob) {
  if (isCloud() && !canWrite()) return;
  try {
    const id = C.uid("d_");
    await putDocBlob(id, blob);
    state.documents.push({ id, name: `Monatsbericht ${monthTitle(key)}.pdf`, type: "application/pdf", size: blob.size, thumb: null, created: new Date().toISOString(), kind: "steuerbescheid", objectId: "", contractId: "", status: "verarbeitet", note: "An den Steuerberater gesendet", ki: null });
  } catch {}
}

function monthSendDialog(key) {
  const s = state.settings;
  const text = `Guten Tag${s.taxAdvisorName ? ` ${s.taxAdvisorName}` : ""},\n\nanbei die Unterlagen für ${monthTitle(key)}:\n• Monatsbericht (PDF) mit allen Mieteinnahmen und Ferienwohnungs-Einnahmen\n• Einzelposten als Excel-Tabelle (CSV)\n• DATEV-Buchungsstapel\n\nBei Fragen melden Sie sich gern.\n\nMit freundlichen Grüßen\n${s.ownerName || ""}`;
  dialog({
    title: `Monatsbericht ${monthTitle(key)} senden`, submit: "📧 Jetzt senden", wide: true,
    body: `<label class="f"><span>An (Steuerberater) *</span><input name="to" type="email" required value="${esc(s.taxAdvisorEmail || "")}"></label>
      <label class="f inline"><input type="checkbox" name="copy" ${s.ownerEmail ? "checked" : "disabled"}> Kopie an mich ${s.ownerEmail ? `(${esc(s.ownerEmail)})` : ""}</label>
      <label class="f"><span>Betreff</span><input name="subject" value="${esc(`Unterlagen ${monthTitle(key)} – Vermietung & Ferienwohnung${s.ownerName ? ` – ${s.ownerName}` : ""}`)}"></label>
      <label class="f"><span>Nachricht</span><textarea name="text" style="min-height:180px">${esc(text)}</textarea></label>
      <p class="small muted">📎 Monatsbericht_${key}.pdf · Einzelposten (CSV) · DATEV-Buchungsstapel</p>
      <div class="toolbar"><button type="button" class="btn" data-share>📤 Stattdessen mit eigenem Mail-Programm / teilen</button></div>`,
    onOpen: (form) => { form.querySelector("[data-share]").onclick = () => { const v = { to: form.to.value.trim(), subject: form.subject.value, text: form.text.value }; $("#modal").close(); monthShare(key, v); }; },
    onSubmit: (form) => {
      const to = form.to.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast("Bitte die E-Mail des Steuerberaters eingeben."); return false; }
      if (!s.taxAdvisorEmail && canWrite()) { s.taxAdvisorEmail = to; persist(); }
      monthSend(key, { to, copy: form.copy.checked, subject: form.subject.value.trim(), text: form.text.value });
    },
  });
}

async function monthSend(key, m) {
  const s = state.settings;
  toast("📧 Monatsbericht wird gesendet …");
  try {
    const files = await monthFiles(key);
    const attachments = [];
    for (const f of files) attachments.push({ filename: f.name, content: await F.blobToBase64(f.blob) });
    await callFn("immo-mail", { to: m.to, bcc: m.copy && s.ownerEmail ? s.ownerEmail : "", replyTo: s.ownerEmail || "", fromName: s.ownerName || "", subject: m.subject, text: m.text, attachments });
    await archiveMonthPdf(key, files[0].blob);
    markMonthSent(key, m.to, "email");
    toast(`✅ Monatsbericht ${monthTitle(key)} an ${m.to} gesendet`);
  } catch (e) {
    if (confirm(`Der Bericht konnte nicht direkt gesendet werden:\n${e.message}\n\nStattdessen mit deinem eigenen Mail-Programm senden?`)) monthShare(key, m);
  }
}

// Ohne Mail-Server: Teilen-Menü (Handy) oder Dateien herunterladen + Mail-Programm öffnen
async function monthShare(key, m) {
  const files = await monthFiles(key);
  const fs = typeof File === "function" ? files.map((f) => new File([f.blob], f.name, { type: f.type })) : [];
  if (fs.length && navigator.canShare?.({ files: fs })) {
    try { await navigator.share({ files: fs, title: m.subject, text: m.text }); await archiveMonthPdf(key, files[0].blob); markMonthSent(key, m.to, "teilen"); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  for (const f of files) download(f.name, f.blob);
  location.href = `mailto:${encodeURIComponent(m.to || "")}?subject=${encodeURIComponent(m.subject || "")}&body=${encodeURIComponent(m.text || "")}`;
  await archiveMonthPdf(key, files[0].blob);
  markMonthSent(key, m.to, "mailprogramm");
  toast("Die 3 Dateien wurden heruntergeladen – bitte im Mail-Programm anhängen.");
}

// ---------------------------------------------------------------- Team & Zugriff

async function loadTeam() {
  ui.teamBusy = true;
  try { ui.team = (await Cloud.team()) || []; } catch { ui.team = []; ui.teamUnavailable = true; }
  ui.teamBusy = false; render();
}

const inviteLink = (token) => `${location.origin}${location.pathname}#/einladung/${token}`;

function teamCard() {
  if (!ui.team && !ui.teamBusy) { loadTeam(); }
  const team = ui.team || [];
  const members = team.filter((t) => t.kind === "member"), invites = team.filter((t) => t.kind === "invite");
  const lim = planOf()?.max_members;
  const shared = auth.workspaces.filter((w) => w.role !== "owner");
  const roleSel = (m) => `<select data-change="teamRole" data-id="${esc(m.member_id)}" style="width:auto">${opt([["editor", "✎ Bearbeiten"], ["viewer", "👁 Nur lesen"]], m.role)}</select>`;
  return `<div class="card"><h2>👥 Team & Zugriff</h2>
    <p class="small muted" style="margin-bottom:10px">Gib weiteren Personen Zugriff auf deinen Bestand – z. B. Ehepartner, Mitarbeiter oder Steuerberater. Jede Person meldet sich mit <b>eigener E-Mail und eigenem Passwort</b> an; ihr arbeitet gleichzeitig an denselben Daten.</p>
    ${ui.teamUnavailable ? '<div class="note">Die Team-Funktion ist auf dem Server noch nicht eingerichtet (Datenbank-Update „team“ fehlt – siehe README).</div>' : `
    <div class="table-wrap"><table><thead><tr><th>Person</th><th>Zugriff</th><th></th></tr></thead><tbody>
      <tr><td><b>${esc(auth.profile?.full_name || auth.user.email)}</b> (du)<div class="small muted">${esc(auth.user.email)}</div></td><td><span class="badge ok">Inhaber</span></td><td></td></tr>
      ${members.map((m) => `<tr><td><b>${esc(m.name || m.email)}</b><div class="small muted">${esc(m.email)} · seit ${d(String(m.since).slice(0, 10))}</div></td><td>${roleSel(m)}</td><td>${btn("teamRemove", "Entfernen", "sm danger", m.member_id)}</td></tr>`).join("")}
      ${invites.map((i) => `<tr><td>${esc(i.email)}<div class="small muted">eingeladen am ${d(String(i.since).slice(0, 10))} · wartet auf Annahme</div></td><td><span class="badge warn">${ROLE_LABEL[i.role]}</span></td><td class="nowrap">${btn("teamShareInvite", "Link teilen", "sm", i.token + "|" + i.email)}${btn("teamRevoke", "Zurückziehen", "sm", i.token)}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="toolbar" style="margin-top:10px">${btn("teamInvite", "+ Person einladen", "primary")}</div>
    <p class="small muted" style="margin-top:8px">${lim == null ? "Dein Tarif erlaubt beliebig viele Teammitglieder." : `Dein Tarif erlaubt ${lim} weitere Person${lim === 1 ? "" : "en"} (${members.length + invites.length} vergeben).`} <b>Bearbeiten</b>: alles außer Tarif, Team und Kontolöschung. <b>Nur lesen</b>: Einsicht und Export, keine Änderungen – ideal für Steuerberater.</p>
    <p class="small muted">Datenschutz: Teammitglieder sehen die Mieter- und Gästedaten deines Bestands. Lade nur Personen ein, die zur Verwaltung befugt sind (Mitarbeiter, Ehepartner, Berater mit Verschwiegenheitspflicht), und entferne den Zugriff, wenn er nicht mehr benötigt wird.</p>`}
    ${shared.length ? `<h3 style="margin-top:14px">Bestände, auf die du Zugriff hast</h3>
      <div class="table-wrap"><table><tbody>${shared.map((w) => `<tr><td><b>${esc(w.owner_name)}</b><div class="small muted">${esc(w.owner_email)}</div></td><td><span class="badge ${w.role === "viewer" ? "grey" : "ok"}">${ROLE_LABEL[w.role]}</span></td><td class="nowrap">${w.owner_id === wsId() ? '<span class="small muted">geöffnet</span>' : btn("switchWs", "Öffnen", "sm", w.owner_id)}${btn("teamLeave", "Verlassen", "sm", w.owner_id)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${auth.workspaces.length > 1 && !isOwnWs() ? `<div class="toolbar" style="margin-top:8px">${btn("switchWs", "🏠 Zurück zu meinem Bestand", "sm", auth.user.id)}</div>` : ""}
  </div>`;
}

function shareInvite(token, email) {
  const link = inviteLink(token), who = esc(auth.profile?.full_name || auth.user.email);
  const text = `Hallo! Ich habe dich zu unserer Immobilienverwaltung eingeladen. Öffne den Link und melde dich mit ${email} an (oder registriere dich mit dieser Adresse):\n${link}\n\nDer Link ist 14 Tage gültig.`;
  dialog({
    title: "Einladung verschicken",
    body: `<p class="small" style="margin-bottom:8px">Schicke diesen Link an <b>${esc(email)}</b>. Er funktioniert nur mit dieser E-Mail-Adresse und ist 14 Tage gültig. Meldet sich die Person mit dieser Adresse an, erscheint die Einladung auch ohne Link.</p>
      <label class="f"><span>Einladungslink</span><input readonly value="${esc(link)}" onclick="this.select()"></label>
      <div class="toolbar" style="margin-top:10px">
        <button type="button" class="btn primary" data-act="copyText" data-id="${esc(link)}">📋 Link kopieren</button>
        <a class="btn" href="mailto:${esc(email)}?subject=${encodeURIComponent(`Einladung von ${auth.profile?.full_name || ""} – Immobilienverwaltung`)}&body=${encodeURIComponent(text)}">✉️ Per E-Mail</a>
        <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">💬 Per WhatsApp</a>
      </div><p class="small muted" style="margin-top:8px">Eingeladen von ${who}.</p>`,
  });
}

function inviteDialog() {
  dialog({
    title: "Person einladen", submit: "Einladung erstellen",
    body: `<label class="f"><span>E-Mail-Adresse der Person *</span><input name="email" type="email" required autocomplete="off" placeholder="name@beispiel.de"></label>
      <label class="f"><span>Zugriff</span><select name="role">${opt([["editor", "✎ Bearbeiten – z. B. Ehepartner, Mitarbeiter"], ["viewer", "👁 Nur lesen – z. B. Steuerberater"]], "editor")}</select></label>`,
    onSubmit: (form) => {
      const email = form.email.value.trim().toLowerCase(), role = form.role.value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Bitte eine gültige E-Mail-Adresse eingeben."); return false; }
      Cloud.createInvite(email, role).then(async (token) => { await loadTeam(); shareInvite(token, email); }, (e) => {
        if (e.code === "member_limit") alert(`Dein Tarif erlaubt höchstens ${e.limit} weitere Person${e.limit === 1 ? "" : "en"}. Für ein größeres Team bitte den Tarif wechseln.`);
        else alert(e.message);
      });
    },
  });
}

// ---------------------------------------------------------------- Admin-Bereich

async function loadAdmin() {
  ui.adminBusy = true; render();
  try {
    const [users, log, plans, settings, canc, members] = await Promise.all([Cloud.adminUsers(), Cloud.adminLog(), Cloud.plans(), Cloud.appSettings(), Cloud.adminCancellations().catch(() => []), Cloud.adminMemberships().catch(() => [])]);
    const types = await Cloud.adminAccountTypes().catch(() => []);
    for (const u of users) u.account_type = types.find((x) => x.id === u.id)?.account_type || "vermieter";
    for (const u of users) {
      u.members = members.filter((m) => m.owner_id === u.id);
      u.teamSize = u.members.length;
      u.memberOf = members.filter((m) => m.member_id === u.id);
    }
    Object.assign(ui, { adminUsers: users, adminLog: log, adminCancellations: canc });
    auth.plans = plans; auth.settings = settings;
  } catch (e) { alert("Admin-Daten konnten nicht geladen werden: " + e.message); }
  ui.adminBusy = false; render();
}

function viewAdmin() {
  if (!isAdmin()) return head("Kein Zugriff");
  if (!ui.adminUsers && !ui.adminBusy) { loadAdmin(); return head("Admin") + '<div class="card muted">Lade …</div>'; }
  const allUsers = ui.adminUsers || [];
  const tenantsCount = allUsers.filter((u) => u.account_type === "mieter").length;
  const users = ui.adminShowTenants ? allUsers : allUsers.filter((u) => u.account_type !== "mieter");
  const tab = ui.adminTab || "uebersicht";
  const now = Date.now(), days = (iso) => (iso ? (now - new Date(iso)) / 86400000 : Infinity);
  const planById = Object.fromEntries(auth.plans.map((p) => [p.id, p]));
  const paying = users.filter((u) => u.status === "active" && (planById[u.plan]?.price_month_cents || 0) > 0);
  const mrr = sum(paying, (u) => planById[u.plan].price_month_cents);
  const q = C.normalize(ui.adminSearch || "");
  const list = users.filter((u) => !q || C.normalize(`${u.email} ${u.full_name} ${u.company}`).includes(q));
  const fmtBytes = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1).replace(".", ",")} MB` : `${Math.round((b || 0) / 1e3)} KB`);
  const tabs = [["uebersicht", "Übersicht"], ["nutzer", `Nutzer (${users.length})`], ["tarife", "Tarife"], ["einstellungen", "Einstellungen & Rechtstexte"], ["gruppen", `Gruppen (${users.filter((u) => u.teamSize).length})`], ["kuendigungen", `Kündigungen (${(ui.adminCancellations || []).filter((c) => c.status !== "erledigt").length})`], ["protokoll", "Protokoll"]];
  const st = auth.settings || {};
  const body = {
    uebersicht: `<div class="kpis">
        <div class="kpi"><div class="l">Vermieter-Konten</div><div class="v">${users.filter((u) => u.account_type !== "mieter").length}</div><div class="s">+ ${tenantsCount} Mieter im Portal (kostenlos)</div></div>
        <div class="kpi"><div class="l">Nutzer gesamt</div><div class="v">${users.length}</div><div class="s">${users.filter((u) => days(u.created_at) <= 30).length} neu in 30 Tagen</div></div>
        <div class="kpi"><div class="l">Aktiv (30 Tage)</div><div class="v">${users.filter((u) => days(u.last_seen_at) <= 30).length}</div></div>
        <div class="kpi"><div class="l">Zahlende Kunden</div><div class="v">${paying.length}</div><div class="s">${users.filter((u) => u.plan === "trial").length} in Testphase</div></div>
        <div class="kpi"><div class="l">Monatsumsatz (MRR)</div><div class="v">${eur(mrr)}</div><div class="s">${eur(mrr * 12)} / Jahr</div></div>
        <div class="kpi"><div class="l">Speicher Belege</div><div class="v">${fmtBytes(sum(users, (u) => Number(u.storage_bytes)))}</div></div>
      </div>
      <div class="card"><h2>Nach Tarif</h2><table>${auth.plans.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${users.filter((u) => u.plan === p.id).length} Nutzer</td><td class="num">${eur(sum(users.filter((u) => u.plan === p.id && u.status === "active"), () => p.price_month_cents))} / Monat</td></tr>`).join("")}</table></div>
      <div class="card"><h2>Testphasen, die bald enden</h2>${users.filter((u) => u.plan === "trial" && u.trial_ends_at && days(u.trial_ends_at) > -30 && days(u.trial_ends_at) < 7).map((u) => `<div>${esc(u.email)} – ${d(u.trial_ends_at.slice(0, 10))}</div>`).join("") || '<p class="muted">Keine.</p>'}</div>`,
    nutzer: `<div class="inline" style="margin-bottom:10px"><input placeholder="Suchen (E-Mail, Name, Firma) …" value="${esc(ui.adminSearch || "")}" data-change="adminSearch" style="max-width:320px">${btn("adminReload", "⟳ Aktualisieren", "sm")}<label class="small"><input type="checkbox" data-change="adminShowTenants" ${ui.adminShowTenants ? "checked" : ""}> Mieter-Zugänge zeigen (${tenantsCount})</label></div>
      <div class="table-wrap"><table><thead><tr><th>Nutzer</th><th>Tarif</th><th>Status</th><th class="num">Objekte / Einh.</th><th class="num">Dokumente</th><th>Registriert</th><th>Zuletzt aktiv</th></tr></thead><tbody>
      ${list.map((u) => `<tr class="click" data-act="adminUser" data-id="${u.id}"><td><b>${esc(u.full_name || u.email)}</b>${u.role === "admin" ? ' <span class="badge">Admin</span>' : ""}${u.account_type === "mieter" ? ' <span class="badge grey">Mieter</span>' : ""}${u.teamSize ? ` <span class="badge grey" title="Weitere Personen in der Gruppe">👥 +${u.teamSize}</span>` : ""}<div class="small muted">${esc(u.email)}${u.company ? " · " + esc(u.company) : ""}</div>${(u.memberOf || []).map((m) => `<div class="small muted">↳ Mitglied bei ${esc(adminUserName(m.owner_id))} (${ROLE_LABEL[m.role]})</div>`).join("")}</td>
        <td>${esc(planById[u.plan]?.name || u.plan)}${u.subscription_status ? ` <span class="badge ${u.subscription_status === "active" ? "ok" : u.subscription_status === "past_due" ? "bad" : "grey"}">${esc(u.subscription_status === "active" ? (u.cancel_at_period_end ? "gekündigt" : "Abo") : u.subscription_status)}</span>` : ""}${u.plan === "trial" && u.trial_ends_at ? `<div class="small ${days(u.trial_ends_at) > 0 ? "neg" : "muted"}">bis ${d(u.trial_ends_at.slice(0, 10))}</div>` : ""}</td>
        <td>${u.status === "active" ? '<span class="badge ok">aktiv</span>' : '<span class="badge bad">gesperrt</span>'}</td>
        <td class="num">${u.stats?.objects ?? 0} / ${u.stats?.units ?? 0}</td><td class="num">${u.stats?.documents ?? 0}<div class="small muted">${fmtBytes(Number(u.storage_bytes))}</div></td>
        <td class="small">${d(u.created_at.slice(0, 10))}</td><td class="small">${u.last_seen_at ? d(u.last_seen_at.slice(0, 10)) : "–"}</td></tr>`).join("")}</tbody></table></div>`,
    tarife: `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th class="num">Preis / Monat</th><th class="num">Max. Einheiten</th><th>KI inkl.</th><th>Stripe</th><th>Aktiv</th><th></th></tr></thead><tbody>
      ${auth.plans.map((p) => `<tr><td class="small">${esc(p.id)}</td><td>${esc(p.name)}<div class="small muted">${esc(p.description)}</div></td><td class="num">${eur(p.price_month_cents)}</td><td class="num">${p.max_units ?? "∞"}<div class="small muted">Team +${p.max_members ?? "∞"}</div></td><td>${p.ki_included ? "✓" : ""}</td><td class="small">${p.stripe_price_id ? "✓ online buchbar" : '<span class="muted">manuell</span>'}</td><td>${p.active ? "✓" : "–"}</td><td>${btn("adminPlan", "✎", "sm", p.id)}</td></tr>`).join("")}</tbody></table></div>
      ${btn("adminPlan", "+ Tarif", "", "")}
      <p class="small muted" style="margin-top:8px">Das Einheiten-Limit wird serverseitig geprüft. Online-Zahlung (z. B. Stripe) ist der nächste Ausbauschritt – bis dahin Tarife hier manuell zuweisen.</p>`,
    einstellungen: `<form data-form="appsettings"><div class="fgrid">
        <label class="f"><span>Produktname</span><input name="product_name" value="${esc(st.product_name)}"></label>
        <label class="f"><span>Support-E-Mail</span><input name="support_email" type="email" value="${esc(st.support_email)}"></label>
        <label class="f"><span>Testphase (Tage)</span><input name="trial_days" type="number" value="${esc(st.trial_days)}"></label>
        <label class="f inline"><input type="checkbox" name="registration_open" ${st.registration_open ? "checked" : ""}> Registrierung offen</label>
        <label class="f full"><span>Ankündigung (Banner für alle Nutzer, leer = aus)</span><input name="announcement" value="${esc(st.announcement)}"></label>
        <label class="f full"><span>Impressum</span><textarea name="impressum">${esc(st.impressum)}</textarea></label>
        <label class="f full"><span>Datenschutzerklärung</span><textarea name="datenschutz" style="min-height:160px">${esc(st.datenschutz)}</textarea></label>
        <label class="f full"><span>AGB</span><textarea name="agb" style="min-height:160px">${esc(st.agb)}</textarea></label>
        <label class="f full"><span>Auftragsverarbeitungsvertrag (Art. 28 DSGVO) – Kunden verarbeiten Daten ihrer Mieter in der App</span><textarea name="avv" style="min-height:160px">${esc(st.avv)}</textarea></label>
        <label class="f full"><span>Widerrufsbelehrung (inkl. Muster-Widerrufsformular)</span><textarea name="widerruf" style="min-height:120px">${esc(st.widerruf)}</textarea></label>
        <label class="f"><span>Preisangabe (PAngV)</span><input name="price_note" value="${esc(st.price_note)}" placeholder="Alle Preise inkl. 19 % USt."></label>
        <label class="f"><span>Version der Rechtstexte</span><input name="legal_version" value="${esc(st.legal_version)}"><small class="muted">Bei Änderung von AGB/AVV erhöhen – Kunden werden dann um erneute Zustimmung gebeten.</small></label>
      </div><button class="btn primary">Speichern</button>
      <p class="small muted" style="margin-top:8px">Vor dem Verkauf: Impressum, Datenschutzerklärung (inkl. Auftragsverarbeitung mit Supabase/Anthropic) und AGB rechtlich prüfen lassen.</p></form>`,
    kuendigungen: `<p class="small muted" style="margin-bottom:8px">Eingänge über den Kündigungsbutton (§ 312k BGB). Abos werden automatisch zum Laufzeitende gekündigt; ohne E-Mail-Versand (RESEND_API_KEY) bitte die Bestätigung selbst per E-Mail senden.</p>
      <div class="table-wrap"><table><thead><tr><th>Eingang</th><th>Name / E-Mail</th><th>Konto</th><th>Art</th><th>Status</th><th>Bestätigung</th></tr></thead><tbody>
      ${(ui.adminCancellations || []).map((c) => `<tr><td class="small nowrap">${new Date(c.created_at).toLocaleString("de-DE")}<br>K-${String(c.id).padStart(6, "0")}</td><td class="small">${esc(c.name)}<br>${esc(c.email)}</td><td class="small">${esc(c.account_email)}${c.effective_at ? `<br>endet ${d(c.effective_at.slice(0, 10))}` : ""}</td><td class="small">${esc(c.kind)}${c.reason ? `<br><span class="muted">${esc(c.reason.slice(0, 80))}</span>` : ""}</td><td class="small">${esc(c.status)}</td><td class="small">${c.confirmation_sent ? "✓ E-Mail" : '<span class="neg">manuell senden</span>'}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">Keine Kündigungen.</td></tr>'}</tbody></table></div>`,
    gruppen: adminGroupsHtml(users),
    protokoll: `<table>${(ui.adminLog || []).map((l) => `<tr><td class="small nowrap">${new Date(l.at).toLocaleString("de-DE")}</td><td class="small">${esc(l.action)}</td><td class="small">${esc(users.find((u) => u.id === l.target_id)?.email || l.target_id || "")}</td><td class="small muted">${esc(JSON.stringify(l.details))}</td></tr>`).join("") || '<tr><td class="muted">Noch keine Einträge.</td></tr>'}</table>`,
  }[tab];
  return head("Admin-Bereich", "Kunden, Tarife und Einstellungen – ohne Einblick in Kundendaten", "") + `
    <div class="tabs">${tabs.map(([k, l]) => `<button data-act="adminTab" data-id="${k}" class="${tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    ${tab === "uebersicht" ? body : `<div class="card">${body}</div>`}`;
}

const adminUserName = (id) => { const u = (ui.adminUsers || []).find((x) => x.id === id); return u ? u.company || u.full_name || u.email : "?"; };

// Vermieter-Gruppen: Inhaber + weitere Personen (z. B. Ehepaar, Hausverwaltung mit Mitarbeitern)
function adminGroupHtml(u) {
  const roleSel = (m) => `<select data-change="adminMemberRole" data-owner="${esc(u.id)}" data-id="${esc(m.member_id)}" style="width:auto">${opt([["editor", "✎ Bearbeiten"], ["viewer", "👁 Nur lesen"]], m.role)}</select>`;
  const inv = (ui.adminInvites || {})[u.id];
  return `<div class="card" style="margin-bottom:10px"><div class="head" style="margin-bottom:6px"><div><b>🏠 ${esc(u.company || u.full_name || u.email)}</b> <span class="small muted">${esc(u.email)} · Tarif ${esc(auth.plans.find((p) => p.id === u.plan)?.name || u.plan)}</span></div>
      <div class="toolbar">${btn("adminGroupAdd", "+ Person hinzufügen", "sm primary", u.id)}${inv === undefined ? btn("adminGroupInvites", "Einladungen zeigen", "sm", u.id) : ""}</div></div>
    <table><tbody><tr><td><b>${esc(u.full_name || u.email)}</b><div class="small muted">${esc(u.email)}</div></td><td><span class="badge ok">Inhaber</span></td><td></td></tr>
      ${u.members.map((m) => { const x = (ui.adminUsers || []).find((y) => y.id === m.member_id) || {}; return `<tr><td><b>${esc(x.full_name || x.email || "?")}</b><div class="small muted">${esc(x.email || "")} · seit ${d(String(m.created_at).slice(0, 10))}</div></td><td>${roleSel(m)}</td><td>${btn("adminGroupRemove", "Entfernen", "sm danger", `${u.id}|${m.member_id}`)}</td></tr>`; }).join("")}
      ${(inv || []).map((i) => `<tr><td>${esc(i.email)}<div class="small muted">Einladung bis ${d(String(i.expires_at).slice(0, 10))}</div></td><td><span class="badge warn">${ROLE_LABEL[i.role]}</span></td><td class="nowrap">${btn("adminGroupLink", "Link", "sm", i.token)}${btn("adminGroupRevoke", "Zurückziehen", "sm", `${u.id}|${i.token}`)}</td></tr>`).join("")}
    </tbody></table></div>`;
}

function adminGroupsHtml(users) {
  const groups = users.filter((u) => u.teamSize);
  const owners = users.filter((u) => u.status === "active" && !(u.memberOf || []).length || u.teamSize);
  return `<div class="note small">Eine <b>Gruppe</b> ist ein gemeinsamer Bestand: der Inhaber (Abo, Daten) und weitere Personen mit „Bearbeiten“ oder „Nur lesen“ – z. B. Ehepaar, Erbengemeinschaft oder Hausverwaltung mit Team. Kunden verwalten ihr Team auch selbst unter „Mein Konto“. Admin-Konten können hier aus Datenschutzgründen nicht in Kundenbestände aufgenommen werden; jede Änderung steht im Protokoll.</div>
    <div class="inline" style="margin:10px 0"><select id="adminGroupOwner" style="max-width:360px">${opt([["", "Gruppe anlegen für Konto …"], ...owners.filter((u) => !u.teamSize).map((u) => [u.id, `${u.company || u.full_name || u.email} (${u.email})`])], "")}</select>${btn("adminGroupNew", "+ Gruppe anlegen", "")}</div>
    ${groups.length ? groups.map(adminGroupHtml).join("") : '<p class="muted">Noch keine Gruppen – Konto oben auswählen und weitere Person hinzufügen.</p>'}`;
}

function adminGroupAddDialog(ownerId) {
  const u = ui.adminUsers.find((x) => x.id === ownerId);
  dialog({
    title: `Person zur Gruppe „${u.company || u.full_name || u.email}“ hinzufügen`, submit: "Hinzufügen",
    body: `<p class="small muted" style="margin-bottom:8px">Hat die Person schon ein Konto, wird sie sofort hinzugefügt. Sonst entsteht eine Einladung (14 Tage gültig) – den Link bitte an die Person schicken; sie registriert sich mit genau dieser E-Mail-Adresse.</p>
      <label class="f"><span>E-Mail-Adresse *</span><input name="email" type="email" required></label>
      <label class="f"><span>Zugriff</span><select name="role">${opt([["editor", "✎ Bearbeiten"], ["viewer", "👁 Nur lesen"]], "editor")}</select></label>
      ${u.teamSize >= (auth.plans.find((p) => p.id === u.plan)?.max_members ?? Infinity) ? '<div class="note warn small">Achtung: Der Tarif des Kunden sieht nicht mehr Personen vor. Als Admin kannst du trotzdem hinzufügen – ggf. Tarif anpassen.</div>' : ""}`,
    onSubmit: (form) => {
      const email = form.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Bitte gültige E-Mail eingeben."); return false; }
      Cloud.adminAddMember(ownerId, email, form.role.value).then(async (r) => {
        if (r?.added) toast("Person hinzugefügt");
        else { prompt("Noch kein Konto – Einladungslink an die Person schicken:", inviteLink(r.token)); }
        if (ui.adminInvites) delete ui.adminInvites[ownerId];
        await loadAdmin();
      }, (e) => alert(e.message));
    },
  });
}

function adminUserDialog(id) {
  const u = ui.adminUsers.find((x) => x.id === id);
  formDialog({
    title: u.email, data: { ...u, trial_ends_at: u.trial_ends_at ? u.trial_ends_at.slice(0, 10) : "" },
    intro: `<p class="small muted" style="margin-bottom:10px">${esc(u.full_name)}${u.company ? " · " + esc(u.company) : ""} · registriert ${d(u.created_at.slice(0, 10))} · ${u.stats?.objects ?? 0} Objekte, ${u.stats?.units ?? 0} Einheiten, ${u.stats?.documents ?? 0} Dokumente</p>
      <div class="toolbar" style="margin-bottom:12px">${btn("adminResetPw", "Passwort-Reset-Mail senden", "sm", u.email)}${u.id !== auth.user.id ? btn("adminDelete", "Konto löschen", "sm danger", u.id) : ""}</div>
      <div class="small" style="margin-bottom:12px">👥 <b>Gruppe:</b> ${u.teamSize ? u.members.map((m) => `${esc(adminUserName(m.member_id))} (${ROLE_LABEL[m.role]})`).join(", ") : "nur der Inhaber"}${(u.memberOf || []).length ? ` · Mitglied bei ${u.memberOf.map((m) => esc(adminUserName(m.owner_id))).join(", ")}` : ""} ${btn("adminGroupAdd", "+ Person hinzufügen", "sm", u.id)}</div>`,
    spec: [
      { k: "plan", l: "Tarif", t: "select", opts: () => auth.plans.map((p) => [p.id, p.name]) },
      { k: "trial_ends_at", l: "Testphase bis", t: "date" },
      { k: "status", l: "Status", t: "select", opts: [["active", "aktiv"], ["blocked", "gesperrt"]] },
      { k: "role", l: "Rolle", t: "select", opts: [["user", "Kunde"], ["admin", "Admin"]] },
      { k: "admin_note", l: "Interne Notiz (Rechnungen, Absprachen)", t: "textarea" },
    ],
    onSave: async (v) => {
      try {
        await Cloud.adminUpdateUser({ p_id: u.id, p_plan: v.plan, p_status: v.status, p_role: v.role, p_trial_ends_at: v.trial_ends_at ? `${v.trial_ends_at}T23:59:59Z` : null, p_clear_trial: !v.trial_ends_at, p_note: v.admin_note });
        toast("Nutzer aktualisiert"); loadAdmin();
      } catch (e) { alert(e.message); }
    },
  });
}

function adminPlanDialog(id) {
  const p = auth.plans.find((x) => x.id === id) || { id: "", name: "", price_month_cents: 0, max_units: null, ki_included: false, description: "", sort: auth.plans.length, active: true };
  formDialog({
    title: id ? `Tarif ${p.name}` : "Neuer Tarif", data: { ...p, max_units: p.max_units ?? "", max_members: p.max_members ?? "" },
    spec: [
      { k: "id", l: "ID (klein, ohne Leerzeichen)", req: 1 }, { k: "name", l: "Name", req: 1 },
      { k: "price_month_cents", l: "Preis pro Monat (€)", t: "money" }, { k: "max_units", l: "Max. Einheiten (leer = unbegrenzt)", t: "number" }, { k: "max_members", l: "Weitere Personen im Team (leer = unbegrenzt, 0 = keine)", t: "number" },
      { k: "description", l: "Beschreibung", full: 1 }, { k: "sort", l: "Reihenfolge", t: "number" },
      { k: "stripe_price_id", l: "Stripe Preis-ID (price_…) – leer = nicht online buchbar", full: 1, hint: "Stripe Dashboard → Produktkatalog → Produkt → Preis (monatlich, wiederkehrend) → ID kopieren" },
      { k: "ki_included", l: "KI inklusive", t: "checkbox" }, { k: "active", l: "Buchbar / sichtbar", t: "checkbox" },
    ],
    onSave: async (v) => {
      if (id && v.id !== id) { toast("Die ID kann nicht geändert werden."); return false; }
      try { await Cloud.savePlan({ ...v, id: v.id.toLowerCase().replace(/[^a-z0-9_-]/g, ""), max_units: v.max_units === "" ? null : v.max_units, max_members: v.max_members === "" ? null : v.max_members, sort: Number(v.sort) || 0 }); toast("Tarif gespeichert"); loadAdmin(); }
      catch (e) { alert(e.message); }
    },
  });
}

function showLegal(k) {
  const st = auth.settings || {};
  const title = { impressum: "Impressum", datenschutz: "Datenschutzerklärung", agb: "Allgemeine Geschäftsbedingungen", avv: "Vertrag zur Auftragsverarbeitung (Art. 28 DSGVO)", widerruf: "Widerrufsbelehrung" }[k];
  dialog({ title, wide: true, body: `<div style="white-space:pre-wrap">${esc(st[k] || "Noch nicht hinterlegt.")}</div>` });
}

// ---------------------------------------------------------------- Routing & Events

function render() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [route, arg] = hash.split("/");
  const gate = auth.mode === "cloud" && route !== "kuendigen" && (!auth.user || ui.authTab === "newpw" || auth.profile?.status === "blocked");
  if (route === "kuendigen" && !auth.user) { document.body.classList.add("authscreen"); $("#view").innerHTML = `<div style="padding:24px 16px">${viewCancelForm()}</div>`; return; }
  document.body.classList.toggle("authscreen", gate);
  if (gate) { $("#view").innerHTML = auth.user && auth.profile?.status === "blocked" && ui.authTab !== "newpw" ? viewBlocked() : ui.portalInvite && !auth.user && ui.authTab !== "reset" ? viewTenantAuth() : viewAuth(); return; }
  document.body.classList.toggle("portalscreen", isCloud() && !!auth.portalView);
  if (isCloud() && auth.portalView) {
    $("#view").innerHTML = viewTenantPortal();
    setTimeout(hydratePortalImages, 0);
    return;
  }
  const who = auth.profile?.full_name || auth.user?.email || "";
  const initials = who.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("") || "?";
  $("#foot").innerHTML = isCloud() ? `<div class="me"><span class="avatar">${esc(initials)}</span><div class="me-tx"><b>${esc(who)}</b><span class="small">${wsFoot()}<span id="sync">${syncLabel()}</span><br><span id="lastchange">${lastChangeLabel()}</span><span id="livesync"></span></span></div></div>
    <button class="logout-btn" data-act="logout">⎋ Abmelden</button>` : `Lokaler Modus: Daten nur in diesem Browser. Regelmäßig unter Einstellungen → Datensicherung sichern.<br><span id="livesync"></span>`;
  if (!$("#mlogout")) $(".side .logo").insertAdjacentHTML("afterend", `<button id="mlogout" class="mlogout" data-act="logout">Abmelden</button>`);
  $("#mlogout").hidden = !isCloud();
  setTimeout(setSyncBadge, 0);
  if (!$("#gsearch")) $("#nav").insertAdjacentHTML("beforebegin", `<input id="gsearch" type="search" placeholder="🔎 Suchen … ( / )" autocomplete="off">`);
  if (route === "mieter" && arg && ui.folderTenant !== arg) { ui.folderTenant = arg; ui.folderTab = ui.nextFolderTab || "ueberblick"; ui.nextFolderTab = null; }
  $("#nav").innerHTML = navHtml(route);
  if (!$("#tabbar")) document.body.insertAdjacentHTML("beforeend", '<nav id="tabbar" class="noprint"></nav>');
  $("#tabbar").innerHTML = tabbarHtml(route);
  const views = { "": () => (ui.setup?.step === 4 ? viewSetup() : viewStart()), objekte: viewObjects, mieter: () => (arg ? viewTenant(arg) : viewTenants()), protokoll: () => viewProtocol(arg, hash.split("/")[2]), auskunft: () => viewDataReport(arg), erklaerung: () => viewTaxReturn(arg), kuendigen: viewCancelForm, suche: viewSearch, nkassistent: viewNkWizard, instand: viewInstand, monat: () => viewMonthReport(arg), portal: viewPortalInbox, mieten: viewRents, bank: viewBank, ausgaben: viewExpenses, ferien: viewFewo, rechnungen: viewInvoices, rechnung: () => viewInvoice(arg), steuer: viewTax, bericht: () => viewReport(arg), einstellungen: viewSettings, nebenkosten: viewNk, nkbrief: () => viewNkLetter(arg, hash.split("/")[2]), paket: () => viewPackage(arg), dokumente: viewDocs, briefe: viewLetters, brief: () => viewLetter(arg), ki: viewKi, ablage: () => viewAblage(arg), konto: () => (isCloud() ? viewKonto() : viewSettings()), admin: viewAdmin };
  try {
    $("#view").innerHTML = banners() + (views[route] || viewDashboard)();
    if (document.querySelector("img[data-doc]")) hydrateDocImages();
    if (document.querySelector("img[data-ppath]")) hydratePortalImages();
  } catch (e) {
    console.error(e);
    $("#view").innerHTML = `<div class="card"><h2>Fehler in dieser Ansicht</h2><pre class="small">${esc(e.stack || e)}</pre></div>`;
  }
}

const actions = {
  newObject: () => editObject(), editObject,
  moveWizard: (unitId) => moveWizard(unitId || null),
  quickAdd: () => quickAdd(),
  openMenu: () => openMenu(),
  quickNote: () => quickNote(),
  setupCount: (v) => { const [k, dlt] = v.split("|"); ui.setup.counts[k] = Math.max(0, Math.min(99, ui.setup.counts[k] + Number(dlt))); render(); },
  setupType: (t) => { ui.setup.type = t; if (t === "ferien") Object.assign(ui.setup.counts, { wohnung: 0, ferienwohnung: Math.max(1, ui.setup.counts.ferienwohnung) }); if (t === "garagenhof") Object.assign(ui.setup.counts, { wohnung: 0, garage: Math.max(1, ui.setup.counts.garage) }); if (t === "efh") Object.assign(ui.setup.counts, { wohnung: 0, haus: 1 }); render(); },
  setupBack: () => { ui.setup.step = Math.max(1, ui.setup.step - 1); render(); },
  setupFinish: () => setupFinish(),
  setupDone: () => { ui.setup = null; location.hash = "#/"; render(); },
  erklTab: (t) => { ui.erklTab = t; render(); },
  erklYear: (y) => { location.hash = `#/erklaerung/${y}`; },
  copyVal: (v) => copyField(v),
  syncNow: () => syncAll(),
  connectBank: () => connectBank(),
  unlinkBank: (id) => { const a = byId("accounts", id); if (!confirm(`Live-Verbindung für „${a.name}“ trennen? Bereits abgerufene Umsätze bleiben erhalten. Die Freigabe kannst du zusätzlich im Online-Banking widerrufen.`)) return; delete a.eb; commit("Live-Verbindung getrennt"); },
  addFeed: (unitId) => addFeed(unitId),
  delFeed: (v) => { const [uid, fid] = v.split("|"); const u = byId("units", uid); if (!confirm("Kalender entfernen? Bereits importierte Buchungen bleiben erhalten.")) return; u.icalFeeds = (u.icalFeeds || []).filter((f) => f.id !== fid); commit("Kalender entfernt"); },
  exportFeed: (uid) => { const u = byId("units", uid); if (!u.icalToken || confirm("Neuen geheimen Export-Link erzeugen? Der alte Link funktioniert dann nicht mehr.")) { u.icalToken = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join(""); commit("Export-Kalender erstellt – Links unten in die Portale eintragen"); } },
  folderTab: (t) => { ui.folderTab = t; render(); },
  tenantFilter: (f) => { ui.tenantFilter = f; render(); },
  newNote: (v) => { const [type, tenantId, contractId] = v.split("|"); editNote(null, { type, tenantId, contractId, due: type === "termin" ? C.addDaysIso(today(), 7) : "" }); },
  editNote: (id) => editNote(id),
  leaseRead: (v) => leaseRead(v),
  newReading: (id) => newReading(id),
  buyPlan: (planId) => orderOverview(planId),
  billingPortal: () => startBilling("portal"),
  paywall: () => paywall(),
  setKuendigung: () => { ui.cancelKind = "ordentlich"; ui.cancelResult = null; location.hash = "#/kuendigen"; render(); },
  setWiderruf: () => { ui.cancelKind = "widerruf"; ui.cancelResult = null; location.hash = "#/kuendigen"; render(); },
  acceptLegal: async () => { try { await Cloud.acceptLegal(); auth.profile = await Cloud.profile(auth.user.id); toast("Danke – Zustimmung gespeichert"); render(); } catch (e) { alert(e.message); } },
  letterFor: (v) => { const [kind, contractId] = v.split("|"); if ($("#modal").open) $("#modal").close(); ui.letter = { kind, contractId, subject: "", body: "", instr: "" }; location.hash = "#/briefe"; render(); },
  wizStep: (n) => { nkWizState().step = Number(n); render(); window.scrollTo(0, 0); },
  wizResearch: (id) => wizResearch(id),
  wizResearchAll: () => wizResearch("_all"),
  wizApply: () => {
    const w = nkWizState();
    const items = Object.entries(w.items).filter(([, x]) => x.use && x.amount).map(([id, x]) => ({ kind: id.startsWith("s_") ? "sonstige" : id, label: x.label, amount: x.amount, key: x.key, pct: 70, shares: {}, umlage: true, expenseIds: x.expenseIds }));
    state.settings.nkWizard = { ...(state.settings.nkWizard || {}), [w.objectId]: { answers: w.answers, sonstige: w.sonstige } };
    persist();
    ui.nk = { id: null, objectId: w.objectId, from: w.from, to: w.to, items };
    for (const [i, it] of items.entries()) if (["wasser", "abwasser", "heizung", "warmwasser"].includes(it.kind) && w.answers[it.kind.startsWith("w") || it.kind === "abwasser" ? "wasserzaehler" : "zentralheizung"] === "ja") fillFromMeters(i, true);
    ui.nkWiz = null; location.hash = "#/nebenkosten"; toast("Übernommen – Verteilung je Mieter prüfen und speichern");
  },
  nkMeters: (i) => { fillFromMeters(Number(i)); render(); },
  logout: async () => {
    await syncNow();
    // Datenschutz auf gemeinsam genutzten Geräten: lokale Kopien der Daten und Belege dieses Kontos entfernen
    try { Object.keys(localStorage).filter((k) => k.startsWith("hausops-immo-v1:")).forEach((k) => localStorage.removeItem(k)); } catch {}
    await F.clearAll().catch(() => {});
    await Cloud.signOut(); location.hash = "#/";
  },
  authTab: (t) => { ui.authTab = t; ui.authMsg = ""; render(); },
  legal: showLegal,
  editRepair: (id) => { if ($("#modal").open) $("#modal").close(); editRepair(id); },
  instTab: (t) => { ui.instTab = t; render(); }, instFilter: (f) => { ui.instFilter = f; render(); },
  repairExpense, repairOrder: repairOrderText, repairNotice: repairNoticeText,
  editMaint: (id) => editMaint(id), maintDone, maintTemplates,
  repairFromNote: (nid) => {
    const n = state.notes.find((x) => x.id === nid), c = byId("contracts", n.contractId) || state.contracts.find((x) => x.tenantIds.includes(n.tenantId));
    const u = byId("units", c?.unitId);
    $("#modal").close();
    const rid = C.uid("r_");
    n.repairId = rid;
    editRepair(null, { id: rid, title: n.title, description: n.text || "", objectId: u?.objectId || state.objects[0]?.id, unitId: u?.id || "", reportedAt: n.date, reportedBy: "mieter", tenantId: n.tenantId, payer: c && (c.kleinRepCase || c.kleinreparatur) ? "vermieter" : "vermieter" });
  },
  portalInvite, portalRevoke, portalWrite: (tid) => portalWrite(tid),
  portalReply: (v) => { const [tid, id] = v.split("|"); portalWrite(tid, id); },
  portalShareDoc: (v) => { const [docId, tid] = v.split("|"); portalShareDoc(docId, tid); },
  portalToRepair, portalToMeter, portalFilter: (f) => { ui.portalFilter = f; render(); },
  portalLeave: () => { auth.portalView = null; render(); },
  tpReport, tpMeter, tpMessage, tpOpenDoc, tpDocs: () => document.getElementById("tpdocs")?.scrollIntoView({ behavior: "smooth" }),
  monthNav: (k) => { location.hash = `#/monat/${k}`; },
  monthSend: (k) => monthSendDialog(k),
  monthPdf: async (k) => { const f = await monthFiles(k); download(f[0].name, f[0].blob); },
  monthCsv: async (k) => { const f = await monthFiles(k); download(f[1].name, f[1].blob); },
  monthDatev: async (k) => { const f = await monthFiles(k); download(f[2].name, f[2].blob); },
  teamInvite: () => inviteDialog(),
  teamShareInvite: (v) => { const [token, email] = v.split("|"); shareInvite(token, email); },
  teamRevoke: async (token) => { if (!confirm("Einladung zurückziehen? Der Link funktioniert danach nicht mehr.")) return; try { await Cloud.teamRevokeInvite(token); toast("Einladung zurückgezogen"); loadTeam(); } catch (e) { alert(e.message); } },
  teamRemove: async (member) => { const m = (ui.team || []).find((t) => t.member_id === member); if (!confirm(`${m?.name || m?.email || "Person"} den Zugriff entziehen? Die Person kann deinen Bestand danach nicht mehr sehen.`)) return; try { await Cloud.teamRemove(auth.user.id, member); toast("Zugriff entzogen"); loadTeam(); } catch (e) { alert(e.message); } },
  teamLeave: async (owner) => {
    const w = auth.workspaces.find((x) => x.owner_id === owner);
    if (!confirm(`Bestand „${w?.owner_name || ""}“ verlassen? Du verlierst den Zugriff, bis du erneut eingeladen wirst.`)) return;
    try {
      if (owner === wsId()) await switchWorkspace(auth.user.id);
      await Cloud.teamRemove(owner, auth.user.id); await loadWorkspaces(); toast("Bestand verlassen"); render();
    } catch (e) { alert(e.message); }
  },
  switchWs: (owner) => switchWorkspace(owner),
  copyText: (t) => copyText(t),
  deleteSelf: async () => {
    if (prompt(`Konto und ALLE Daten endgültig löschen?${(ui.team || []).some((t) => t.kind === "member") ? " Alle eingeladenen Teammitglieder verlieren ebenfalls den Zugriff." : ""} Zur Bestätigung LÖSCHEN eintippen.`) !== "LÖSCHEN") return;
    try { await Cloud.deleteAccount(null); localStorage.removeItem(`hausops-immo-v1:${auth.user.id}`); await Cloud.signOut(); alert("Dein Konto wurde gelöscht."); }
    catch (e) { alert("Löschen fehlgeschlagen: " + e.message); }
  },
  adminTab: (t) => { ui.adminTab = t; render(); },
  adminGroupAdd: (owner) => { if ($("#modal").open) $("#modal").close(); adminGroupAddDialog(owner); },
  adminGroupNew: () => { const v = $("#adminGroupOwner")?.value; if (!v) return toast("Bitte zuerst ein Konto auswählen."); adminGroupAddDialog(v); },
  adminGroupInvites: async (owner) => { try { ui.adminInvites = { ...(ui.adminInvites || {}), [owner]: await Cloud.adminInvites(owner) }; render(); } catch (e) { alert(e.message); } },
  adminGroupLink: (token) => prompt("Einladungslink:", inviteLink(token)),
  adminGroupRevoke: async (v) => { const [owner, token] = v.split("|"); if (!confirm("Einladung zurückziehen?")) return; try { await Cloud.adminRevokeInvite(token); ui.adminInvites[owner] = await Cloud.adminInvites(owner); toast("Zurückgezogen"); render(); } catch (e) { alert(e.message); } },
  adminGroupRemove: async (v) => { const [owner, member] = v.split("|"); if (!confirm(`${adminUserName(member)} aus der Gruppe von ${adminUserName(owner)} entfernen? Die Person verliert sofort den Zugriff.`)) return; try { await Cloud.adminRemoveMember(owner, member); toast("Entfernt"); await loadAdmin(); } catch (e) { alert(e.message); } },
  adminReload: () => loadAdmin(),
  adminUser: (id) => adminUserDialog(id),
  adminPlan: (id) => adminPlanDialog(id),
  adminResetPw: async (email) => { try { await Cloud.resetPassword(email); toast(`Reset-Mail an ${email} gesendet`); } catch (e) { alert(Cloud.friendlyAuthError(e)); } },
  adminDelete: async (id) => {
    const u = ui.adminUsers.find((x) => x.id === id);
    if (prompt(`Konto ${u.email} mit ALLEN Daten und Belegen endgültig löschen? Zur Bestätigung die E-Mail-Adresse eintippen.`) !== u.email) return;
    try { await Cloud.deleteAccount(id); $("#modal").close(); toast("Konto gelöscht"); loadAdmin(); } catch (e) { alert("Löschen fehlgeschlagen: " + e.message); }
  },
  openDoc, editDoc, bookDoc, kiDoc: (id) => kiReadDoc(id),
  docFilter: (f) => { ui.docFilter = f; render(); },
  ablageFolder: (k) => { ui.ablageFolder = ui.ablageFolder === k ? null : k || null; render(); },
  letterReset: () => { ui.letter.body = ""; render(); },
  letterKi: async () => {
    const L = ui.letter; if (!K.hasKey()) return toast("Bitte zuerst den KI-Schlüssel in den Einstellungen eintragen.");
    ui.letterBusy = true; render();
    try { const r = await K.draftLetter({ kind: LETTERS[L.kind][0], instructions: L.instr, facts: letterFacts(L.contractId), current: `${L.subject}\n\n${L.body}` }); L.subject = r.subject; L.body = r.body; }
    catch (e) { alert(K.friendlyError(e)); }
    ui.letterBusy = false; render();
  },
  letterSave: () => { const L = ui.letter; const l = { id: C.uid("l_"), date: today(), contractId: L.contractId, kind: L.kind, subject: L.subject, body: L.body }; state.letters.push(l); persist(); location.hash = `#/brief/${l.id}`; },
  letterMail: () => { const L = ui.letter; const c = byId("contracts", L.contractId); const mail = (c?.tenantIds || []).map((x) => byId("tenants", x)?.email).filter(Boolean).join(","); location.href = `mailto:${mail}?subject=${encodeURIComponent(L.subject)}&body=${encodeURIComponent(L.body)}`; },
  letterDel: (id) => { if (confirm("Brief aus dem Archiv löschen?")) { state.letters = state.letters.filter((x) => x.id !== id); commit("Gelöscht"); } },
  kiExample: (q) => kiAsk(q),
  kiClear: () => { ui.chat = []; render(); },
  kiCopy: (i) => copyText(ui.chat[Number(i)].a),
  kiToLetter: (i) => { ui.letter = { kind: "frei", contractId: "", subject: "", body: ui.chat[Number(i)].a, instr: "" }; location.hash = "#/briefe"; },
  nkArchive: (v) => { const [stId, cid] = v.split("|"); const st = state.nkStatements.find((x) => x.id === stId); state.letters.push({ id: C.uid("l_"), date: today(), contractId: cid, kind: "nk", subject: `Betriebskostenabrechnung ${d(st.from)} – ${d(st.to)}`, body: "(siehe gedruckte Abrechnung)", nkStatementId: stId }); commit("Im Briefarchiv vermerkt"); },
  nkAttach: () => { ui.nkAttach = !ui.nkAttach; render(); },
  nkKiCheck: async () => {
    if (!K.hasKey()) return toast("Bitte zuerst den KI-Schlüssel in den Einstellungen eintragen.");
    ui.chat = ui.chat || [];
    location.hash = "#/ki";
    const nk = nkDraft();
    await kiAsk(`Prüfe die aktuelle Nebenkostenabrechnung für ${byId("objects", nk.objectId)?.name} (${d(nk.from)}–${d(nk.to)}) auf Fehler und Risiken: Sind alle Positionen nach BetrKV umlagefähig, passen die Umlageschlüssel, fehlen typische Kostenarten, ist die Frist eingehalten? Positionen: ${nk.items.map((i) => `${i.label} ${eur(i.amount)} nach ${C.NK_KEYS[i.key]}`).join("; ")}.`);
  }, newUnit: (id) => editUnit(null, id), editUnit,
  newTenant: () => editTenant(), editTenant, deleteTenant: (id) => deleteTenantAll(id), newContract: (unitId) => editContract(null, unitId), editContract, addStep,
  moveWizardFromContract: (unitId) => { $("#modal").close(); moveWizard(unitId || undefined); },
  deleteContract: (id) => {
    const c = byId("contracts", id); if (!c) return;
    if (state.payments.some((p) => p.contractId === id)) return alert("Zu diesem Vertrag gibt es Zahlungen. Bitte die Zahlungen zuerst einem anderen Vertrag zuordnen oder den Vertrag mit Mietende beenden.");
    if (!confirm(`Vertrag „${contractLabel(c)}“ wirklich löschen?`)) return;
    state.contracts = state.contracts.filter((x) => x.id !== id); commit("Vertrag gelöscht");
  },
  newPayment: () => editPayment(), editPayment, backfill: backfillDialog,
  undoBackfill: () => { const b = ui.lastBatch; if (!b) return; state.payments = state.payments.filter((p) => p.batch !== b.id); ui.lastBatch = null; commit("Nachtragen rückgängig gemacht"); }, newExpense: () => editExpense(), editExpense,
  newAccount: () => editAccount(), editAccount,
  assign: assignDialog,
  accept: (id) => { const tx = byId("transactions", id); applyAssignment(tx, C.suggestAssignment(tx, state), false); commit("Zugeordnet"); },
  acceptAll: () => { let n = 0; for (const tx of state.transactions.filter((t) => !t.link)) { const s = C.suggestAssignment(tx, state); if (s && s.score >= 60) { applyAssignment(tx, s, false); n++; } } commit(`${n} Umsätze zugeordnet`); },
  unlink: (id) => unlink(byId("transactions", id)),
  unlinkPayment: (pid) => {
    const tx = state.transactions.find((t) => t.link?.type === "payment" && (t.link.ids || [t.link.id]).includes(pid));
    if (!tx) return editPayment(pid);
    if (!confirm("Zuordnung lösen? Die Bank-Buchung bleibt erhalten und erscheint wieder unter „Konto & Zahlungen → Offen“, wo du sie neu zuordnen kannst.")) return;
    unlink(tx);
  },
  bankFilter: (f) => { ui.bankFilter = f; render(); },
  year: (y) => { ui.year = Number(y); ui.datevFrom = ui.datevTo = null; render(); },
  newBooking: () => editBooking(), editBooking,
  newBookingAt: (v) => { const [unitId, from] = v.split("|"); editBooking(null, { unitId, from, to: addDays(from, 7) }); },
  invoiceFromBooking, guestMsg, cleaningMsg, finalizeInvoice, deleteDraft,
  anonTenant: (id) => { if (!confirm("Mieter unwiderruflich anonymisieren? Name, Kontaktdaten, IBAN und Notizen werden gelöscht; Beträge bleiben erhalten.")) return; const i = state.tenants.findIndex((t) => t.id === id); state.tenants[i] = R.anonymizeTenant(state.tenants[i]); commit("Mieter anonymisiert"); },
  anonGuests: () => { const due = new Set(R.retentionDue(state, today()).guests.map((b) => b.id)); state.bookings = state.bookings.map((b) => (due.has(b.id) ? R.anonymizeGuest(b) : b)); commit(`${due.size} Gastdatensätze bereinigt`); },
  pkgYear: (y) => { location.hash = `#/paket/${y}`; },
  nkAdd: () => { nkDraft().items.push({ label: "Grundsteuer", amount: 0, key: "flaeche", pct: 70, shares: {} }); render(); },
  nkDel: (i) => { nkDraft().items.splice(Number(i), 1); render(); },
  nkFromExpenses: () => { const nk = nkDraft(); const add = C.nkItemsFromExpenses(state, nk.objectId, nk.from, nk.to); if (!add.length) return toast("Keine umlagefähigen Ausgaben im Zeitraum gefunden."); nk.items = [...nk.items.filter((x) => !add.some((a) => a.label === x.label)), ...add]; render(); },
  nkSave: () => { const nk = nkDraft(); if (!nk.items.length) return toast("Keine Kostenpositionen."); if (!confirmLegal(R.nkPeriodCheck(nk.from, nk.to))) return; nk.id = nk.id || C.uid("nk_"); state.nkStatements = [...(state.nkStatements || []).filter((x) => x.id !== nk.id), structuredClone(nk)]; commit("Abrechnung gespeichert – Anschreiben können jetzt gedruckt werden"); },
  nkLoad: (id) => { ui.nk = structuredClone(state.nkStatements.find((x) => x.id === id)); render(); },
  newInvoice: () => editInvoice(), editInvoice, cancelInvoice, markPaid,
  invoiceRecipient: recipientDialog, invoicePdf: downloadInvoicePdf, emailInvoice, archiveInvoice: (id) => archiveInvoicePdf(id),
  draftsForAll: () => { if (blockedWrite()) return; const list = bookingsWithoutInvoice().filter((b) => b.from <= today()); for (const b of list) createInvoiceDraft(b); commit(`${list.length} Rechnungsentwürfe angelegt – bitte prüfen und festschreiben`); }, smoobu: smoobuImport, smoobuConnect,
  smoobuDisconnect: async () => { if (!confirm("Smoobu-Verbindung trennen? Bereits übernommene Buchungen bleiben erhalten.")) return; try { await Cloud.smoobuSet("", ""); state.settings.smoobuAuto = false; ui.smoobu = false; commit("Smoobu getrennt"); } catch (e) { alert(e.message); } },
  datevPreset: (p) => {
    const y = ui.year;
    if (p === "y") { ui.datevFrom = `${y}-01-01`; ui.datevTo = `${y}-12-31`; }
    else if (p === "q") { const qm = Math.floor((Number(ui.month.slice(5)) - 1) / 3) * 3 + 1; const k = `${ui.month.slice(0, 4)}-${String(qm).padStart(2, "0")}`; const e = C.addMonths(k, 2); ui.datevFrom = `${k}-01`; ui.datevTo = `${e}-${C.daysInMonth(e)}`; }
    else { ui.datevFrom = `${ui.month}-01`; ui.datevTo = `${ui.month}-${C.daysInMonth(ui.month)}`; }
    render();
  },
  datev: () => datevExport(ui.datevFrom || `${ui.month}-01`, ui.datevTo || `${ui.month}-${C.daysInMonth(ui.month)}`),
  journal: () => journalCsv(ui.datevFrom || `${ui.month}-01`, ui.datevTo || `${ui.month}-${C.daysInMonth(ui.month)}`),
  delRule: (k) => { delete state.rules[k]; commit("Regel gelöscht"); },
  backupFull: async () => {
    toast("Sicherung wird erstellt …");
    const out = {};
    for (const doc of state.documents) { const blob = await getDocBlob(doc.id).catch(() => null); if (blob) out[doc.id] = { type: blob.type, data: await F.blobToBase64(blob) }; }
    download(`hausops-immobilien-sicherung-mit-belegen-${today()}.json`, JSON.stringify({ ...state, _files: out }), "application/json");
  },
  backup: () => download(`hausops-immobilien-sicherung-${today()}.json`, JSON.stringify(state, null, 1), "application/json"),
  loadDemo: () => { ui.setup = null; if (state.objects.length && !confirm("Vorhandene Daten werden durch Demo-Daten ersetzt. Fortfahren?")) return; state = S.demoState(); commit("Demo-Daten geladen – probiere „Bank“ → Vorschläge übernehmen"); },
  reset: () => { if (confirm("Wirklich ALLE Daten löschen? Vorher Sicherung herunterladen!") && confirm("Letzte Bestätigung: alles löschen?")) { state = S.emptyState(); commit("Alle Daten gelöscht"); } },
};

function editAccount(id) {
  const a = byId("accounts", id) || { id: C.uid("a_") };
  formDialog({
    title: id ? "Bankkonto bearbeiten" : "Neues Bankkonto", spec: SPEC.account, data: a,
    intro: `<div class="note small">Live-Anbindung per PSD2/FinTS ist vorbereitet (siehe Doku). Bis dahin: Umsätze im Online-Banking als CSV oder CAMT.053 exportieren und hier importieren.</div>`,
    onSave: (v) => { upsert("accounts", { ...a, ...v, iban: C.normIban(v.iban) }); commit("Konto gespeichert"); },
    onDelete: id && (() => {
      if (state.transactions.some((t) => t.accountId === id)) return alert("Konto hat Umsätze und kann nicht gelöscht werden.");
      state.accounts = state.accounts.filter((x) => x.id !== id); commit("Konto gelöscht");
    }),
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) && $("#gsearch")) { e.preventDefault(); $("#gsearch").focus(); }
});

document.addEventListener("click", (e) => {
  const ft = e.target.closest?.("[data-folder-tab]");
  if (ft) ui.nextFolderTab = ft.dataset.folderTab;
  if (e.target.closest?.("[data-close]") && $("#modal").open) $("#modal").close();
  const go = e.target.closest("[data-go]");
  const el = e.target.closest("[data-act]");
  if (el && actions[el.dataset.act]) { e.preventDefault(); e.stopPropagation(); actions[el.dataset.act](el.dataset.id); return; }
  if (go) location.hash = go.dataset.go;
});

document.addEventListener("change", async (e) => {
  const nkf = e.target.dataset?.nk;
  if (nkf) {
    const nk = nkDraft(), v = e.target.value, it = nk.items[Number(e.target.dataset.i)];
    if (nkf === "objectId") { ui.nk = { id: null, objectId: v, from: nk.from, to: nk.to, items: C.nkItemsFromExpenses(state, v, nk.from, nk.to) }; }
    else if (nkf === "from" || nkf === "to") nk[nkf] = v;
    else if (nkf === "label") { it.label = v; const def = C.BETRKV.find((x) => x[1] === v); if (def && !it.amount) it.key = def[2]; }
    else if (nkf === "amount") it.amount = C.parseAmount(v);
    else if (nkf === "key") it.key = v;
    else if (nkf === "pct") it.pct = Math.min(70, Math.max(50, Number(v) || 70));
    else if (nkf === "co2Cost") it.co2Cost = C.parseAmount(v);
    else if (nkf === "co2Kg") it.co2Kg = Number(String(v).replace(",", ".")) || 0;
    else if (nkf === "nonResidential") it.nonResidential = e.target.checked;
    else if (nkf === "share") { it.shares = it.shares || {}; it.shares[e.target.dataset.u] = it.key === "direkt" ? C.parseAmount(v) : Number(String(v).replace(",", ".")) || 0; }
    render(); return;
  }
  const wi = e.target.dataset?.wizitem;
  if (wi) {
    const it = nkWizState().items[wi], f = e.target.dataset.f;
    if (f === "use") it.use = e.target.value === "1";
    else if (f === "amount") it.amount = C.parseAmount(e.target.value);
    else it[f] = e.target.value;
    render(); return;
  }
  const lf = e.target.dataset?.letter;
  if (lf) {
    const L = ui.letter; L[lf] = e.target.value;
    if (lf === "kind" || lf === "contractId") { L.body = ""; render(); }
    return;
  }
  const k = e.target.dataset?.change;
  if (!k) return;
  if (k === "docUpload" || k === "docScan") { await addFiles(e.target.files, { scan: k === "docScan" }); e.target.value = ""; return; }
  if (k === "autoKi") { ui.autoKi = e.target.checked; return; }
  if (k === "ablageUpload") { const fl = [...e.target.files]; e.target.value = ""; await bulkImport(fl, ui.ablageObj); return; }
  if (k === "ablageObj") { ui.ablageObj = e.target.value; ui.ablageFolder = null; location.hash = `#/ablage/${e.target.value}`; return; }
  if (k === "kiPseudo") { state.settings.kiPseudo = e.target.checked; commit(e.target.checked ? "Datensparsamer KI-Modus an" : "Datensparsamer KI-Modus aus"); return; }
  if (k === "smoobuAuto") { state.settings.smoobuAuto = e.target.checked; commit(e.target.checked ? "Smoobu wird automatisch abgerufen" : "Smoobu-Abruf aus"); if (e.target.checked) syncAll(); return; }
  if (k === "syncToken") { try { e.target.value ? localStorage.setItem(SYNC_TOKEN_KEY, e.target.value.trim()) : localStorage.removeItem(SYNC_TOKEN_KEY); } catch {} toast("Sync-Schlüssel gespeichert (nur auf diesem Gerät)"); return; }
  if (k === "folderKind") { ui.folderKind = e.target.value; render(); return; }
  if (k === "folderUpload") {
    const tid = location.hash.split("/")[2], t = byId("tenants", tid);
    const cs = state.contracts.filter((c) => c.tenantIds.includes(tid)).sort((a, b) => (a.start < b.start ? 1 : -1));
    const c = cs.find((x) => x.start <= today() && (!x.end || x.end >= today())) || cs[0];
    if (!c) { toast("Bitte zuerst einen Mietvertrag anlegen."); return; }
    await addFiles(e.target.files, { scan: !!e.target.dataset.scan, meta: { kind: e.target.dataset.kind, contractId: c.id, objectId: byId("units", c.unitId)?.objectId || "", tenantId: t?.id } });
    e.target.value = ""; return;
  }
  if (k === "tenantSearch") { ui.tenantSearch = e.target.value; render(); return; }
  if (k === "adminShowTenants") { ui.adminShowTenants = e.target.checked; render(); return; }
  if (k === "adminSearch") { ui.adminSearch = e.target.value; render(); return; }
  if (k === "switchWs") { if (e.target.value.startsWith("portal:")) { auth.portalView = e.target.value.slice(7); ui.tp = null; render(); startPortalPoll(); } else switchWorkspace(e.target.value); return; }
  if (k === "portalStatus") { try { await Cloud.portalUpdateItem(Number(e.target.dataset.id), { status: e.target.value }); const it = portalData()?.items.find((x) => x.id === Number(e.target.dataset.id)); if (it) it.status = e.target.value; toast("Status geändert – der Mieter sieht ihn im Portal"); } catch (err) { alert(err.message); } return; }
  if (k === "portalEmergency") { state.settings.portalEmergency = e.target.value.trim(); commit("Notfall-Kontakte gespeichert"); for (const row of portalData()?.tenants || []) if (!row.revoked_at) Cloud.portalUpdateTenant(row.id, { info: portalInfo(row.tenant_key) }).catch(() => {}); return; }
  if (k === "monthReportKey") { if (e.target.value) location.hash = `#/monat/${e.target.value}`; return; }
  if (k === "instObj") { ui.instObj = e.target.value; render(); return; }
  if (k === "repairUpload") {
    const r = state.repairs.find((x) => x.id === e.target.dataset.id);
    const added = await addFiles(e.target.files, { scan: false, meta: { kind: "foto", objectId: r.objectId, repairId: r.id, note: `Reparatur: ${r.title}` } });
    r.docIds = [...(r.docIds || []), ...added.map((x) => x.id)]; commit(); e.target.value = "";
    $("#modal").close(); editRepair(r.id); return;
  }
  if (k === "autoInvoiceDrafts") { state.settings.autoInvoiceDrafts = e.target.checked; commit(e.target.checked ? "Neue Smoobu-Buchungen bekommen automatisch einen Rechnungsentwurf" : "Automatische Rechnungsentwürfe aus"); return; }
  if (k === "adminMemberRole") { try { await Cloud.adminSetMemberRole(e.target.dataset.owner, e.target.dataset.id, e.target.value); toast("Rolle geändert"); await loadAdmin(); } catch (err) { alert(err.message); } return; }
  if (k === "teamRole") { try { await Cloud.teamSetRole(e.target.dataset.id, e.target.value); toast("Rolle geändert"); loadTeam(); } catch (err) { alert(err.message); } return; }
  if (k === "attachExpense") { const id = e.target.dataset.id; if (!byId("expenses", id)) return toast("Bitte die Ausgabe zuerst speichern."); $("#modal").close(); await addFiles(e.target.files, { expenseId: id }); editExpense(id); return; }
  if (k === "kiKey") { K.setKey(e.target.value); toast(e.target.value ? "KI-Schlüssel gespeichert (nur auf diesem Gerät)" : "KI-Schlüssel entfernt"); render(); return; }
  const v = e.target.value;
  if (k === "month") { if (v) { ui.month = v; ui.year = Number(v.slice(0, 4)); } render(); }
  else if (k === "bankSearch") { ui.bankSearch = v; render(); }
  else if (k === "expObj") { ui.expObj = v; render(); }
  else if (k === "datevFrom" || k === "datevTo") { ui[k] = v; render(); }
  else if (k === "importFile") {
    const file = e.target.files[0];
    if (file) await importFile(file, $("#impAcc").value).catch((err) => alert("Import fehlgeschlagen: " + err.message));
    e.target.value = "";
  } else if (k === "restore") {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const next = S.importBackup(await file.text());
      const files = next._files || {}; delete next._files;
      if (confirm(`Sicherung mit ${next.objects.length} Objekten, ${next.transactions.length} Umsätzen und ${Object.keys(files).length} Belegdateien einspielen? Aktuelle Daten werden ersetzt.`)) {
        for (const [id, f] of Object.entries(files)) await putDocBlob(id, await F.base64ToBlob(f.data, f.type));
        state = next; commit("Sicherung eingespielt");
      }
    } catch (err) { alert(err.message); }
  }
});

async function handleAccountForm(f, form) {
  const v = Object.fromEntries(new FormData(form));
  const btnEl = form.querySelector("button:not([type=button])");
  if (btnEl) btnEl.disabled = true;
  try {
    if (f === "login") { await Cloud.signIn(v.email.trim(), v.password); const s = await Cloud.session(); ui.authMsg = ""; await enterAccount(s.user); }
    if (f === "tenantRegister") {
      if (v.password.length < 8) throw new Error("Das Passwort muss mindestens 8 Zeichen haben.");
      if (!form.privacy.checked) throw new Error("Bitte die Datenschutzhinweise bestätigen.");
      const r = await Cloud.signUp({ email: v.email.trim(), password: v.password, fullName: v.fullName.trim(), company: "", consent: { account_type: "mieter", terms_accepted: true, consent_at: new Date().toISOString() } });
      if (r.session) await enterAccount(r.session.user);
      else { ui.authTab = "login"; ui.authMsg = "Fast geschafft! Bitte bestätigen Sie Ihre E-Mail-Adresse über den Link in der Mail und melden Sie sich dann hier an."; render(); }
    }
    if (f === "register") {
      if (v.password.length < 8) throw new Error("Das Passwort muss mindestens 8 Zeichen haben.");
      const r = await Cloud.signUp({ email: v.email.trim(), password: v.password, fullName: v.fullName.trim(), company: (v.company || "").trim(), consent: { terms_accepted: true, avv_accepted: true, consent_at: new Date().toISOString() } });
      if (r.session) await enterAccount(r.session.user);
      else { ui.authTab = "login"; ui.authMsg = "Fast geschafft! Bitte bestätige deine E-Mail-Adresse über den Link in der Mail und melde dich dann an."; render(); }
    }
    if (f === "reset") { await Cloud.resetPassword(v.email.trim()); ui.authTab = "login"; ui.authMsg = "Falls ein Konto existiert, ist eine E-Mail mit Link unterwegs."; render(); }
    if (f === "newpw") { await Cloud.updatePassword(v.password); ui.authTab = "login"; toast("Passwort gespeichert"); const s = await Cloud.session(); if (s) await enterAccount(s.user); else render(); }
    if (f === "profile") { await Cloud.updateProfile(auth.user.id, { full_name: v.full_name.trim(), company: v.company.trim() }); Object.assign(auth.profile, { full_name: v.full_name.trim(), company: v.company.trim() }); toast("Profil gespeichert"); render(); }
    if (f === "password") { await Cloud.updatePassword(v.password); form.reset(); toast("Passwort geändert"); }
    if (f === "appsettings") {
      await Cloud.saveAppSettings({ product_name: v.product_name, support_email: v.support_email, trial_days: Number(v.trial_days) || 30, registration_open: !!v.registration_open, announcement: v.announcement, impressum: v.impressum, datenschutz: v.datenschutz, agb: v.agb, avv: v.avv, widerruf: v.widerruf, price_note: v.price_note, legal_version: v.legal_version });
      auth.settings = await Cloud.appSettings(); toast("Einstellungen gespeichert"); render();
    }
  } catch (err) {
    alert(Cloud.friendlyAuthError(err));
  } finally { if (btnEl) btnEl.disabled = false; }
}

document.addEventListener("input", (e) => {
  if (e.target.id === "gsearch") {
    ui.globalQ = e.target.value;
    clearTimeout(ui.searchTimer);
    ui.searchTimer = setTimeout(() => { if (location.hash !== "#/suche") location.hash = "#/suche"; else render(); }, 200);
    return;
  }
  const lf = e.target.dataset?.letter;
  if (lf && ["subject", "body", "instr"].includes(lf)) ui.letter[lf] = e.target.value;
});

// Drag & Drop von Dateien auf die Belege-Seite
document.addEventListener("dragover", (e) => { if (e.target.closest?.("[data-drop]")) { e.preventDefault(); e.target.closest("[data-drop]").classList.add("over"); } });
document.addEventListener("dragleave", (e) => { e.target.closest?.("[data-drop]")?.classList.remove("over"); });
document.addEventListener("drop", async (e) => {
  const z = e.target.closest?.("[data-drop]"); if (!z) return;
  e.preventDefault(); z.classList.remove("over");
  if (z.dataset.drop === "ablage") { const files = await filesFromDrop(e.dataTransfer); return bulkImport(files, ui.ablageObj); }
  addFiles(e.dataTransfer.files);
});

document.addEventListener("submit", (e) => {
  const f = e.target.dataset?.form;
  if (!f) return;
  e.preventDefault();
  if (f === "ki") { kiAsk(e.target.q.value); return; }
  if (f === "setup1") { const v = Object.fromEntries(new FormData(e.target)); Object.assign(state.settings, v); persist(); ui.setup.step = 2; render(); window.scrollTo(0, 0); return; }
  if (f === "setup2") { const v = Object.fromEntries(new FormData(e.target)); Object.assign(ui.setup, v); ui.setup.step = 3; render(); window.scrollTo(0, 0); return; }
  if (f === "nkwiz1") {
    const fd = new FormData(e.target), w = nkWizState();
    const objChanged = fd.get("objectId") !== w.objectId || fd.get("from") !== w.from || fd.get("to") !== w.to;
    Object.assign(w, { objectId: fd.get("objectId"), from: fd.get("from"), to: fd.get("to"), sonstige: fd.getAll("sonstige"), step: 2 });
    for (const q of B.QUESTIONS) w.answers[q.id] = fd.get(`q_${q.id}`) || w.answers[q.id];
    if (objChanged) w.items = {};
    for (const id of Object.keys(w.items)) if (!B.relevantItems(w.answers).some((c) => c.id === id) && !(id.startsWith("s_") && w.sonstige.includes(id.slice(2)))) delete w.items[id];
    render(); window.scrollTo(0, 0); return;
  }
  if (["login", "register", "tenantRegister", "reset", "newpw", "profile", "password", "appsettings"].includes(f)) { handleAccountForm(f, e.target); return; }
  if (f === "cancel") {
    const v = Object.fromEntries(new FormData(e.target));
    if (v.kind === "ausserordentlich" && !v.reason.trim()) return alert("Bitte bei einer außerordentlichen Kündigung den Grund angeben.");
    const b = e.target.querySelector("button"); b.disabled = true;
    Cloud.cancelContract(v).then((r) => { ui.cancelResult = r; render(); window.scrollTo(0, 0); }).catch((err) => { alert(err.message); b.disabled = false; });
    return;
  }
  const fd = Object.fromEntries(new FormData(e.target));
  const s = state.settings;
  if (f === "owner") Object.assign(s, fd, { invoiceIban: C.normIban(fd.invoiceIban) });
  if (f === "invoice") {
    const y = new Date().getFullYear();
    Object.assign(s, { invoicePrefix: fd.invoicePrefix || "RE-{JJJJ}-", paymentTermDays: Number(fd.paymentTermDays) || 14, invoiceFooter: fd.invoiceFooter,
      defaultKurtaxe: C.parseAmount(fd.defaultKurtaxe), defaultCleaning: C.parseAmount(fd.defaultCleaning), kleinunternehmer: !!fd.kleinunternehmer,
      invoiceCounters: { ...(s.invoiceCounters || {}), [y]: Math.max(0, Number(fd.counter) || 0) } });
  }
  if (f === "datev") {
    const skrOld = s.skr === "04" ? "04" : "03";
    const accs = {}, exps = {};
    for (const [k, v] of Object.entries(fd)) {
      if (k.startsWith("acc_") && v !== C.DEFAULT_ACCOUNTS[skrOld][k.slice(4)]) accs[k.slice(4)] = v.trim();
      if (k.startsWith("exp_") && v !== C.EXPENSE_CATEGORIES[k.slice(4)]?.[`skr${skrOld}`]) exps[k.slice(4)] = v.trim();
    }
    s.accounts = { ...(s.accounts || {}), [skrOld]: accs };
    s.expenseAccounts = { ...(s.expenseAccounts || {}), [skrOld]: exps };
    Object.assign(s, { skr: fd.skr, datevBerater: fd.datevBerater.trim(), datevMandant: fd.datevMandant.trim(), datevKontenlaenge: Number(fd.datevKontenlaenge) || 4, autoAssignScore: Number(fd.autoAssignScore) || 80, sollStart: fd.sollStart || "", taxAdvisorName: (fd.taxAdvisorName || "").trim(), taxAdvisorEmail: (fd.taxAdvisorEmail || "").trim() });
  }
  commit("Einstellungen gespeichert");
});

window.addEventListener("hashchange", () => {
  const [route, arg] = location.hash.replace(/^#\/?/, "").split("/");
  if (route === "mieter" && arg) { ui.folderTenant = arg; ui.folderTab = ui.nextFolderTab || "ueberblick"; ui.nextFolderTab = null; }
  if (route === "konto" && isCloud()) { ui.team = null; loadWorkspaces().then(() => { if (location.hash.startsWith("#/konto")) render(); }); }
  render(); window.scrollTo(0, 0);
});
boot();
document.addEventListener("toggle", (e) => { if (e.target?.matches?.("details[data-vacant]")) ui.vacantOpen = e.target.open; }, true);
