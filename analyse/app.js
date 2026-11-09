// Immo-Analyse Hamm – regelbasiert, ohne KI und ohne laufende Kosten.
import { rechneSzenario, maxKaufpreisCashflowNull, num } from "./rechner.js";
import { speicher, geraet, ZugangFalsch, extras, lese, schreibe } from "./speicher.js";
import { leseInserat } from "./lib/inserat-parse.js";
import { auswerten, STANDARD_ANNAHMEN } from "./lib/auswertung.js";

const SZENARIEN = [["vorsichtig", "Vorsichtig"], ["realistisch", "Realistisch"], ["gut", "Gut"]];
const $ = (id) => document.getElementById(id);
const eur = (v) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €");
const pct = (v) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " %");
const dez = (v, d = 1) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("de-DE", { maximumFractionDigits: d }));

let aktuell = null; // { id, datum, titel, link, bericht, daten, finanz, eingabe, autor, chat }

function hinweis(text, art = "info") { if (text && window.zeigeHinweis) window.zeigeHinweis(text, art); }
function fehler(text) {
  if (text) hinweis(text, "fehler");
  $("fehler").textContent = text || "";
  $("fehler").classList.toggle("versteckt", !text);
}

// ---------- Anmeldung ----------
function zeigeStatus() {
  const gemeinsam = speicher.modus === "gemeinsam";
  $("verbunden").textContent = gemeinsam ? `${geraet.name || "?"} · verbunden` : "nicht angemeldet";
  $("abmelden").classList.toggle("versteckt", !gemeinsam);
}

async function verbinden() {
  try {
    const d = await speicher.start();
    if (speicher.modus === "gemeinsam") {
      const n = await speicher.lokaleHochladen();
      zeigeVerlauf(n ? await speicher.liste() : d.objekte);
    } else {
      zeigeVerlauf(d.objekte);
    }
  } catch (e) {
    if (e instanceof ZugangFalsch) {
      geraet.zugang = "";
      $("login-fehler").textContent = "Zugangscode falsch – bitte prüfen.";
      return verbinden();
    }
    $("login-fehler").textContent = e.message;
  }
  zeigeStatus();
  ladeFunde();
  ladeMerkliste();
  pushStatus();
  route();
}

$("anmelden").onclick = async () => {
  const code = $("zugang").value.trim();
  const name = $("name").value.trim();
  if (!code || !name) { $("login-fehler").textContent = "Bitte Zugangscode und Namen eingeben."; return; }
  $("login-fehler").textContent = "";
  geraet.zugang = code;
  geraet.name = name;
  $("zugang").value = "";
  await verbinden();
  if (speicher.modus !== "gemeinsam") return;
  const ziel = offenerLink || "#funde";
  offenerLink = "";
  location.hash = ziel;
  hinweis(`Angemeldet als ${geraet.name}.`);
};
$("abmelden").onclick = () => { geraet.zugang = ""; verbinden(); };
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || speicher.modus !== "gemeinsam") return;
  try { zeigeVerlauf(await speicher.liste()); ladeFunde(); } catch { /* still */ }
});

// ---------- Eingabe: Link/Text auslesen, Formular, Annahmen ----------
const FELDER = ["titel", "objektart", "ort", "kaufpreis", "wohnflaeche_m2", "grundstueck_m2", "einheiten", "zimmer", "baujahr", "energieklasse", "ist_miete_monat", "hausgeld_monat", "makler_prozent", "sanierung", "eigenkapital"];
const ZAHLFELDER = new Set(["kaufpreis", "wohnflaeche_m2", "grundstueck_m2", "einheiten", "zimmer", "baujahr", "ist_miete_monat", "hausgeld_monat", "makler_prozent", "sanierung", "eigenkapital"]);
const MERKMALE = ["sanierungsbeduerftig", "vermietet", "leer", "denkmal", "erbpacht", "zweites_grundstueck", "baurecht", "oelheizung"];
const ANNAHMEN_SPEICHER = "immo-annahmen";
let eingabeLink = "";

function findeLinks(text) {
  return [...new Set((text.match(/https?:\/\/[^\s<>"')]+/g) || []).map((u) => u.replace(/[.,;]+$/, "")))];
}

function formularFuellen(f, nurLeere = false) {
  for (const k of FELDER) {
    let v = f[k];
    if (k === "ist_miete_monat" && v == null && f.ist_miete_jahr) v = Math.round(f.ist_miete_jahr / 12);
    if (v == null || v === "") continue;
    const el = $("e-" + k);
    if (nurLeere && el.value !== "") continue;
    el.value = v;
    el.classList.add("erkannt");
  }
  if (f.merkmale) for (const m of MERKMALE) if (f.merkmale[m]) $("m-" + m).checked = true;
  if (f.link) eingabeLink = f.link;
}

function formularLesen() {
  const e = { merkmale: {} };
  for (const k of FELDER) {
    const v = $("e-" + k).value.trim();
    if (v === "") continue;
    e[k] = ZAHLFELDER.has(k) ? num(v) : v;
  }
  for (const m of MERKMALE) e.merkmale[m] = $("m-" + m).checked;
  return e;
}

function formularLeeren() {
  for (const k of FELDER) { $("e-" + k).value = ""; $("e-" + k).classList.remove("erkannt"); }
  for (const m of MERKMALE) $("m-" + m).checked = false;
  $("text").value = "";
  eingabeLink = "";
}

function annahmenLesen() {
  const a = {};
  for (const k of Object.keys(STANDARD_ANNAHMEN)) { const v = $("a-" + k)?.value; if (v !== undefined && v !== "") a[k] = num(v); }
  return a;
}
function annahmenZeigen() {
  const gespeichert = lese(ANNAHMEN_SPEICHER, {});
  for (const [k, v] of Object.entries(STANDARD_ANNAHMEN)) { const el = $("a-" + k); if (el) el.value = gespeichert[k] ?? v; }
}
document.querySelectorAll("[id^='a-']").forEach((el) => el.addEventListener("change", () => schreibe(ANNAHMEN_SPEICHER, annahmenLesen())));
$("annahmen-zurueck").onclick = () => { schreibe(ANNAHMEN_SPEICHER, {}); annahmenZeigen(); hinweis("Standardwerte wiederhergestellt."); };

async function auslesen() {
  fehler("");
  const text = $("text").value.trim();
  if (!text) { fehler("Bitte zuerst einen Link oder den Anzeigentext einfügen."); return; }
  const links = findeLinks(text);
  const ka = links.find((l) => /kleinanzeigen\.de\/s-anzeige\//.test(l));
  let gefunden = 0;
  if (ka) {
    if (speicher.modus !== "gemeinsam") { fehler("Zum automatischen Auslesen von Links bitte unter „Konto“ anmelden. Alternativ den Text der Anzeige einfügen."); }
    else {
      $("auslesen").disabled = true;
      $("auslesen").textContent = "Lese Anzeige …";
      try {
        const r = await fetch("api/inserat?url=" + encodeURIComponent(ka), { headers: { "x-zugang": geraet.zugang } });
        const d = await r.json();
        if (!r.ok) throw new Error(d.fehler || "Auslesen fehlgeschlagen");
        formularFuellen(d.daten);
        gefunden = Object.keys(d.daten).length;
      } catch (e) { fehler(e.message); }
      finally { $("auslesen").disabled = false; $("auslesen").textContent = "Daten übernehmen"; }
    }
  }
  // Eingefügter Text ergänzt, was der Link nicht geliefert hat
  const ohneLinks = text.replace(/https?:\/\/\S+/g, " ").trim();
  if (ohneLinks.length > 20) {
    const f = leseInserat(ohneLinks);
    formularFuellen(f, gefunden > 0);
    gefunden += Object.keys(f).length - 1;
  }
  if (!eingabeLink && links[0]) eingabeLink = links[0];
  if (gefunden) hinweis("Daten übernommen. Bitte kurz prüfen (grün markiert) und fehlende Felder ergänzen.");
  else if (!ka) fehler("Im Text wurden keine Zahlen erkannt. Bitte die Felder unten ausfüllen.");
  $("eckdaten").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("auslesen").onclick = auslesen;

async function starteAnalyse() {
  fehler("");
  const e = formularLesen();
  if (!e.kaufpreis) { fehler("Bitte mindestens den Kaufpreis eintragen."); $("e-kaufpreis").focus(); return; }
  if (!e.wohnflaeche_m2 && !/grundst/i.test(e.objektart || "")) { fehler("Bitte die Wohnfläche eintragen (bei Grundstücken: Objektart „Grundstück“ wählen)."); $("e-wohnflaeche_m2").focus(); return; }
  if (/grundst/i.test(e.objektart || "") && !e.grundstueck_m2) { fehler("Bitte die Grundstücksgröße eintragen."); return; }
  const { daten, finanz, bericht } = auswerten(e, annahmenLesen());
  aktuell = {
    id: String(Date.now()),
    datum: new Date().toISOString(),
    autor: geraet.name || null,
    chat: [],
    titel: daten.titel,
    link: eingabeLink || null,
    eingabe: e,
    bericht,
    daten,
    finanz,
  };
  zeigeErgebnis();
  await speichereAktuell();
}
$("start").onclick = starteAnalyse;
$("leeren").onclick = () => { formularLeeren(); fehler(""); };

// Bericht nach Änderung im Rechner neu schreiben, damit Text und Zahlen zusammenpassen
function berichtAktualisieren() {
  if (!aktuell?.eingabe) return;
  const { bericht } = auswerten({ ...aktuell.eingabe, eigenkapital: aktuell.finanz?.eigenkapital }, { ...annahmenLesen(), zins: aktuell.finanz?.zins_prozent, tilgung: aktuell.finanz?.tilgung_prozent });
  aktuell.bericht = bericht;
  $("bericht").innerHTML = DOMPurify.sanitize(marked.parse(bericht));
}

// ---------- Ergebnis ----------
function zeigeErgebnis() {
  $("ergebnis").classList.remove("versteckt");
  $("bericht").innerHTML = DOMPurify.sanitize(marked.parse(aktuell.bericht));
  $("bericht").querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  const f = aktuell.finanz;
  $("f-ek").value = f.eigenkapital ?? "";
  $("f-zins").value = f.zins_prozent ?? "";
  $("f-tilg").value = f.tilgung_prozent ?? 2;
  $("f-stress").value = "";
  $("rechner-karte").classList.toggle("versteckt", !aktuell.daten);
  zeigeStrategien();
  rechne();
  aktuell.chat ||= [];
  zeigeChat();
  teilenVorbereiten();
  objektSternSetzen();
  const ziel = "#objekt-" + aktuell.id;
  if (location.hash !== ziel) { stillerWechsel = true; location.hash = ziel; }
  zeigeAnsicht("objekt");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function zeigeStrategien() {
  const liste = Array.isArray(aktuell.daten?.strategien) ? aktuell.daten.strategien : [];
  $("strategien-karte").classList.toggle("versteckt", !liste.length);
  const box = $("strategien");
  box.innerHTML = "";
  const rang = { gut: 0, bedingt: 1, nein: 2 };
  for (const s of [...liste].sort((a, b) => (rang[a.eignung] ?? 3) - (rang[b.eignung] ?? 3))) {
    const d = document.createElement("div");
    d.className = "strategie " + (rang[s.eignung] !== undefined ? s.eignung : "");
    const zahl = s.cashflow_monat != null ? `Cashflow ${eur(s.cashflow_monat)}/Monat` : s.gewinn != null ? `Gewinn ${eur(s.gewinn)}` : "";
    const symbol = { gut: "✅", bedingt: "⚠️", nein: "❌" }[s.eignung] || "•";
    d.innerHTML = `<b></b><div class="zahl"></div><div class="hinweis"></div><div style="margin-top:6px;font-size:.88rem"></div>`;
    d.children[0].textContent = `${symbol} ${s.name ?? ""}`;
    d.children[1].textContent = zahl;
    d.children[1].className = "zahl " + ((s.cashflow_monat ?? s.gewinn ?? 0) < 0 ? "neg" : "pos");
    d.children[2].textContent = s.max_kaufpreis ? `lohnt sich bis ca. ${eur(s.max_kaufpreis)} Kaufpreis` : "";
    d.children[3].textContent = s.begruendung ?? "";
    box.appendChild(d);
  }
}

function finanzAusEingabe() {
  const stress = $("f-stress").value;
  const ek = $("f-ek").value === "" ? null : num($("f-ek").value);
  aktuell.finanz = { eigenkapital: ek, zins_prozent: num($("f-zins").value), tilgung_prozent: num($("f-tilg").value) };
  return {
    ...aktuell.finanz,
    eigenkapital: ek ?? 0,
    zins_aufschlag: stress === "zins" || stress === "alle" ? 1 : 0,
    miete_aenderung_prozent: stress === "miete" || stress === "alle" ? -10 : 0,
    sanFaktor: stress === "san" || stress === "alle" ? 1.2 : 1,
  };
}

const BASIS_FELDER = [
  ["kaufpreis", "Kaufpreis (€)"],
  ["wohnflaeche_m2", "Wohnfläche (m²)"],
  ["grunderwerbsteuer_prozent", "Grunderwerbsteuer (%)"],
  ["notar_grundbuch_prozent", "Notar & Grundbuch (%)"],
  ["makler_prozent", "Makler (%)"],
];
const SZ_FELDER = [
  ["kaltmiete_monat", "Kaltmiete / Monat (€)"],
  ["sanierung", "Sanierung / Modernisierung (€)"],
  ["leerstand_prozent", "Leerstand / Mietausfall (%)"],
  ["nicht_umlagefaehig_monat", "Nicht umlagefähige Kosten / Monat (€)"],
  ["instandhaltung_m2_jahr", "Instandhaltung (€/m² · Jahr)"],
  ["verwaltung_monat", "Verwaltung / Monat (€)"],
];

function rechne() {
  const d = aktuell.daten;
  if (!d) { zeigeUeberblick(null); return; }
  d.szenarien ??= {};
  for (const [k] of SZENARIEN) d.szenarien[k] ??= {};
  const fin = finanzAusEingabe();
  const erg = {};
  for (const [k] of SZENARIEN) {
    const s = { ...d.szenarien[k], sanierung: num(d.szenarien[k].sanierung) * fin.sanFaktor };
    erg[k] = rechneSzenario(d, s, fin);
  }

  const zelle = (pfad, wert, span) => `<td${span ? ` colspan="${span}" style="text-align:left"` : ""}><input data-pfad="${pfad}" type="number" step="any" value="${wert ?? ""}" /></td>`;
  let html = `<tr><th>Position</th>${SZENARIEN.map(([, n]) => `<th>${n}</th>`).join("")}</tr>`;
  for (const [k, n] of BASIS_FELDER) html += `<tr><td>${n}</td>${zelle("basis." + k, d[k], 3)}</tr>`;
  for (const [k, n] of SZ_FELDER) html += `<tr><td>${n}</td>${SZENARIEN.map(([s]) => zelle(`${s}.${k}`, d.szenarien[s][k])).join("")}</tr>`;
  const zeile = (name, fn, cls = "") => `<tr class="${cls}"><td>${name}</td>${SZENARIEN.map(([s]) => { const v = fn(erg[s]); return `<td class="${typeof v === "object" ? v.c : ""}">${typeof v === "object" ? v.t : v}</td>`; }).join("")}</tr>`;
  const vorz = (v) => ({ t: eur(v), c: v < 0 ? "neg" : "pos" });
  html += zeile("Kaufnebenkosten", (e) => eur(e.nebenkosten));
  html += zeile("Gesamtinvestition", (e) => eur(e.invest), "summe");
  html += zeile("Darlehen", (e) => eur(e.darlehen));
  html += zeile("Rate / Monat", (e) => eur(e.rateMonat));
  html += zeile("Jahreskaltmiete", (e) => eur(e.jahresKaltmiete));
  html += zeile("Bewirtschaftung / Jahr", (e) => eur(e.bewirtschaftung));
  html += zeile("Reinertrag / Jahr", (e) => eur(e.reinertrag));
  html += zeile("Cashflow / Monat (vor Steuern)", (e) => vorz(e.cashflowMonat), "summe");
  html += zeile("Bruttorendite", (e) => pct(e.bruttorendite));
  html += zeile("Nettorendite", (e) => pct(e.nettorendite));
  html += zeile("Kaufpreisfaktor", (e) => dez(e.faktor));
  html += zeile("Eigenkapitalrendite", (e) => pct(e.ekRendite));
  html += zeile("Eigenkapital für Cashflow 0", (e) => eur(e.ekFuerCashflow0));
  $("rechner").innerHTML = html;
  const real = { ...d.szenarien.realistisch, sanierung: num(d.szenarien.realistisch.sanierung) * fin.sanFaktor };
  erg.realistisch.maxKpCf0 = maxKaufpreisCashflowNull(d, real, fin);
  zeigeUeberblick(erg.realistisch);
}

$("rechner").addEventListener("change", (ev) => {
  const p = ev.target.dataset?.pfad;
  if (!p) return;
  const [bereich, feld] = p.split(".");
  const wert = ev.target.value === "" ? null : num(ev.target.value);
  if (bereich === "basis") aktuell.daten[feld] = wert;
  else aktuell.daten.szenarien[bereich][feld] = wert;
  rechne();
  speichereSpaeter();
});
for (const id of ["f-ek", "f-zins", "f-tilg", "f-stress"]) $(id).addEventListener("change", () => { rechne(); berichtAktualisieren(); speichereSpaeter(); });

function zeigeUeberblick(r) {
  const d = aktuell.daten || {};
  const farbe = { gruen: "var(--gut)", gelb: "var(--warn)", rot: "var(--kritisch)" }[d.ampel] || "var(--leise)";
  const markt = d.markt_kaufpreis_m2;
  const marktText = markt?.min && markt?.max ? `${eur(markt.min)} – ${eur(markt.max)}` : "–";
  const esc = (s) => DOMPurify.sanitize(String(s ?? ""), { ALLOWED_TAGS: [] });
  $("ueberblick").innerHTML = `
    <div class="objektkopf">
      <div class="ampel" style="background:${farbe}" title="Bewertung 0–100">${d.score ?? "?"}</div>
      <div style="min-width:0">
        <span class="eyebrow">${esc([d.objektart, d.ort, d.baujahr && "Bj. " + d.baujahr].filter(Boolean).join(" · "))}</span>
        <h2>${esc(aktuell.titel)}</h2>
        ${d.empfehlung ? `<div class="empfehlung">${esc(d.empfehlung)}</div>` : ""}
        <div class="hinweis">${aktuell.autor ? "Analysiert von " + esc(aktuell.autor) + " · " : ""}${aktuell.datum ? new Date(aktuell.datum).toLocaleDateString("de-DE") : ""}${aktuell.link ? ` · <a href="${esc(aktuell.link)}" target="_blank" rel="noopener">Zum Inserat</a>` : ""}</div>
      </div>
    </div>
    ${r ? `<div class="kpis">
      <div class="kpi messing"><b>${eur(d.verhandlungsziel)}</b><span>Verhandlungsziel</span></div>
      <div class="kpi"><b>${eur(r.preisM2)}</b><span>Preis/m² (Markt ${marktText})</span></div>
      <div class="kpi"><b>${pct(r.bruttorendite)}</b><span>Bruttorendite (realistisch)</span></div>
      <div class="kpi"><b>${dez(r.faktor)}</b><span>Kaufpreisfaktor</span></div>
      <div class="kpi"><b class="${r.cashflowMonat < 0 ? "neg" : "pos"}">${eur(r.cashflowMonat)}</b><span>Cashflow/Monat (realistisch)</span></div>
      <div class="kpi"><b>${eur(r.ekFuerCashflow0)}</b><span>Eigenkapital für Cashflow 0</span></div>
      <div class="kpi"><b class="${r.maxKpCf0 >= num(d.kaufpreis) ? "pos" : "neg"}">${eur(r.maxKpCf0)}</b><span>Max. Kaufpreis für Cashflow ≥ 0 (bei ${eur(r.eigenkapital)} EK)</span></div>
    </div>` : `<p class="hinweis">Für den Rechner fehlten strukturierte Zahlen – siehe Bericht.</p>`}`;
}

// ---------- Aktionen ----------
$("drucken").onclick = () => window.print();
$("kopieren").onclick = async () => {
  try { await navigator.clipboard.writeText(aktuell.bericht); $("kopieren").textContent = "✓ Kopiert"; } catch { $("kopieren").textContent = "Kopieren nicht möglich"; }
  setTimeout(() => ($("kopieren").textContent = "Bericht kopieren"), 2000);
};
$("neu").onclick = () => {
  formularLeeren();
  location.hash = "#neu";
};
// Eingaben dieses Objekts zum Ändern zurück ins Formular holen
$("bearbeiten").onclick = () => {
  if (!aktuell?.eingabe) { hinweis("Für dieses Objekt sind keine Eingaben gespeichert."); return; }
  formularLeeren();
  formularFuellen({ ...aktuell.eingabe, link: aktuell.link });
  location.hash = "#neu";
  hinweis("Eingaben übernommen – ändern und neu auswerten.");
};

// ---------- Gemeinsame Objektliste ----------
let speicherTimer = null;
async function speichereAktuell() {
  if (!aktuell) return;
  try {
    await speicher.speichern(aktuell);
    zeigeVerlauf(await speicher.liste());
  } catch (e) {
    fehler("Speichern fehlgeschlagen: " + e.message);
  }
}
// Rechner-Änderungen gebündelt speichern
function speichereSpaeter() {
  clearTimeout(speicherTimer);
  speicherTimer = setTimeout(speichereAktuell, 1500);
}

const AMPEL = { gruen: "gruen", gelb: "gelb", rot: "rot" };
function zeigeVerlauf(liste = []) {
  const box = $("verlauf");
  $("verlauf-titel").textContent = speicher.modus === "gemeinsam" ? "Unsere Objekte" : "Objekte auf diesem Gerät";
  if (!liste.length) { box.innerHTML = `<p class="hinweis">Noch keine Analysen. Leg unter „Analysieren“ das erste Objekt an.</p>`; return; }
  box.innerHTML = "";
  for (const e of liste) {
    const zeile = document.createElement("div");
    zeile.className = "zeile";
    zeile.innerHTML = `<span class="streifen"></span><div style="min-width:0"><a class="titel"></a><div class="meta"></div></div><div class="rechts"></div>`;
    zeile.firstChild.classList.add(AMPEL[e.ampel] || "x");
    const titel = zeile.querySelector(".titel");
    titel.textContent = e.titel;
    titel.href = "#objekt-" + e.id;
    zeile.querySelector(".meta").textContent = `${e.autor ? e.autor + " · " : ""}${e.datum ? new Date(e.datum).toLocaleDateString("de-DE") : ""}`;
    const loeschen = document.createElement("button");
    loeschen.className = "leise";
    loeschen.textContent = "Löschen";
    loeschen.onclick = async () => {
      if (loeschen.dataset.sicher !== "1") { loeschen.dataset.sicher = "1"; loeschen.textContent = "Für beide löschen?"; setTimeout(() => { loeschen.dataset.sicher = ""; loeschen.textContent = "Löschen"; }, 4000); return; }
      await speicher.loeschen(e.id);
      if (aktuell && String(aktuell.id) === String(e.id)) { aktuell = null; $("ergebnis").classList.add("versteckt"); }
      zeigeVerlauf(await speicher.liste());
    };
    zeile.querySelector(".rechts").appendChild(loeschen);
    box.appendChild(zeile);
  }
}

// ---------- Notizen zum Objekt (zwischen euch beiden, ohne KI) ----------
function md(text) {
  const el = document.createElement("div");
  el.innerHTML = DOMPurify.sanitize(marked.parse(text || ""));
  el.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
  return el;
}
function zeigeChat() {
  const box = $("chat-verlauf");
  box.innerHTML = "";
  for (const e of aktuell?.chat || []) {
    const d = document.createElement("div");
    d.className = "blase " + (e.autor && e.autor === geraet.name ? "ich" : "ki");
    const kopf = document.createElement("div");
    kopf.className = "hinweis";
    kopf.textContent = `${e.autor || "?"}` + (e.zeit ? " · " + new Date(e.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "");
    d.append(kopf, md(e.text));
    box.appendChild(d);
  }
  box.scrollTop = box.scrollHeight;
}
async function notizSenden() {
  const text = $("chat-eingabe").value.trim();
  if (!text || !aktuell) return;
  const eintrag = { rolle: "user", text, autor: geraet.name || "Ich", zeit: new Date().toISOString() };
  $("chat-senden").disabled = true;
  try {
    aktuell.chat = await speicher.chatAnhaengen(aktuell.id, [eintrag]);
    $("chat-eingabe").value = "";
    zeigeChat();
  } catch (e) { fehler("Notiz nicht gespeichert: " + e.message); }
  finally { $("chat-senden").disabled = false; }
}
$("chat-senden").onclick = notizSenden;
$("chat-eingabe").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); notizSenden(); } });

// ---------- Navigation (Hash: #neu, #objekte, #funde, #fragen, #konto, #objekt-<id>) ----------
let stillerWechsel = false;
let offenerLink = "";
function zeigeAnsicht(name) {
  document.querySelectorAll("[data-ansicht]").forEach((el) => { el.hidden = el.dataset.ansicht !== name; });
  document.querySelectorAll("[data-tab]").forEach((a) => {
    const aktiv = a.dataset.tab === name || (name === "objekt" && a.dataset.tab === "objekte");
    if (aktiv) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (name === "funde") { schreibe("immo-funde-gesehen", new Date().toISOString()); zeigeFundeZahl(); }
}
function geheZu(name) {
  if (location.hash !== "#" + name) location.hash = "#" + name; else zeigeAnsicht(name);
}
async function route() {
  if (stillerWechsel) { stillerWechsel = false; return; }
  const h = location.hash.slice(1) || (speicher.modus === "gemeinsam" ? "funde" : "konto");
  const m = /^objekt-([A-Za-z0-9_-]+)$/.exec(h);
  if (m) {
    if (aktuell && String(aktuell.id) === m[1]) { zeigeAnsicht("objekt"); return; }
    try {
      const o = await speicher.laden(m[1]);
      if (o) { aktuell = o; zeigeErgebnis(); return; }
      if (speicher.modus !== "gemeinsam") { offenerLink = "#" + h; $("login-fehler").textContent = "Bitte anmelden – danach öffnet sich das geteilte Objekt."; }
      else fehler("Dieses Objekt gibt es nicht mehr.");
    } catch (e) { fehler(e.message); }
    zeigeAnsicht(speicher.modus === "gemeinsam" ? "objekte" : "konto");
    return;
  }
  zeigeAnsicht(["neu", "objekte", "funde", "merkliste", "konto", "objekt"].includes(h) ? h : "funde");
}
window.addEventListener("hashchange", route);

// ---------- Teilen (WhatsApp, Teilen-Menü, Link) ----------
function objektLink() { return `${location.origin}${location.pathname}#objekt-${aktuell.id}`; }
function teilenText() {
  const d = aktuell.daten || {};
  const fin = finanzAusEingabe();
  const real = d.szenarien?.realistisch ? rechneSzenario(d, { ...d.szenarien.realistisch }, fin) : null;
  const ampel = { gruen: "🟢", gelb: "🟡", rot: "🔴" }[d.ampel] || "🏠";
  const zeilen = [
    `${ampel} *${aktuell.titel}*`,
    d.empfehlung ? d.empfehlung : null,
    d.kaufpreis ? `Preis: ${eur(d.kaufpreis)}${d.wohnflaeche_m2 ? ` · ${d.wohnflaeche_m2} m² · ${eur(d.kaufpreis / d.wohnflaeche_m2)}/m²` : ""}` : null,
    real ? `Faktor ${dez(real.faktor)} · Cashflow ${eur(real.cashflowMonat)}/Monat` : null,
    d.verhandlungsziel ? `Verhandlungsziel: ${eur(d.verhandlungsziel)}` : null,
    "",
    `Analyse: ${objektLink()}`,
    aktuell.link ? `Inserat: ${aktuell.link}` : null,
  ];
  return zeilen.filter((z) => z !== null).join("\n");
}
// Fertige Anfrage für Claude (läuft über das Claude-Abo, keine API-Kosten)
function claudeAnfrage(o) {
  const d = o.daten || {};
  const e = o.eingabe || {};
  const fin = o.finanz || {};
  const real = d.szenarien?.realistisch && d.wohnflaeche_m2 ? rechneSzenario(d, d.szenarien.realistisch, { eigenkapital: fin.eigenkapital, zins_prozent: fin.zins_prozent, tilgung_prozent: fin.tilgung_prozent }) : null;
  const zeile = (k, v) => (v == null || v === "" ? null : `- ${k}: ${v}`);
  const teile = [
    "Bitte prüfe dieses Immobilienangebot für uns (Murat & Yasemin, Investoren aus Hamm) vollständig mit dem Skill immobilien-analyse, falls vorhanden.",
    o.link ? `Anzeige: ${o.link}` : null,
    "",
    "Eckdaten (aus der Anzeige bzw. von uns ergänzt):",
    zeile("Objekt", d.titel),
    zeile("Objektart", d.objektart), zeile("Ort", d.ort),
    zeile("Kaufpreis", d.kaufpreis ? eur(d.kaufpreis) : null),
    zeile("Wohnfläche", d.wohnflaeche_m2 ? d.wohnflaeche_m2 + " m²" : null),
    zeile("Grundstück", d.grundstueck_m2 ? d.grundstueck_m2 + " m²" : null),
    zeile("Einheiten", d.einheiten), zeile("Baujahr", d.baujahr), zeile("Energieklasse", d.energieklasse),
    zeile("Ist-Kaltmiete", e.ist_miete_monat ? eur(e.ist_miete_monat) + "/Monat" : null),
    zeile("Hausgeld", e.hausgeld_monat ? eur(e.hausgeld_monat) + "/Monat" : null),
    zeile("Makler", d.makler_prozent != null ? String(d.makler_prozent).replace(".", ",") + " %" : null),
    zeile("Merkmale", Object.entries(e.merkmale || {}).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " ")).join(", ") || null),
    "",
    "Unsere Vorab-Rechnung (feste Annahmen, ohne Marktrecherche):",
    real ? `- Faktor ${dez(real.faktor)}, Cashflow ${eur(real.cashflowMonat)}/Monat bei ${eur(fin.eigenkapital)} Eigenkapital, ${fin.zins_prozent} % Zins` : null,
    ...(d.strategien || []).map((st) => `- ${st.name}: ${st.eignung}${st.max_kaufpreis ? ", lohnt sich bis ca. " + eur(st.max_kaufpreis) : ""}`),
    d.verhandlungsziel ? `- Verhandlungsziel: ${eur(d.verhandlungsziel)}` : null,
    "",
    "Bitte: Anzeige lesen, Mietspiegel, Vergleichspreise und Bodenrichtwert aktuell recherchieren, alle Strategien (Cashflow, Fix & Flip, Aufteilung, Grundstück, Ferienwohnung) mit echten Marktdaten neu rechnen, die größten Risiken nennen, ein Verhandlungsziel begründen und offene Fragen an den Makler auflisten.",
  ];
  return teile.filter((t) => t !== null).join("\n");
}
function claudeLink(text) {
  // claude.ai übernimmt den Text als neue Nachricht; sehr lange Texte kürzen
  return "https://claude.ai/new?q=" + encodeURIComponent(text.slice(0, 6000));
}
$("claude-pruefen").addEventListener("click", async () => {
  // Zusätzlich in die Zwischenablage, falls die Claude-App den Text nicht übernimmt
  try { await navigator.clipboard.writeText(claudeAnfrage(aktuell)); hinweis("Anfrage auch in die Zwischenablage kopiert – falls Claude leer öffnet, einfach einfügen."); } catch { /* egal */ }
});

function teilenVorbereiten() {
  $("claude-pruefen").href = claudeLink(claudeAnfrage(aktuell));
  $("whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(teilenText());
  $("teilen").hidden = !navigator.share;
}
$("teilen").onclick = async () => {
  try { await navigator.share({ title: aktuell.titel, text: teilenText(), url: objektLink() }); } catch { /* abgebrochen */ }
};
$("link-kopieren").onclick = async () => {
  try { await navigator.clipboard.writeText(objektLink()); $("link-kopieren").textContent = "✓ Link kopiert"; }
  catch { $("link-kopieren").textContent = objektLink(); }
  setTimeout(() => ($("link-kopieren").textContent = "Link kopieren"), 2500);
};

// ---------- Funde des Scouts ----------
let funde = [];
let fundeFilter = "gut";
async function ladeFunde() {
  if (speicher.modus !== "gemeinsam") { $("funde-status").textContent = "Melde dich unter „Konto“ an, um die Funde des Scouts zu sehen."; $("funde").innerHTML = ""; return; }
  try {
    const d = await extras.funde();
    funde = d.funde || [];
    const st = d.status;
    $("funde-status").textContent = st ? `Letzte Suche ${new Date(st.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}: ${st.neu} neu, ${st.geprueft ?? 0} durchgerechnet, ${st.gut} gut${st.fehler?.length ? ` · Probleme: ${st.fehler.join("; ")}` : ""}` : "Der Scout hat noch nicht gesucht. Er läuft alle 15 Minuten zwischen 6 und 22 Uhr.";
    zeigeFunde();
    zeigeFundeZahl();
  } catch (e) { $("funde-status").textContent = e.message; }
}
function zeigeFundeZahl() {
  const seit = lese("immo-funde-gesehen", "");
  const n = funde.filter((f) => f.gut && (!seit || f.gefunden > seit)).length;
  $("funde-zahl").hidden = !n;
  $("funde-zahl").textContent = n;
}
function zeigeFunde() {
  const box = $("funde");
  const art = $("funde-art").value;
  const liste = funde.filter((f) => (fundeFilter === "alle" || (fundeFilter === "gut" ? f.gut : f.bewertung)) && (!art || f.kategorie === art));
  if (!liste.length) { box.innerHTML = `<p class="hinweis">${fundeFilter === "gut" ? "Gerade kein neuer Fund, der sich nach Durchrechnung lohnt. Unter „Alle neuen“ siehst du jede neue Anzeige." : "Keine Funde mit diesem Filter."}</p>`; return; }
  box.innerHTML = "";
  for (const f of liste.slice(0, 120)) {
    const z = document.createElement("div");
    z.className = "zeile";
    z.innerHTML = `<span class="streifen"></span><div style="min-width:0"><a class="titel" target="_blank" rel="noopener"></a><div class="meta"></div></div><div class="rechts"></div>`;
    const amp = f.bewertung?.ampel;
    z.firstChild.classList.add(amp === "gruen" || (!amp && f.gut) ? "gruen" : amp === "gelb" ? "gelb" : amp === "rot" ? "rot" : "x");
    const t = z.querySelector(".titel");
    t.textContent = f.titel || "(ohne Titel)";
    t.href = f.url;
    if (f.gut) { const g = document.createElement("span"); g.className = "marke-gut"; g.textContent = "gut"; t.after(g); }
    const fak = f.faktor_inserat ?? f.faktor;
    z.querySelector(".meta").innerHTML = "";
    z.querySelector(".meta").append(
      `${f.kategorie} · ${f.km ?? "?"} km ${f.ort} · `,
      Object.assign(document.createElement("span"), { className: "zahl", textContent: `${f.preis_text}${f.preis_m2 ? ` · ${f.preis_m2.toLocaleString("de-DE")} €/m²` : ""}${fak ? ` · F ${String(fak).replace(".", ",")}` : ""}` }),
      ` · ${f.eingestellt}`,
    );
    if (f.bewertung) {
      const bw = f.bewertung;
      const zeile = document.createElement("div");
      zeile.className = "meta bewertung";
      zeile.textContent = "Geprüft: " + [
        bw.cashflow_monat != null ? `Cashflow ${bw.cashflow_monat >= 0 ? "+" : ""}${bw.cashflow_monat.toLocaleString("de-DE")} €/Monat` : null,
        bw.faktor ? `Faktor ${String(bw.faktor).replace(".", ",")}` : null,
        bw.beste?.max_kaufpreis ? `${bw.beste.name} lohnt bis ${bw.beste.max_kaufpreis.toLocaleString("de-DE")} €` : null,
        bw.ist_miete ? "(Ist-Miete)" : "(Marktmiete geschätzt)",
      ].filter(Boolean).join(" · ");
      z.querySelector(".meta").after(zeile);
    }
    const analysieren = document.createElement("button");
    analysieren.textContent = "Analysieren";
    analysieren.onclick = async () => {
      formularLeeren();
      $("text").value = `${f.url}\n\n${f.titel}\n${f.preis_text} · ${f.groesse_text} · ${f.ort}\n${f.beschreibung || ""}`;
      location.hash = "#neu";
      await auslesen();
      if (formularLesen().kaufpreis) await starteAnalyse();
    };
    const wa = document.createElement("a");
    wa.className = "knopf zweit";
    wa.textContent = "WhatsApp";
    wa.target = "_blank"; wa.rel = "noopener";
    wa.href = "https://wa.me/?text=" + encodeURIComponent(`🏠 ${f.titel}\n${f.preis_text} · ${f.groesse_text} · ${f.ort}${fak ? ` · Faktor ~${fak}` : ""}\n${f.url}`);
    wa.style.padding = "7px 10px"; wa.style.fontSize = ".82rem";
    const cl = document.createElement("a");
    cl.className = "knopf zweit";
    cl.textContent = "Claude";
    cl.target = "_blank"; cl.rel = "noopener";
    cl.href = claudeLink(`Bitte prüfe dieses Immobilienangebot für uns (Murat & Yasemin, Investoren aus Hamm) vollständig mit dem Skill immobilien-analyse, falls vorhanden: ${f.url}\n\n${f.titel} · ${f.preis_text} · ${f.groesse_text} · ${f.ort}\n\nBitte Anzeige lesen, Marktdaten aktuell recherchieren, alle Strategien (Cashflow, Fix & Flip, Aufteilung, Grundstück, Ferienwohnung) rechnen, Risiken und Verhandlungsziel nennen.`);
    cl.style.padding = "7px 10px"; cl.style.fontSize = ".82rem";
    const stern = sternKnopf({ id: "f" + f.id, art: "fund", titel: f.titel, url: f.url, preis_text: f.preis_text, ort: f.ort, ampel: f.bewertung?.ampel || (f.gut ? "gruen" : null), info: f.bewertung?.beste?.max_kaufpreis ? `${f.bewertung.beste.name} bis ${f.bewertung.beste.max_kaufpreis.toLocaleString("de-DE")} €` : f.groesse_text });
    z.querySelector(".rechts").append(stern, analysieren, wa, cl);
    box.appendChild(z);
  }
}
document.querySelectorAll("#funde-filter [data-filter]").forEach((b) => {
  b.onclick = () => {
    fundeFilter = b.dataset.filter;
    document.querySelectorAll("#funde-filter [data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    zeigeFunde();
  };
});

// ---------- Push-Benachrichtigungen ----------
const VAPID_PUBLIC = "BAHdvRSml9GULT2Qv1SpcV2-jOC_0J88L_cjOQiTmbpBJ5SJmrAVgNVDkEXlGCHm_U9luLOWQjnqpoJa-QkfofE";
const pushMoeglich = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
function b64ZuBytes(b64) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function swRegistrierung() { return navigator.serviceWorker.register("sw.js"); }
async function pushStatus() {
  const st = $("push-status");
  if (!pushMoeglich()) {
    st.textContent = /iPhone|iPad/.test(navigator.userAgent) ? "Auf dem iPhone zuerst über Teilen → „Zum Home-Bildschirm“ installieren und die App von dort öffnen." : "Dieser Browser unterstützt keine Benachrichtigungen.";
    $("push-an").disabled = true; return;
  }
  if (speicher.modus !== "gemeinsam") { st.textContent = "Erst anmelden, dann Benachrichtigungen einschalten."; $("push-an").disabled = true; return; }
  $("push-an").disabled = false;
  const reg = await swRegistrierung();
  const abo = await reg.pushManager.getSubscription();
  const an = !!abo && Notification.permission === "granted";
  $("push-an").classList.toggle("versteckt", an);
  $("push-test").classList.toggle("versteckt", !an);
  $("push-aus").classList.toggle("versteckt", !an);
  st.textContent = an ? `Benachrichtigungen sind auf diesem Gerät an (für ${geraet.name}).` : Notification.permission === "denied" ? "Benachrichtigungen sind in den Geräte-Einstellungen blockiert." : "";
  if (an) extras.pushAbo(abo.toJSON(), geraet.name).catch(() => {}); // Abo aktuell halten
}
$("push-an").onclick = async () => {
  try {
    const erlaubt = await Notification.requestPermission();
    if (erlaubt !== "granted") { $("push-status").textContent = "Ohne Erlaubnis keine Benachrichtigungen."; return; }
    const reg = await swRegistrierung();
    await navigator.serviceWorker.ready;
    const abo = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ZuBytes(VAPID_PUBLIC) }));
    await extras.pushAbo(abo.toJSON(), geraet.name);
    await pushStatus();
  } catch (e) { $("push-status").textContent = "Einschalten fehlgeschlagen: " + e.message; }
};
$("push-test").onclick = async () => {
  try { const r = await extras.pushTest(); $("push-status").textContent = `Test an ${r.gesendet} Gerät(e) geschickt.`; } catch (e) { $("push-status").textContent = e.message; }
};
$("push-aus").onclick = async () => {
  const reg = await swRegistrierung();
  const abo = await reg.pushManager.getSubscription();
  if (abo) { await extras.pushAbmelden(abo.endpoint).catch(() => {}); await abo.unsubscribe(); }
  await pushStatus();
};
if ("serviceWorker" in navigator) swRegistrierung().catch(() => {});

$("funde-art").addEventListener("change", zeigeFunde);

// ---------- Merkliste: Favoriten und To-dos ----------
let merk = { favoriten: [], todos: [] };
const istFavorit = (id) => merk.favoriten.some((f) => f.id === id);
function sternKnopf(eintrag) {
  const b = document.createElement("button");
  b.className = "stern";
  b.dataset.favorit = eintrag.id;
  const setzen = () => { const an = istFavorit(eintrag.id); b.textContent = an ? "★" : "☆"; b.setAttribute("aria-pressed", String(an)); b.title = an ? "Aus Favoriten entfernen" : "Merken"; };
  setzen();
  b.onclick = async () => {
    if (speicher.modus !== "gemeinsam") { fehler("Zum Merken bitte unter „Konto“ anmelden."); return; }
    try {
      const r = await extras.favorit({ ...eintrag, von: geraet.name }, istFavorit(eintrag.id));
      merk.favoriten = r.favoriten;
      document.querySelectorAll(`[data-favorit="${CSS.escape(eintrag.id)}"]`).forEach((x) => { x.textContent = istFavorit(eintrag.id) ? "★" : "☆"; x.setAttribute("aria-pressed", String(istFavorit(eintrag.id))); });
      zeigeMerkliste();
      hinweis(istFavorit(eintrag.id) ? "Gemerkt." : "Aus Favoriten entfernt.");
      objektSternSetzen();
    } catch (e) { fehler(e.message); }
  };
  return b;
}
async function ladeMerkliste() {
  try { merk = await extras.merkliste(); } catch { merk = { favoriten: [], todos: [] }; }
  zeigeMerkliste();
  objektSternSetzen();
}
function zeigeMerkliste() {
  const offen = merk.todos.filter((t) => !t.erledigt && (!t.fuer || t.fuer === geraet.name)).length;
  $("todo-zahl").hidden = !offen;
  $("todo-zahl").textContent = offen;
  // To-dos
  const tb = $("todos");
  tb.innerHTML = merk.todos.length ? "" : `<p class="hinweis">Keine To-dos. Oben eintragen oder bei einem Objekt „+ To-do“ wählen.</p>`;
  for (const t of [...merk.todos].sort((a, b) => a.erledigt - b.erledigt)) {
    const z = document.createElement("div");
    z.className = "zeile todo" + (t.erledigt ? " erledigt" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = t.erledigt; cb.setAttribute("aria-label", "Erledigt");
    cb.onchange = async () => { try { merk.todos = (await extras.todo({ aktion: "umschalten", id: t.id, von: geraet.name })).todos; zeigeMerkliste(); } catch (e) { fehler(e.message); } };
    const mitte = document.createElement("div");
    mitte.style.minWidth = "0";
    const titel = document.createElement(t.objekt?.url || t.objekt?.id ? "a" : "span");
    titel.className = "titel"; titel.textContent = t.text;
    if (t.objekt?.id && !t.objekt.url) titel.href = "#objekt-" + t.objekt.id;
    else if (t.objekt?.url) { titel.href = t.objekt.url; titel.target = "_blank"; titel.rel = "noopener"; }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [t.fuer ? "für " + t.fuer : "für uns", t.objekt?.titel ? "· " + t.objekt.titel : null, t.von ? "· von " + t.von : null, t.erledigt && t.erledigt_von ? "· erledigt von " + t.erledigt_von : null].filter(Boolean).join(" ");
    mitte.append(titel, meta);
    const x = document.createElement("button");
    x.className = "leise"; x.textContent = "Löschen";
    x.onclick = async () => { try { merk.todos = (await extras.todo({ aktion: "entfernen", id: t.id })).todos; zeigeMerkliste(); } catch (e) { fehler(e.message); } };
    z.append(cb, mitte, x);
    tb.appendChild(z);
  }
  // Favoriten
  const fb = $("favoriten");
  fb.innerHTML = merk.favoriten.length ? "" : `<p class="hinweis">Noch keine Favoriten.</p>`;
  for (const f of merk.favoriten) {
    const z = document.createElement("div");
    z.className = "zeile";
    z.innerHTML = `<span class="streifen"></span><div style="min-width:0"><a class="titel"></a><div class="meta"></div></div><div class="rechts"></div>`;
    z.firstChild.classList.add({ gruen: "gruen", gelb: "gelb", rot: "rot" }[f.ampel] || "x");
    const t = z.querySelector(".titel");
    t.textContent = f.titel || "(ohne Titel)";
    if (f.art === "objekt") t.href = "#objekt-" + f.id.replace(/^o/, "");
    else { t.href = f.url; t.target = "_blank"; t.rel = "noopener"; }
    z.querySelector(".meta").textContent = [f.preis_text, f.ort, f.info, f.von ? "gemerkt von " + f.von : null].filter(Boolean).join(" · ");
    const r = z.querySelector(".rechts");
    if (f.art === "fund") {
      const an = document.createElement("button");
      an.textContent = "Analysieren";
      an.onclick = async () => { formularLeeren(); $("text").value = f.url; location.hash = "#neu"; await auslesen(); if (formularLesen().kaufpreis) await starteAnalyse(); };
      r.appendChild(an);
    }
    r.appendChild(sternKnopf(f));
    fb.appendChild(z);
  }
}
async function todoAnlegen(text, fuer, objekt) {
  if (speicher.modus !== "gemeinsam") { fehler("Für To-dos bitte unter „Konto“ anmelden."); return false; }
  try { merk.todos = (await extras.todo({ aktion: "neu", text, fuer, von: geraet.name, objekt })).todos; zeigeMerkliste(); return true; }
  catch (e) { fehler(e.message); return false; }
}
$("todo-hinzu").onclick = async () => {
  const text = $("todo-text").value.trim();
  if (!text) return;
  if (await todoAnlegen(text, $("todo-fuer").value, todoObjekt)) {
    $("todo-text").value = "";
    todoObjekt = null;
    $("todo-text").placeholder = "z. B. Makler anrufen, Mieterliste anfordern";
    hinweis("To-do gespeichert.");
  }
};
$("todo-text").addEventListener("keydown", (e) => { if (e.key === "Enter") $("todo-hinzu").click(); });
function objektSternSetzen() {
  if (!aktuell) return;
  const an = istFavorit("o" + aktuell.id);
  $("objekt-stern").textContent = an ? "★ Gemerkt" : "☆ Merken";
  $("objekt-stern").setAttribute("aria-pressed", String(an));
}
$("objekt-stern").onclick = () => {
  if (!aktuell) return;
  sternKnopf({ id: "o" + aktuell.id, art: "objekt", titel: aktuell.titel, url: aktuell.link || "", preis_text: aktuell.daten?.kaufpreis ? eur(aktuell.daten.kaufpreis) : "", ort: aktuell.daten?.ort || "", ampel: aktuell.daten?.ampel, info: aktuell.daten?.empfehlung || "" }).click();
};
let todoObjekt = null;
$("objekt-todo").onclick = () => {
  if (!aktuell) return;
  todoObjekt = { id: aktuell.id, titel: aktuell.titel };
  location.hash = "#merkliste";
  $("todo-text").placeholder = `To-do zu „${aktuell.titel}“, z. B. Makler anrufen`;
  setTimeout(() => $("todo-text").focus(), 50);
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && speicher.modus === "gemeinsam") ladeMerkliste(); });

annahmenZeigen();
verbinden();
window.__appBereit = true;
