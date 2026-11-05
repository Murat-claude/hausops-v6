// HausOps Immobilien — Oberfläche (Vanilla JS, ohne Build-Schritt)
import * as C from "./core.js";
import * as S from "./store.js";
import * as F from "./files.js";
import * as K from "./ki.js";

let state = S.load();
const ui = { bankFilter: "offen", bankSearch: "", month: C.monthKey(today()), year: Number(today().slice(0, 4)), csv: null };

function today() { return new Date().toISOString().slice(0, 10); }
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = C.fmtEUR, d = C.fmtDate;
const byId = (list, id) => (state[list] || []).find((x) => x.id === id);
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (f(x) || 0), 0);

function commit(msg) {
  if (!S.save(state)) toast("⚠️ Speichern fehlgeschlagen (Speicher voll?) – bitte Datensicherung exportieren.");
  else if (msg) toast(msg);
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
    if (onSubmit(form) !== false) dlg.close();
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
    { k: "vat", l: "Umsatzsteuer auf Miete", t: "select", opts: [["0", "steuerfrei (§ 4 Nr. 12 UStG)"], ["7", "7 % (Beherbergung / Ferienwohnung)"], ["19", "19 % (Option / separater Stellplatz)"]] },
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
    { k: "address", l: "Anschrift (falls abweichend)", full: 1 },
    { k: "notes", l: "Notizen", t: "textarea" },
  ],
  contract: [
    { k: "unitId", l: "Einheit", t: "select", opts: () => unitOpts((u) => u.type !== "ferienwohnung"), req: 1, full: 1 },
    { k: "tenantIds", l: "Mieter", t: "checks", opts: () => state.tenants.map((t) => [t.id, t.name]) },
    { k: "start", l: "Mietbeginn", t: "date", req: 1 }, { k: "end", l: "Mietende (leer = unbefristet)", t: "date" },
    { k: "kalt", l: "Kaltmiete (€/Monat)", t: "money" }, { k: "nk", l: "NK-/Heizkosten-Vorauszahlung (€/Monat)", t: "money" },
    { k: "extra", l: "Zuschläge (Stellplatz, Möblierung …)", t: "money" }, { k: "kaution", l: "Kaution (€)", t: "money" },
    { k: "persons", l: "Personen im Haushalt (für Umlage nach Personen)", t: "number" },
    { k: "notes", l: "Notizen (Index-/Staffelmiete, Kündigungsfrist …)", t: "textarea" },
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
  const u = byId("units", id) || { id: C.uid("u_"), objectId: objectId || state.objects[0].id, type: "wohnung", vat: "0" };
  formDialog({
    title: id ? "Einheit bearbeiten" : "Neue Einheit", spec: SPEC.unit, data: { ...u, vat: String(u.vat ?? 0) },
    onSave: (v) => {
      if (v.type === "ferienwohnung" && !id && v.vat === "0") v.vat = "7";
      upsert("units", { ...u, ...v, vat: Number(v.vat) }); commit("Einheit gespeichert");
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
    onDelete: id && (() => {
      if (state.contracts.some((c) => c.tenantIds.includes(id))) return alert("Mieter ist noch einem Mietvertrag zugeordnet.");
      state.tenants = state.tenants.filter((x) => x.id !== id); commit("Mieter gelöscht");
    }),
  });
}

function editContract(id, unitId) {
  if (!state.units.some((u) => u.type !== "ferienwohnung")) return toast("Bitte zuerst eine Einheit (Wohnung, Garage …) anlegen.");
  const c = byId("contracts", id) || { id: C.uid("c_"), unitId: unitId || "", tenantIds: [], steps: [], start: today().slice(0, 8) + "01" };
  formDialog({
    title: id ? "Mietvertrag bearbeiten" : "Neuer Mietvertrag", spec: SPEC.contract, data: c,
    intro: state.tenants.length ? "" : `<div class="note warn">Lege zuerst unter „Mieter“ den Mieter an – dann kannst du ihn hier auswählen.</div>`,
    onSave: (v) => {
      if (!v.tenantIds.length && !confirm("Kein Mieter ausgewählt – trotzdem speichern?")) return false;
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
    intro: `<p class="muted" style="margin-bottom:10px">${esc(contractLabel(c))}</p>`,
    onSave: (v) => { c.steps = [...(c.steps || []).filter((s) => s.from !== v.from), v]; commit("Mietanpassung gespeichert"); },
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
  } else {
    const p = { id: C.uid("p_"), date: tx.date, amount: tx.amount, kind: a.kind, contractId: a.contractId || null, period: a.kind === "miete" ? a.period || C.periodForPayment(tx.date, tx.purpose) : null, invoiceId: a.invoiceId || null, objectId: a.objectId || null, txId: tx.id, note: tx.name };
    state.payments.push(p);
    tx.link = { type: "payment", id: p.id };
    if (p.invoiceId) refreshInvoiceStatus(p.invoiceId);
  }
  if (learn && a.kind !== "fewo") {
    const r = { kind: a.kind };
    if (a.contractId) r.contractId = a.contractId;
    if (a.category) r.category = a.category;
    if (a.objectId) r.objectId = a.objectId;
    state.rules[C.ruleKey(tx)] = r;
  }
}

function unlink(tx, silent) {
  if (!tx.link) return;
  if (tx.link.type === "payment") {
    const p = byId("payments", tx.link.id);
    state.payments = state.payments.filter((x) => x.id !== tx.link.id);
    if (p?.invoiceId) refreshInvoiceStatus(p.invoiceId);
  }
  if (tx.link.type === "expense") state.expenses = state.expenses.filter((x) => x.id !== tx.link.id);
  tx.link = null;
  if (!silent) commit("Zuordnung gelöst");
}

function refreshInvoiceStatus(invoiceId) {
  const inv = byId("invoices", invoiceId);
  if (!inv || inv.status === "storniert" || inv.type === "storno") return;
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
  const invOpts = state.invoices.filter((i) => i.type !== "storno" && i.status !== "storniert").map((i) => [i.id, `${i.number} · ${i.recipient?.name || ""} · ${eur(C.invoiceTotals(i).gross)} (${i.status})`]);
  const body = `
    <div class="note"><b>${eur(tx.amount)}</b> · ${d(tx.date)} · ${esc(tx.name)}<br><span class="small">${esc(tx.purpose)}</span>${tx.iban ? `<br><span class="small muted">${esc(tx.iban)}</span>` : ""}</div>
    <div class="fgrid">
      <label class="f full"><span>Zuordnen als</span><select name="kind">${opt(kinds, kind)}</select></label>
      <label class="f full" data-for="miete nk_nachzahlung kaution"><span>Mietvertrag</span><select name="contractId">${opt([["", "–"], ...contractOpts()], sug.contractId)}</select></label>
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
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf); // viele Banken liefern ANSI
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

function invoiceFromBooking(bookingId) {
  const b = byId("bookings", bookingId);
  if (b.invoiceId && byId("invoices", b.invoiceId)) { location.hash = `#/rechnung/${b.invoiceId}`; return; }
  const u = byId("units", b.unitId);
  const date = today();
  const inv = {
    id: C.uid("i_"), number: takeInvoiceNumber(date), date, serviceFrom: b.from, serviceTo: b.to, bookingId: b.id, unitId: b.unitId,
    recipient: { name: b.guest, address: [b.guestStreet, [b.guestZip, b.guestCity].filter(Boolean).join(" ")].filter(Boolean).join("\n") },
    lines: C.linesFromBooking(b, u), kleinunternehmer: !!state.settings.kleinunternehmer, status: "offen", type: "rechnung",
    note: b.channel && b.channel !== "Direkt" ? `Buchung über ${b.channel}.` : "",
  };
  state.invoices.push(inv);
  b.invoiceId = inv.id;
  S.save(state);
  location.hash = `#/rechnung/${inv.id}`;
  toast(`Rechnung ${inv.number} erstellt`);
}

function editInvoice(id) {
  const isNew = !id;
  const inv = byId("invoices", id) || { id: C.uid("i_"), date: today(), recipient: { name: "", address: "" }, lines: [{ desc: "Übernachtung", qty: 1, price: 0, vat: 7 }], kleinunternehmer: !!state.settings.kleinunternehmer, status: "offen", type: "rechnung", unitId: fewoUnits()[0]?.id || "" };
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
      <label class="f"><span>Empfänger</span><input name="rname" value="${esc(inv.recipient?.name)}" required></label>
      <label class="f"><span>Anschrift</span><textarea name="raddr" style="min-height:40px">${esc(inv.recipient?.address)}</textarea></label>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Einzelpreis brutto</th><th>USt</th><th>durchl.</th><th></th></tr></thead>
    <tbody id="lines">${inv.lines.map(lineRow).join("")}</tbody></table></div>
    <button type="button" class="btn sm" id="addLine" style="margin:8px 0 12px">+ Position</button>
    <label class="f inline"><input type="checkbox" name="ku" ${inv.kleinunternehmer ? "checked" : ""}> Kleinunternehmer (§ 19 UStG) – keine Umsatzsteuer ausweisen</label>
    <label class="f"><span>Hinweis auf der Rechnung</span><textarea name="note">${esc(inv.note || "")}</textarea></label>`;
  dialog({
    title: isNew ? "Neue Rechnung" : `Rechnung ${inv.number} bearbeiten`, body, wide: true,
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
      Object.assign(inv, {
        date: form.date.value, unitId: form.unitId.value, serviceFrom: form.serviceFrom.value, serviceTo: form.serviceTo.value,
        recipient: { name: form.rname.value.trim(), address: form.raddr.value.trim() }, lines, kleinunternehmer: form.ku.checked, note: form.note.value.trim(),
      });
      if (isNew) { inv.number = takeInvoiceNumber(inv.date); state.invoices.push(inv); }
      refreshInvoiceStatus(inv.id);
      S.save(state);
      location.hash = `#/rechnung/${inv.id}`;
      render();
    },
  });
}

function cancelInvoice(id) {
  const inv = byId("invoices", id);
  if (!confirm(`Rechnung ${inv.number} stornieren? Es wird eine Stornorechnung mit eigener Nummer erstellt.`)) return;
  const st = { ...structuredClone(inv), id: C.uid("i_"), number: takeInvoiceNumber(today()), date: today(), type: "storno", refNumber: inv.number, status: "storno",
    lines: inv.lines.map((l) => ({ ...l, price: -l.price })), note: `Storno zu Rechnung ${inv.number} vom ${d(inv.date)}.` };
  inv.status = "storniert";
  state.invoices.push(st);
  const b = byId("bookings", inv.bookingId);
  if (b) b.invoiceId = null;
  S.save(state);
  location.hash = `#/rechnung/${st.id}`;
}

function markPaid(id) {
  const inv = byId("invoices", id);
  const open = C.invoiceTotals(inv).gross - C.paidForInvoice(state, id);
  formDialog({
    title: `Zahlung zu ${inv.number} erfassen`, data: { date: today(), amount: open },
    spec: [{ k: "date", l: "Datum", t: "date", req: 1 }, { k: "amount", l: "Betrag", t: "money", req: 1 }, { k: "via", l: "Zahlweg", t: "select", opts: [["kasse", "Bar / Kasse"], ["bank", "Überweisung (ohne Kontoimport)"]] }],
    intro: `<div class="note">Tipp: Bei importierten Kontoumsätzen die Zahlung lieber unter „Bank“ zuordnen – dann ist sie automatisch verknüpft.</div>`,
    onSave: (v) => {
      state.payments.push({ id: C.uid("p_"), date: v.date, amount: v.amount, kind: "fewo", invoiceId: id, txId: v.via === "bank" ? "manuell" : null, note: inv.recipient?.name });
      refreshInvoiceStatus(id); commit("Zahlung erfasst");
    },
  });
}

async function smoobuImport() {
  try {
    toast("Hole Buchungen von Smoobu …");
    const res = await fetch("/.netlify/functions/smoobu-sync");
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Unbekannter Fehler");
    let added = 0, updated = 0, unknown = new Set();
    for (const sb of data.buchungen) {
      const unit = fewoUnits().find((u) => C.normalize(u.smoobuName || u.name) === C.normalize(sb.einheit_name));
      if (!unit) { unknown.add(sb.einheit_name); continue; }
      const existing = state.bookings.find((b) => b.smoobuId === sb.smoobu_id);
      const v = { unitId: unit.id, guest: sb.gast_name, from: sb.start_datum, to: sb.end_datum, adults: sb.personen, total: Math.round((sb.preis || 0) * 100), channel: sb.kanal, status: sb.status === "cancelled" ? "storniert" : "bestaetigt", smoobuId: sb.smoobu_id };
      if (existing) { Object.assign(existing, v); updated++; }
      else { state.bookings.push({ id: C.uid("b_"), children: 0, cleaning: 0, kurtaxe: state.settings.defaultKurtaxe || 0, note: "", ...v }); added++; }
    }
    commit(`Smoobu: ${added} neu, ${updated} aktualisiert${unknown.size ? ` · nicht zugeordnet: ${[...unknown].join(", ")} (Smoobu-Namen bei der Einheit eintragen)` : ""}`);
  } catch (e) {
    alert(`Smoobu-Import fehlgeschlagen: ${e.message}\n\nDer Import funktioniert, wenn die App über Netlify läuft und SMOOBU_API_KEY gesetzt ist.`);
  }
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

const NAV = [
  ["", "▦", "Übersicht"], ["objekte", "⌂", "Objekte & Einheiten"], ["mieter", "☺", "Mieter & Verträge"],
  ["mieten", "€", "Mieteingänge"], ["bank", "⇄", "Bank"], ["ausgaben", "✎", "Ausgaben"], ["dokumente", "📎", "Belege & Dokumente"], ["nebenkosten", "⚖", "Nebenkosten"], ["briefe", "✉", "Briefe"],
  ["ferien", "☀", "Ferienwohnung"], ["rechnungen", "▤", "Rechnungen"], ["steuer", "§", "Steuer & DATEV"], ["ki", "✨", "KI-Assistent"], ["einstellungen", "⚙", "Einstellungen"],
];

function head(title, sub, actions = "") {
  return `<div class="head"><div><h1>${esc(title)}</h1>${sub ? `<div class="muted">${sub}</div>` : ""}</div><div class="toolbar noprint">${actions}</div></div>`;
}
const btn = (act, label, cls = "", id = "") => `<button class="btn ${cls}" data-act="${act}" ${id !== "" ? `data-id="${esc(id)}"` : ""}>${label}</button>`;
const statusBadge = (diff, soll) => diff >= 0 ? (diff > 0 ? `<span class="badge">+${eur(diff)}</span>` : `<span class="badge ok">bezahlt</span>`) : (diff === -soll ? `<span class="badge bad">offen</span>` : `<span class="badge warn">teilweise</span>`);

function viewDashboard() {
  if (!state.objects.length) {
    return head("Willkommen bei HausOps Immobilien") + `<div class="card empty"><div class="big">🏠</div>
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
      <div class="card"><h2>Offene Rechnungen</h2>${openInv.length ? `<table>${openInv.map((i) => `<tr class="click" data-go="#/rechnung/${i.id}"><td>${esc(i.number)}</td><td>${esc(i.recipient?.name)}</td><td class="num">${eur(C.invoiceTotals(i).gross - C.paidForInvoice(state, i.id))}</td></tr>`).join("")}</table>` : '<p class="muted">Alle Rechnungen bezahlt.</p>'}</div>
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
          <div class="toolbar">${btn("editObject", "Bearbeiten", "sm", o.id)}${btn("newUnit", "+ Einheit", "sm", o.id)}</div></div>
        ${units.length ? `<div class="table-wrap"><table><thead><tr><th>Einheit</th><th>Art</th><th>Lage</th><th class="num">m²</th><th class="num">Zi.</th><th>Mieter / Status</th><th class="num">Miete warm</th></tr></thead><tbody>
          ${units.map((u) => {
            const c = activeContract(u.id, key);
            const status = u.type === "ferienwohnung" ? `<span class="badge">Ferienvermietung</span>` : c ? esc(tenantNames(c)) : `<span class="badge warn">frei</span> ${btn("newContract", "Vermieten", "sm link", u.id)}`;
            return `<tr class="click" data-act="editUnit" data-id="${u.id}"><td><b>${esc(u.name)}</b>${u.features ? `<div class="small muted">${esc(u.features.slice(0, 80))}</div>` : ""}</td><td>${esc(C.UNIT_TYPES[u.type])}</td><td>${esc(u.floor || "")}</td><td class="num">${u.area || ""}</td><td class="num">${u.rooms || ""}</td><td>${status}</td><td class="num">${c ? eur(C.rentForMonth(c, key).total) : ""}</td></tr>`;
          }).join("")}</tbody></table></div>` : '<p class="muted">Noch keine Einheiten.</p>'}
        ${o.notes ? `<div class="note small">${esc(o.notes)}</div>` : ""}
      </div>`;
    }).join("");
}

function viewTenants() {
  const key = C.monthKey(today());
  const contracts = [...state.contracts].sort((a, b) => unitLabel(byId("units", a.unitId)).localeCompare(unitLabel(byId("units", b.unitId))));
  return head("Mieter & Verträge", "", btn("newTenant", "+ Mieter", "primary") + btn("newContract", "+ Mietvertrag")) + `
    <div class="card"><h2>Mietverträge</h2>${contracts.length ? `<div class="table-wrap"><table><thead><tr><th>Einheit</th><th>Mieter</th><th>Laufzeit</th><th class="num">Kalt</th><th class="num">NK</th><th class="num">Zuschl.</th><th class="num">Warm</th><th class="num">Kaution</th><th></th></tr></thead><tbody>
      ${contracts.map((c) => { const r = C.rentForMonth(c, key); const active = C.contractActiveIn(c, key);
        return `<tr><td>${esc(unitLabel(byId("units", c.unitId)))}</td><td>${esc(tenantNames(c))}</td><td class="nowrap">${d(c.start)} – ${c.end ? d(c.end) : "unbefristet"} ${active ? "" : '<span class="badge grey">inaktiv</span>'}${(c.steps || []).length ? `<div class="small muted">${c.steps.length} Anpassung(en)</div>` : ""}</td>
        <td class="num">${eur(r.kalt)}</td><td class="num">${eur(r.nk)}</td><td class="num">${r.extra ? eur(r.extra) : ""}</td><td class="num"><b>${eur(r.total)}</b></td><td class="num">${c.kaution ? eur(c.kaution) : ""}</td>
        <td class="nowrap">${btn("editContract", "Bearbeiten", "sm", c.id)} ${btn("addStep", "Anpassung", "sm", c.id)}</td></tr>`; }).join("")}</tbody></table></div>` : '<p class="muted">Noch keine Mietverträge.</p>'}</div>
    <div class="card"><h2>Mieter</h2>${state.tenants.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Kontakt</th><th>IBAN</th><th>Einheit</th></tr></thead><tbody>
      ${state.tenants.map((t) => `<tr class="click" data-act="editTenant" data-id="${t.id}"><td><b>${esc(t.name)}</b></td><td class="small">${esc(t.email || "")}<br>${esc(t.phone || "")}</td><td class="small">${(t.ibans || []).map(esc).join("<br>")}</td>
        <td class="small">${state.contracts.filter((c) => c.tenantIds.includes(t.id)).map((c) => esc(unitLabel(byId("units", c.unitId)))).join("<br>")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">Noch keine Mieter.</p>'}</div>`;
}

function viewRents() {
  const key = ui.month;
  const rows = C.sollIst(state, key, key);
  const months = C.monthRange(`${ui.year}-01`, `${ui.year}-12`);
  const year = C.sollIst(state, months[0], months[11]);
  const cell = {};
  for (const r of year) cell[`${r.contractId}|${r.key}`] = r;
  const yContracts = state.contracts.filter((c) => months.some((m) => C.contractActiveIn(c, m)));
  return head("Mieteingänge", "Soll/Ist-Abgleich je Mietvertrag", `<input type="month" value="${key}" data-change="month" style="width:auto">` + btn("newPayment", "+ Zahlung manuell")) + `
    <div class="kpis">
      <div class="kpi"><div class="l">Soll ${C.fmtMonth(key)}</div><div class="v">${eur(sum(rows, (r) => r.soll))}</div></div>
      <div class="kpi"><div class="l">Ist</div><div class="v">${eur(sum(rows, (r) => r.ist))}</div></div>
      <div class="kpi"><div class="l">Differenz</div><div class="v ${sum(rows, (r) => r.diff) < 0 ? "neg" : "pos"}">${eur(sum(rows, (r) => r.diff))}</div></div>
    </div>
    <div class="card"><h2>${C.fmtMonth(key)}</h2>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Einheit · Mieter</th><th class="num">Soll</th><th class="num">Ist</th><th class="num">Differenz</th><th>Status</th><th>Zahlungen</th></tr></thead><tbody>
      ${rows.map((r) => { const ps = state.payments.filter((p) => p.kind === "miete" && p.contractId === r.contractId && p.period === key);
        return `<tr><td>${esc(contractLabel(byId("contracts", r.contractId)))}</td><td class="num">${eur(r.soll)}</td><td class="num">${eur(r.ist)}</td><td class="num ${r.diff < 0 ? "neg" : ""}">${eur(r.diff)}</td><td>${statusBadge(r.diff, r.soll)}</td>
        <td class="small">${ps.map((p) => `${d(p.date)} ${eur(p.amount)} ${p.txId ? "🏦" : `💶 <button class="btn sm link" data-act="editPayment" data-id="${p.id}">✎</button>`}`).join("<br>")}</td></tr>`; }).join("")}
      </tbody></table></div>` : '<p class="muted">Keine aktiven Mietverträge in diesem Monat.</p>'}</div>
    <div class="card"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">Jahresübersicht ${ui.year}</h2><div class="toolbar noprint">${btn("year", "‹", "sm", ui.year - 1)}${btn("year", "›", "sm", ui.year + 1)}</div></div>
      <div class="table-wrap"><table class="matrix"><thead><tr><th>Vertrag</th>${months.map((m) => `<th class="m">${C.MONTHS_DE[Number(m.slice(5)) - 1].slice(0, 3)}</th>`).join("")}<th class="num">Saldo</th></tr></thead><tbody>
      ${yContracts.map((c) => `<tr><td class="small">${esc(contractLabel(c))}</td>${months.map((m) => { const r = cell[`${c.id}|${m}`]; if (!r) return '<td class="m"></td>';
        const cls = r.diff === 0 ? "ok" : r.diff > 0 ? "over" : r.ist === 0 ? (m > C.monthKey(today()) ? "" : "no") : "part";
        return `<td class="m"><span class="dot ${cls}" title="Soll ${eur(r.soll)} · Ist ${eur(r.ist)}">${cls === "ok" ? "✓" : cls === "no" ? "✗" : cls === "part" ? "½" : cls === "over" ? "+" : "·"}</span></td>`; }).join("")}
        <td class="num ${sum(year.filter((r) => r.contractId === c.id && r.key <= C.monthKey(today())), (r) => r.diff) < 0 ? "neg" : ""}">${eur(sum(year.filter((r) => r.contractId === c.id && r.key <= C.monthKey(today())), (r) => r.diff))}</td></tr>`).join("")}
      </tbody></table></div><p class="small muted" style="margin-top:6px">✓ bezahlt · ½ teilweise · ✗ offen · + Überzahlung · Saldo bis heute</p></div>`;
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
  return head("Bank", "Kontoumsätze importieren, Mieten & Kosten automatisch zuordnen", btn("newAccount", "+ Bankkonto")) + `
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
  if (!units.length) return head("Ferienwohnung") + `<div class="card empty"><div class="big">☀️</div><p>Lege unter „Objekte & Einheiten“ eine Einheit vom Typ <b>Ferienwohnung</b> an, um Buchungen, Belegungskalender und Gäste-Rechnungen zu nutzen.</p><br>${btn("newUnit", "+ Einheit anlegen", "primary")}</div>`;
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
  return head("Ferienwohnung", "Belegung, Kennzahlen, Buchungen & Gäste-Rechnungen", `<input type="month" value="${key}" data-change="month" style="width:auto">` + btn("smoobu", "⟳ Smoobu-Import") + btn("newBooking", "+ Buchung", "primary")) + `
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

const invBadge = (i) => ({ offen: '<span class="badge warn">offen</span>', teilbezahlt: '<span class="badge warn">teilbezahlt</span>', bezahlt: '<span class="badge ok">bezahlt</span>', storniert: '<span class="badge grey">storniert</span>', storno: '<span class="badge grey">Storno</span>' }[i.status] || "");

function viewInvoices() {
  const list = [...state.invoices].sort((a, b) => (a.number < b.number ? 1 : -1));
  return head("Rechnungen", "Gäste-Rechnungen mit fortlaufender Nummer, 7 % USt und Kurtaxe", btn("newInvoice", "+ Rechnung", "primary")) + `
    <div class="card">${list.length ? `<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Datum</th><th>Empfänger</th><th>Zeitraum</th><th class="num">Betrag</th><th class="num">Bezahlt</th><th>Status</th></tr></thead><tbody>
      ${list.map((i) => `<tr class="click" data-go="#/rechnung/${i.id}"><td><b>${esc(i.number)}</b></td><td>${d(i.date)}</td><td>${esc(i.recipient?.name)}</td><td class="small nowrap">${i.serviceFrom ? `${d(i.serviceFrom)} – ${d(i.serviceTo)}` : ""}</td><td class="num">${eur(C.invoiceTotals(i).gross)}</td><td class="num">${eur(C.paidForInvoice(state, i.id))}</td><td>${invBadge(i)}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="muted">Noch keine Rechnungen. Am schnellsten: unter „Ferienwohnung“ bei einer Buchung „Rechnung erstellen“.</p>'}</div>`;
}

function viewInvoice(id) {
  const inv = byId("invoices", id);
  if (!inv) return head("Rechnung nicht gefunden");
  const s = state.settings, t = C.invoiceTotals(inv);
  const unit = byId("units", inv.unitId), obj = byId("objects", unit?.objectId);
  const due = addDays(inv.date, Number(s.paymentTermDays) || 14);
  const sender = [s.ownerName, s.ownerStreet, [s.ownerZip, s.ownerCity].filter(Boolean).join(" ")].filter(Boolean);
  const missing = [!s.ownerName && "Name", !s.ownerStreet && "Anschrift", !s.taxNumber && !s.vatId && "Steuernummer/USt-IdNr."].filter(Boolean);
  return `<div class="head noprint"><div><a href="#/rechnungen">← Rechnungen</a></div><div class="toolbar">
      ${inv.type !== "storno" && inv.status !== "storniert" ? btn("editInvoice", "Bearbeiten", "", inv.id) + (inv.status !== "bezahlt" ? btn("markPaid", "Zahlung erfassen", "", inv.id) : "") + btn("cancelInvoice", "Stornieren", "danger", inv.id) : ""}
      <button class="btn primary" onclick="window.print()">Drucken / PDF</button></div></div>
    ${missing.length ? `<div class="note warn noprint">Pflichtangaben fehlen: ${missing.join(", ")} – bitte unter <a href="#/einstellungen">Einstellungen</a> ergänzen.</div>` : ""}
    <div class="paper">
      <div class="top"><div><div class="sender">${esc(sender.join(" · "))}</div>
        <div><b>${esc(inv.recipient?.name)}</b><br>${esc(inv.recipient?.address || "").replace(/\n/g, "<br>")}</div></div>
        <div><b>${esc(s.ownerName)}</b><br>${sender.slice(1).map(esc).join("<br>")}${s.ownerPhone ? `<br>Tel. ${esc(s.ownerPhone)}` : ""}${s.ownerEmail ? `<br>${esc(s.ownerEmail)}` : ""}
          <table class="meta" style="margin-top:12px"><tr><td class="muted">Rechnungsnr.</td><td><b>${esc(inv.number)}</b></td></tr><tr><td class="muted">Datum</td><td>${d(inv.date)}</td></tr>
          ${inv.serviceFrom ? `<tr><td class="muted">Leistungszeitraum</td><td>${d(inv.serviceFrom)} – ${d(inv.serviceTo)}</td></tr>` : ""}
          ${s.taxNumber ? `<tr><td class="muted">Steuernummer</td><td>${esc(s.taxNumber)}</td></tr>` : ""}${s.vatId ? `<tr><td class="muted">USt-IdNr.</td><td>${esc(s.vatId)}</td></tr>` : ""}</table></div></div>
      <h1>${inv.type === "storno" ? "Stornorechnung" : "Rechnung"} ${esc(inv.number)}</h1>
      ${unit ? `<p style="margin-bottom:12px">Unterkunft: ${esc(unit.name)}${obj ? `, ${esc([obj.street, [obj.zip, obj.city].filter(Boolean).join(" ")].filter(Boolean).join(", "))}` : ""}${unit.registrationNo ? ` · Registrierungsnr. ${esc(unit.registrationNo)}` : ""}</p>` : ""}
      <table class="lines"><thead><tr><th>Pos.</th><th>Beschreibung</th><th class="num">Menge</th><th class="num">Einzelpreis</th>${inv.kleinunternehmer ? "" : '<th class="num">USt</th>'}<th class="num">Gesamt</th></tr></thead><tbody>
        ${inv.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.desc)}${l.passThrough ? '<div class="small muted">durchlaufender Posten, nicht umsatzsteuerbar</div>' : ""}</td><td class="num">${String(l.qty).replace(".", ",")}</td><td class="num">${eur(l.price)}</td>${inv.kleinunternehmer ? "" : `<td class="num">${l.passThrough ? "–" : l.vat + " %"}</td>`}<td class="num">${eur(Math.round(l.qty * l.price))}</td></tr>`).join("")}
      </tbody></table>
      <table class="totals">
        ${inv.kleinunternehmer ? "" : t.taxes.map((x) => `<tr><td>Nettobetrag ${x.rate} %</td><td class="num">${eur(x.net)}</td></tr><tr><td>zzgl. ${x.rate} % USt</td><td class="num">${eur(x.vat)}</td></tr>`).join("")}
        ${t.passThrough ? `<tr><td>Durchlaufende Posten</td><td class="num">${eur(t.passThrough)}</td></tr>` : ""}
        <tr class="sum"><td>Gesamtbetrag</td><td class="num">${eur(t.gross)}</td></tr>
        ${C.paidForInvoice(state, inv.id) && inv.type !== "storno" ? `<tr><td>bereits bezahlt</td><td class="num">${eur(C.paidForInvoice(state, inv.id))}</td></tr><tr><td><b>Offen</b></td><td class="num"><b>${eur(t.gross - C.paidForInvoice(state, inv.id))}</b></td></tr>` : ""}
      </table>
      <div style="margin-top:24px">
        ${inv.kleinunternehmer ? "<p>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>" : ""}
        ${inv.note ? `<p>${esc(inv.note).replace(/\n/g, "<br>")}</p>` : ""}
        ${inv.type !== "storno" && inv.status !== "bezahlt" ? `<p>Bitte überweisen Sie den Betrag bis zum ${d(due)} unter Angabe der Rechnungsnummer${s.invoiceIban ? ` auf das unten genannte Konto` : ""}.</p>` : inv.status === "bezahlt" ? "<p>Der Betrag wurde bereits beglichen.</p>" : ""}
        ${s.invoiceFooter ? `<p style="margin-top:10px">${esc(s.invoiceFooter)}</p>` : ""}
      </div>
      <div class="foot"><div>${sender.map(esc).join("<br>")}</div><div>${s.ownerEmail ? esc(s.ownerEmail) + "<br>" : ""}${s.ownerPhone ? esc(s.ownerPhone) + "<br>" : ""}${s.taxNumber ? "St.-Nr. " + esc(s.taxNumber) : ""}${s.vatId ? "<br>USt-IdNr. " + esc(s.vatId) : ""}</div>
        <div>${s.invoiceBank ? esc(s.invoiceBank) + "<br>" : ""}${s.invoiceIban ? "IBAN " + esc(s.invoiceIban) : ""}${s.invoiceBic ? "<br>BIC " + esc(s.invoiceBic) : ""}</div></div>
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
    <div class="card noprint"><h2>DATEV-Export & Steuerberater-Paket</h2>
      <div class="inline" style="margin-bottom:10px">
        <label class="small">von <input type="date" value="${from}" data-change="datevFrom"></label>
        <label class="small">bis <input type="date" value="${to}" data-change="datevTo"></label>
        ${btn("datevPreset", "Monat", "sm", "m")}${btn("datevPreset", "Quartal", "sm", "q")}${btn("datevPreset", "Jahr " + y, "sm", "y")}
      </div>
      ${!s.datevBerater || !s.datevMandant ? `<div class="note warn">Berater- und Mandantennummer fehlen – bitte unter <a href="#/einstellungen">Einstellungen</a> eintragen (bekommst du vom Steuerberater).</div>` : ""}
      ${openTx ? `<div class="note warn">${openTx} Bankumsätze im Zeitraum sind noch nicht zugeordnet und fehlen im Export. <a href="#/bank">Jetzt zuordnen →</a></div>` : ""}
      <div class="toolbar">${btn("datev", "⬇ DATEV-Buchungsstapel (EXTF)", "primary")}${btn("journal", "⬇ Buchungsliste (Excel)")}<a class="btn" href="#/bericht/${from}_${to}">🖨 Bericht drucken</a><a class="btn" href="#/paket/${y}">📦 Jahrespaket ${y} für Steuerberater</a></div>
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
  const payLabel = (p) => p.kind === "miete" ? `Miete ${C.fmtMonth(p.period)} · ${contractLabel(byId("contracts", p.contractId))}` : p.kind === "fewo" ? `Rechnung ${byId("invoices", p.invoiceId)?.number || ""} · ${byId("invoices", p.invoiceId)?.recipient?.name || ""}` : `${C.INCOME_KINDS[p.kind]} ${p.note || ""}`;
  return `<div class="head noprint"><a href="#/steuer">← Steuer & DATEV</a><button class="btn primary" onclick="window.print()">Drucken / PDF</button></div>
    <div class="card"><h1>Immobilien-Bericht ${d(from)} – ${d(to)}</h1><p class="muted">${esc(s.ownerName)} · erstellt am ${d(today())}${s.datevMandant ? ` · Mandant ${esc(s.datevMandant)}` : ""}</p>
      <div class="kpis" style="margin-top:12px"><div class="kpi"><div class="l">Einnahmen</div><div class="v">${eur(sum(pays.filter((p) => p.kind !== "kaution"), (p) => p.amount))}</div></div>
        <div class="kpi"><div class="l">Ausgaben</div><div class="v">${eur(sum(exps, (e) => e.amount))}</div></div>
        <div class="kpi"><div class="l">Mietrückstand im Zeitraum</div><div class="v">${eur(-sum(si.filter((r) => r.diff < 0), (r) => r.diff))}</div></div></div>
      <h3>Einnahmen</h3><table><thead><tr><th>Datum</th><th>Vorgang</th><th>Weg</th><th class="num">Betrag</th></tr></thead><tbody>${pays.map((p) => `<tr><td>${d(p.date)}</td><td>${esc(payLabel(p))}</td><td>${p.txId ? "Bank" : "Kasse"}</td><td class="num">${eur(p.amount)}</td></tr>`).join("")}</tbody></table>
      <h3>Ausgaben</h3><table><thead><tr><th>Datum</th><th>Empfänger</th><th>Kategorie</th><th>Objekt</th><th>Beleg</th><th class="num">Betrag</th></tr></thead><tbody>${exps.map((e) => `<tr><td>${d(e.date)}</td><td>${esc(e.vendor)}</td><td>${esc(C.EXPENSE_CATEGORIES[e.category]?.label)}</td><td>${esc(byId("objects", e.objectId)?.name || "")}</td><td>${esc(e.belegNr || "")}</td><td class="num">${eur(e.amount)}</td></tr>`).join("")}</tbody></table>
      ${invs.length ? `<h3>Ausgestellte Rechnungen</h3><table><thead><tr><th>Nr.</th><th>Datum</th><th>Empfänger</th><th class="num">Netto</th><th class="num">USt</th><th class="num">Brutto</th><th>Status</th></tr></thead><tbody>${invs.map((i) => { const t = C.invoiceTotals(i); return `<tr><td>${esc(i.number)}</td><td>${d(i.date)}</td><td>${esc(i.recipient?.name)}</td><td class="num">${eur(t.net)}</td><td class="num">${eur(t.vat)}</td><td class="num">${eur(t.gross)}</td><td>${esc(i.status)}</td></tr>`; }).join("")}</tbody></table>` : ""}
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

function viewNk() {
  if (!state.objects.length) return head("Nebenkostenabrechnung") + `<div class="card empty">Bitte zuerst ein Objekt mit Einheiten und Mietverträgen anlegen.</div>`;
  const nk = nkDraft();
  const units = state.units.filter((u) => u.objectId === nk.objectId && C.NK_UNIT_TYPES(u));
  const r = C.nkAbrechnung(state, nk);
  const saved = (state.nkStatements || []).filter((x) => x.objectId === nk.objectId).sort((a, b) => (a.to < b.to ? 1 : -1));
  const late = today() > r.deadline;
  const nonUml = state.expenses.filter((e) => e.objectId === nk.objectId && e.date >= nk.from && e.date <= nk.to && !C.EXPENSE_CATEGORIES[e.category]?.umlage && C.EXPENSE_CATEGORIES[e.category]?.av);
  const needsShares = (it) => ["verbrauch", "heizkosten", "direkt"].includes(it.key);
  const itemRow = (it, i) => `<tr>
    <td><input list="betrkv" value="${esc(it.label)}" data-nk="label" data-i="${i}"></td>
    <td style="width:130px"><input inputmode="decimal" value="${it.key === "direkt" ? "" : esc(C.fmtNum(it.amount))}" data-nk="amount" data-i="${i}" ${it.key === "direkt" ? 'disabled placeholder="je Einheit"' : ""}></td>
    <td style="width:230px"><select data-nk="key" data-i="${i}">${opt(Object.entries(C.NK_KEYS), it.key)}</select>
      ${it.key === "heizkosten" ? `<div class="inline small" style="margin-top:4px">Verbrauchsanteil <input type="number" min="50" max="70" value="${esc(it.pct ?? 70)}" data-nk="pct" data-i="${i}" style="width:70px"> %</div>` : ""}</td>
    <td class="nowrap">${(it.expenseIds || []).flatMap((eid) => byId("expenses", eid)?.fileIds || []).length ? `<span title="Belege vorhanden">📎${(it.expenseIds || []).flatMap((eid) => byId("expenses", eid)?.fileIds || []).length}</span>` : (it.expenseIds || []).length ? '<span class="muted small" title="Ausgabe ohne Beleg – unter Ausgaben anhängen">kein Beleg</span>' : ""} <button class="btn sm link" data-act="nkDel" data-id="${i}">✕</button></td></tr>
    ${needsShares(it) ? `<tr><td colspan="4" style="background:#fafbfa"><div class="small muted" style="margin-bottom:4px">${it.key === "direkt" ? "Betrag je Einheit (€)" : "Verbrauch je Einheit (Zählerdifferenz, z. B. m³ / kWh / Einheiten Heizkostenverteiler)"}</div><div class="inline">
      ${units.map((u) => `<label class="small">${esc(u.name)} <input style="width:100px" inputmode="decimal" value="${esc(it.key === "direkt" ? C.fmtNum(it.shares?.[u.id] || 0) : (it.shares?.[u.id] ?? ""))}" data-nk="share" data-i="${i}" data-u="${u.id}"></label>`).join("")}</div></td></tr>` : ""}`;
  return head("Nebenkostenabrechnung", "Betriebskosten nach BetrKV – tagegenau, mit Leerstandsanteil des Vermieters", "") + `
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
      ${st.items.map((it, i) => { const tot = it.key === "direkt" ? sum(units, (x) => Number(it.shares?.[x.id]) || 0) : it.amount;
        return `<tr><td>${esc(it.label)}</td><td class="small">${esc(C.NK_KEYS[it.key])}${it.key === "heizkosten" ? ` (${it.pct ?? 70} % Verbrauch)` : ""}${["verbrauch", "heizkosten"].includes(it.key) && it.shares?.[u.id] ? `<br>Ihr Verbrauch: ${esc(it.shares[u.id])} von ${sum(units, (x) => Number(it.shares?.[x.id]) || 0)}` : ""}</td><td class="num">${eur(tot)}</td><td class="num">${eur(c.items[i].amount)}</td></tr>`; }).join("")}
    </tbody></table>
    <table class="totals">
      <tr><td>Ihr Kostenanteil</td><td class="num">${eur(c.total)}</td></tr>
      <tr><td>abzüglich geleistete Vorauszahlungen</td><td class="num">− ${eur(c.prepaid)}</td></tr>
      <tr class="sum"><td>${c.saldo > 0 ? "Nachzahlung" : "Guthaben"}</td><td class="num" style="color:${c.saldo > 0 ? "var(--bad)" : "var(--ok)"}">${eur(Math.abs(c.saldo))}</td></tr>
    </table>
    <div style="margin-top:20px">
      ${c.saldo > 0 ? `<p>Bitte überweisen Sie die Nachzahlung bis zum <b>${d(due)}</b> auf das Konto ${s.invoiceIban ? `IBAN ${esc(s.invoiceIban)}${s.invoiceBank ? ` (${esc(s.invoiceBank)})` : ""}` : "[IBAN]"}, Verwendungszweck „NK ${st.to.slice(0, 4)} ${esc(u?.name || "")}“.</p>` : c.saldo < 0 ? `<p>Das Guthaben überweisen wir Ihnen in den nächsten Tagen bzw. verrechnen es nach Absprache mit der nächsten Miete.</p>` : ""}
      ${c.newMonthly !== C.rentForMonth(contract, C.monthKey(today())).nk ? `<p>Damit es im nächsten Jahr keine größere ${c.saldo > 0 ? "Nachzahlung" : "Abweichung"} gibt, passen wir die monatliche Vorauszahlung ab dem übernächsten Monat auf <b>${eur(c.newMonthly)}</b> an (§ 560 Abs. 4 BGB).</p>` : ""}
      <p>Die Belege können Sie nach vorheriger Terminabsprache gern einsehen. Bei Fragen melden Sie sich jederzeit.</p>
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
    <p class="small muted" style="margin-top:12px">Zusammenstellung aus HausOps Immobilien. Einordnungen sind Vorschläge – die Entscheidung trifft der Steuerberater. DATEV-Buchungsstapel liegt separat bei.</p>`)}
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
    <div class="card"><h2>✨ KI-Assistent (Claude)</h2>
      <p class="small muted" style="margin-bottom:8px">Für Belegerkennung, Fragen an deine Daten und Briefentwürfe. Schlüssel unter console.anthropic.com → API Keys erstellen; Kosten nach Nutzung (meist wenige Cent pro Anfrage). Der Schlüssel wird nur auf diesem Gerät gespeichert und ist nicht Teil der Datensicherung. Beim Nutzen der KI werden die betroffenen Daten an Anthropic übertragen.</p>
      <div class="inline"><input type="password" placeholder="sk-ant-…" value="${K.hasKey() ? "••••••••••••" : ""}" data-change="kiKey" style="max-width:340px" autocomplete="off"> ${K.hasKey() ? '<span class="badge ok">aktiv</span>' : '<span class="badge grey">nicht eingerichtet</span>'}</div></div>
    <div class="card"><h2>Datensicherung</h2>
      <p class="muted" style="margin-bottom:10px">Alle Daten liegen nur in diesem Browser. Sichere sie regelmäßig als Datei (z. B. in iCloud/Google Drive) – damit kannst du sie auch auf ein anderes Gerät übertragen.</p>
      <div class="toolbar">${btn("backup", "⬇ Sicherung herunterladen", "primary")}${btn("backupFull", "⬇ Sicherung inkl. Belege")}<label class="btn">⬆ Sicherung einspielen<input type="file" accept=".json" data-change="restore" hidden></label>${btn("loadDemo", "Demo-Daten laden")}${btn("reset", "Alle Daten löschen", "danger")}</div></div>`;
}

// ---------------------------------------------------------------- Belege & Dokumente

const DOC_KINDS = { beleg: "Rechnung / Beleg", bescheid: "Bescheid (Grundsteuer, Abgaben)", abrechnung: "Versorger-/Jahresabrechnung", vertrag: "Mietvertrag / Vertrag", protokoll: "Übergabeprotokoll", zaehler: "Zählerstand / Foto", korrespondenz: "Schriftverkehr", sonstiges: "Sonstiges" };
const KI_DOC_KIND = { rechnung: "beleg", bescheid: "bescheid", abrechnung: "abrechnung", vertrag: "vertrag", zaehlerstand: "zaehler", kontoauszug: "sonstiges", sonstiges: "sonstiges" };

async function addFiles(fileList, { scan = false, expenseId = null } = {}) {
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
      await F.putFile(id, blob);
      const doc = { id, name: file.name || `Scan ${d(today())}`, type, size: blob.size, thumb, created: new Date().toISOString(), kind: "beleg", objectId: "", contractId: "", expenseId, status: expenseId ? "verarbeitet" : "neu", note: "", ki: null };
      state.documents.push(doc);
      if (expenseId) { const e = byId("expenses", expenseId); if (e) e.fileIds = [...(e.fileIds || []), id]; }
      added.push(doc);
    } catch (err) { alert(`${file.name}: ${err.message}`); }
  }
  commit(`${added.length} Datei(en) gespeichert`);
  if (!expenseId && ui.autoKi && K.hasKey()) for (const doc of added) await kiReadDoc(doc.id);
  return added;
}

async function openDoc(id) {
  const blob = await F.getFile(id);
  if (!blob) return toast("Datei nicht gefunden (anderes Gerät?)");
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Lädt Bilder aus IndexedDB in <img data-doc="…"> (Druckansichten)
async function hydrateDocImages() {
  for (const img of document.querySelectorAll("img[data-doc]")) {
    const blob = await F.getFile(img.dataset.doc).catch(() => null);
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

async function kiReadDoc(id) {
  const doc = byId("documents", id);
  if (!K.hasKey()) { toast("Für die KI-Erkennung zuerst unter Einstellungen den API-Schlüssel eintragen."); location.hash = "#/einstellungen"; return; }
  const blob = await F.getFile(id);
  if (!blob) return toast("Datei nicht gefunden");
  ui.kiBusy = { ...(ui.kiBusy || {}), [id]: true }; render();
  try {
    const r = await K.readReceipt({ base64: await F.blobToBase64(blob), mediaType: doc.type, objects: state.objects.map((o) => `${o.name} (${o.street}, ${o.city})`) });
    doc.ki = r;
    doc.kind = KI_DOC_KIND[r.doc_type] || doc.kind;
    doc.objectId = doc.objectId || guessObject(r.object_hint);
    if (r.vendor) doc.name = `${r.vendor}${r.date ? " " + d(r.date) : ""}`;
    S.save(state);
    toast(`Ausgelesen: ${r.vendor} · ${eur(Math.round(r.amount * 100))} (Sicherheit ${r.confidence})`);
  } catch (e) {
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
  const spec = [{ k: "linkTo", l: "Buchung", t: "select", opts: linkOpts, full: 1 }, ...SPEC.expense];
  formDialog({
    title: "Beleg als Ausgabe buchen", spec, wide: true,
    data: { linkTo: linkOpts[1]?.[0] || "neu", date, amount, category: k.category || "sonstiges", betrkv: k.betrkv && k.betrkv !== "keine" ? k.betrkv : "", objectId: doc.objectId || guessObject(k.object_hint), vendor: k.vendor || "", belegNr: k.invoice_number || "", note: [k.summary, k.consumption && `Verbrauch: ${k.consumption}`, k.period_from && `Zeitraum ${d(k.period_from)}–${d(k.period_to)}`].filter(Boolean).join("\n") },
    intro: `<div class="inline" style="align-items:flex-start;margin-bottom:10px">${doc.thumb ? `<img src="${doc.thumb}" style="width:90px;border-radius:6px;border:1px solid var(--line)">` : '<span class="big">📄</span>'}
      <div class="small">${doc.ki ? `KI-Vorschlag (Sicherheit: <b>${esc(k.confidence)}</b>) – bitte prüfen.${k.umlagefaehig ? ' <span class="badge ok">umlagefähig</span>' : ' <span class="badge grey">nicht umlagefähig</span>'}` : "Bitte Daten vom Beleg eintragen."}
      ${txC.length || expC.length ? `<br><b>Tipp:</b> Es gibt einen passenden Bankumsatz/eine Ausgabe – verknüpfen statt doppelt buchen.` : ""}</div></div>`,
    onSave: (v) => {
      const { linkTo, ...vals } = v;
      let e;
      if (linkTo.startsWith("e:")) { e = byId("expenses", linkTo.slice(2)); Object.assign(e, { betrkv: vals.betrkv || e.betrkv, belegNr: vals.belegNr || e.belegNr, objectId: vals.objectId || e.objectId, category: vals.category }); }
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
      { k: "objectId", l: "Objekt", t: "select", opts: () => objectOpts() },
      { k: "contractId", l: "Mietvertrag / Mieter", t: "select", opts: () => [["", "–"], ...contractOpts()], full: 1 },
      { k: "status", l: "Status", t: "select", opts: [["neu", "Eingang (unbearbeitet)"], ["verarbeitet", "erledigt / abgelegt"]] },
      { k: "note", l: "Notiz", t: "textarea" },
    ],
    onSave: (v) => { Object.assign(doc, v); commit("Gespeichert"); },
    onDelete: async () => {
      for (const e of state.expenses) if ((e.fileIds || []).includes(id)) e.fileIds = e.fileIds.filter((x) => x !== id);
      state.documents = state.documents.filter((x) => x.id !== id);
      await F.deleteFile(id).catch(() => {});
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
    offene_rechnungen: state.invoices.filter((i) => ["offen", "teilbezahlt"].includes(i.status)).map((i) => ({ nr: i.number, an: i.recipient?.name, betrag: eur(C.invoiceTotals(i).gross), bezahlt: eur(C.paidForInvoice(state, i.id)) })),
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
  try { entry.a = await K.ask({ question: q, history, context: buildContext() }); }
  catch (e) { entry.a = "⚠️ " + K.friendlyError(e); entry.err = true; }
  ui.kiAsking = false; render();
  window.scrollTo(0, document.body.scrollHeight);
}

// ---------------------------------------------------------------- Routing & Events

function render() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [route, arg] = hash.split("/");
  $("#nav").innerHTML = NAV.map(([r, ic, l]) => `<a href="#/${r}" class="${route === r || (r === "rechnungen" && route === "rechnung") || (r === "steuer" && ["bericht", "paket"].includes(route)) || (r === "nebenkosten" && route === "nkbrief") || (r === "briefe" && route === "brief") ? "active" : ""}"><span class="ic">${ic}</span>${l}</a>`).join("");
  const views = { "": viewDashboard, objekte: viewObjects, mieter: viewTenants, mieten: viewRents, bank: viewBank, ausgaben: viewExpenses, ferien: viewFewo, rechnungen: viewInvoices, rechnung: () => viewInvoice(arg), steuer: viewTax, bericht: () => viewReport(arg), einstellungen: viewSettings, nebenkosten: viewNk, nkbrief: () => viewNkLetter(arg, hash.split("/")[2]), paket: () => viewPackage(arg), dokumente: viewDocs, briefe: viewLetters, brief: () => viewLetter(arg), ki: viewKi };
  try {
    $("#view").innerHTML = (views[route] || viewDashboard)();
    if (document.querySelector("img[data-doc]")) hydrateDocImages();
  } catch (e) {
    console.error(e);
    $("#view").innerHTML = `<div class="card"><h2>Fehler in dieser Ansicht</h2><pre class="small">${esc(e.stack || e)}</pre></div>`;
  }
}

const actions = {
  newObject: () => editObject(), editObject,
  openDoc, editDoc, bookDoc, kiDoc: (id) => kiReadDoc(id),
  docFilter: (f) => { ui.docFilter = f; render(); },
  letterReset: () => { ui.letter.body = ""; render(); },
  letterKi: async () => {
    const L = ui.letter; if (!K.hasKey()) return toast("Bitte zuerst den KI-Schlüssel in den Einstellungen eintragen.");
    ui.letterBusy = true; render();
    try { const r = await K.draftLetter({ kind: LETTERS[L.kind][0], instructions: L.instr, facts: letterFacts(L.contractId), current: `${L.subject}\n\n${L.body}` }); L.subject = r.subject; L.body = r.body; }
    catch (e) { alert(K.friendlyError(e)); }
    ui.letterBusy = false; render();
  },
  letterSave: () => { const L = ui.letter; const l = { id: C.uid("l_"), date: today(), contractId: L.contractId, kind: L.kind, subject: L.subject, body: L.body }; state.letters.push(l); S.save(state); location.hash = `#/brief/${l.id}`; },
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
  newTenant: () => editTenant(), editTenant, newContract: (unitId) => editContract(null, unitId), editContract, addStep,
  newPayment: () => editPayment(), editPayment, newExpense: () => editExpense(), editExpense,
  newAccount: () => editAccount(), editAccount,
  assign: assignDialog,
  accept: (id) => { const tx = byId("transactions", id); applyAssignment(tx, C.suggestAssignment(tx, state), false); commit("Zugeordnet"); },
  acceptAll: () => { let n = 0; for (const tx of state.transactions.filter((t) => !t.link)) { const s = C.suggestAssignment(tx, state); if (s && s.score >= 60) { applyAssignment(tx, s, false); n++; } } commit(`${n} Umsätze zugeordnet`); },
  unlink: (id) => unlink(byId("transactions", id)),
  bankFilter: (f) => { ui.bankFilter = f; render(); },
  year: (y) => { ui.year = Number(y); ui.datevFrom = ui.datevTo = null; render(); },
  newBooking: () => editBooking(), editBooking,
  newBookingAt: (v) => { const [unitId, from] = v.split("|"); editBooking(null, { unitId, from, to: addDays(from, 7) }); },
  invoiceFromBooking, guestMsg, cleaningMsg,
  pkgYear: (y) => { location.hash = `#/paket/${y}`; },
  nkAdd: () => { nkDraft().items.push({ label: "Grundsteuer", amount: 0, key: "flaeche", pct: 70, shares: {} }); render(); },
  nkDel: (i) => { nkDraft().items.splice(Number(i), 1); render(); },
  nkFromExpenses: () => { const nk = nkDraft(); const add = C.nkItemsFromExpenses(state, nk.objectId, nk.from, nk.to); if (!add.length) return toast("Keine umlagefähigen Ausgaben im Zeitraum gefunden."); nk.items = [...nk.items.filter((x) => !add.some((a) => a.label === x.label)), ...add]; render(); },
  nkSave: () => { const nk = nkDraft(); if (!nk.items.length) return toast("Keine Kostenpositionen."); nk.id = nk.id || C.uid("nk_"); state.nkStatements = [...(state.nkStatements || []).filter((x) => x.id !== nk.id), structuredClone(nk)]; commit("Abrechnung gespeichert – Anschreiben können jetzt gedruckt werden"); },
  nkLoad: (id) => { ui.nk = structuredClone(state.nkStatements.find((x) => x.id === id)); render(); },
  newInvoice: () => editInvoice(), editInvoice, cancelInvoice, markPaid, smoobu: smoobuImport,
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
    const files = await F.allFiles(); const out = {};
    for (const [id, blob] of Object.entries(files)) out[id] = { type: blob.type, data: await F.blobToBase64(blob) };
    download(`hausops-immobilien-sicherung-mit-belegen-${today()}.json`, JSON.stringify({ ...state, _files: out }), "application/json");
  },
  backup: () => download(`hausops-immobilien-sicherung-${today()}.json`, JSON.stringify(state, null, 1), "application/json"),
  loadDemo: () => { if (state.objects.length && !confirm("Vorhandene Daten werden durch Demo-Daten ersetzt. Fortfahren?")) return; state = S.demoState(); commit("Demo-Daten geladen – probiere „Bank“ → Vorschläge übernehmen"); },
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

document.addEventListener("click", (e) => {
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
    else if (nkf === "share") { it.shares = it.shares || {}; it.shares[e.target.dataset.u] = it.key === "direkt" ? C.parseAmount(v) : Number(String(v).replace(",", ".")) || 0; }
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
        for (const [id, f] of Object.entries(files)) await F.putFile(id, await F.base64ToBlob(f.data, f.type));
        state = next; commit("Sicherung eingespielt");
      }
    } catch (err) { alert(err.message); }
  }
});

document.addEventListener("input", (e) => {
  const lf = e.target.dataset?.letter;
  if (lf && ["subject", "body", "instr"].includes(lf)) ui.letter[lf] = e.target.value;
});

// Drag & Drop von Dateien auf die Belege-Seite
document.addEventListener("dragover", (e) => { if (e.target.closest?.("[data-drop]")) { e.preventDefault(); e.target.closest("[data-drop]").classList.add("over"); } });
document.addEventListener("dragleave", (e) => { e.target.closest?.("[data-drop]")?.classList.remove("over"); });
document.addEventListener("drop", (e) => { const z = e.target.closest?.("[data-drop]"); if (z) { e.preventDefault(); z.classList.remove("over"); addFiles(e.dataTransfer.files); } });

document.addEventListener("submit", (e) => {
  const f = e.target.dataset?.form;
  if (!f) return;
  e.preventDefault();
  if (f === "ki") { kiAsk(e.target.q.value); return; }
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
    Object.assign(s, { skr: fd.skr, datevBerater: fd.datevBerater.trim(), datevMandant: fd.datevMandant.trim(), datevKontenlaenge: Number(fd.datevKontenlaenge) || 4, autoAssignScore: Number(fd.autoAssignScore) || 80, sollStart: fd.sollStart || "" });
  }
  commit("Einstellungen gespeichert");
});

window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
render();
