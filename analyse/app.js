import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm";
import { systemPrompt, userPrompt } from "./prompt.js";
import { rechneSzenario, num } from "./rechner.js";

const MODELL = "claude-opus-5-5";
const SZENARIEN = [["vorsichtig", "Vorsichtig"], ["realistisch", "Realistisch"], ["gut", "Gut"]];
const KEY_SPEICHER = "immo-analyse-apikey";
const VERLAUF_SPEICHER = "immo-analyse-verlauf";

const $ = (id) => document.getElementById(id);
const eur = (v) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €");
const pct = (v) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " %");
const dez = (v, d = 1) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("de-DE", { maximumFractionDigits: d }));

let aktuell = null; // { id, datum, titel, link, bericht, daten, finanz }
let laufenderStream = null;
let abgebrochen = false;

// ---------- Speicher (kann im privaten Modus fehlen) ----------
function lese(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function schreibe(key, wert) {
  try { localStorage.setItem(key, JSON.stringify(wert)); return true; } catch { return false; }
}

// ---------- Einstellungen ----------
function zeigeKeyStatus() {
  const k = lese(KEY_SPEICHER, "");
  $("key-status").textContent = k ? "✓ Schlüssel gespeichert" : "Noch kein Schlüssel gespeichert";
  if (!k) $("einstellungen-details").open = true;
}
$("key-speichern").onclick = () => {
  const k = $("apikey").value.trim();
  if (!k) return;
  schreibe(KEY_SPEICHER, k);
  $("apikey").value = "";
  zeigeKeyStatus();
};
$("key-loeschen").onclick = () => { try { localStorage.removeItem(KEY_SPEICHER); } catch {} zeigeKeyStatus(); };

// ---------- Dateien ----------
const MEDIEN = ["image/png", "image/jpeg", "image/webp", "image/gif"];
async function dateiZuBlock(file) {
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  if (file.type === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 }, title: file.name };
  }
  if (MEDIEN.includes(file.type)) {
    return { type: "image", source: { type: "base64", media_type: file.type, data: b64 } };
  }
  throw new Error(`Dateityp nicht unterstützt: ${file.name}`);
}

// ---------- Fortschritt ----------
function log(text, ok = false) {
  const d = document.createElement("div");
  d.textContent = text;
  if (ok) d.className = "ok";
  $("log").appendChild(d);
  $("log").scrollTop = $("log").scrollHeight;
}
function fehler(text) {
  $("fehler").textContent = text;
  $("fehler").classList.toggle("versteckt", !text);
}

function beschreibeBlock(block) {
  if (block.type === "server_tool_use") {
    if (block.name === "web_search") log(`🔎 Suche: ${block.input?.query ?? ""}`);
    else if (block.name === "web_fetch") log(`🌐 Rufe ab: ${block.input?.url ?? ""}`);
  } else if (block.type === "web_search_tool_result") {
    const c = block.content;
    if (Array.isArray(c)) log(`   ✓ ${c.length} Treffer`, true);
    else log(`   ⚠ Suche fehlgeschlagen (${c?.error_code ?? "unbekannt"})`);
  } else if (block.type === "web_fetch_tool_result") {
    const c = block.content;
    if (c?.type === "web_fetch_result") log(`   ✓ Seite gelesen`, true);
    else log(`   ⚠ Abruf blockiert/fehlgeschlagen (${c?.error_code ?? "unbekannt"}) – nutze andere Quellen`);
  } else if (block.type === "fallback") {
    log(`ℹ️ Anfrage wurde auf ${block.to?.model ?? "ein anderes Modell"} umgeleitet`);
  }
}

// ---------- Analyse ----------
async function starteAnalyse() {
  fehler("");
  const apiKey = lese(KEY_SPEICHER, "");
  if (!apiKey) { fehler("Bitte zuerst oben in den Einstellungen deinen Anthropic API-Schlüssel speichern."); $("einstellungen-details").open = true; return; }

  const link = $("link").value.trim();
  const text = $("text").value.trim();
  const files = [...$("dateien").files];
  if (!link && !text && !files.length) { fehler("Bitte einen Link, den Anzeigentext oder ein Exposé angeben."); return; }
  const gesamtGroesse = files.reduce((s, f) => s + f.size, 0);
  if (gesamtGroesse > 24 * 1024 * 1024) { fehler("Die Dateien sind zusammen zu groß (max. ca. 24 MB). Bitte weniger oder kleinere Dateien wählen."); return; }

  const ziel = $("ziel").value;
  const eigenkapital = $("ek").value.trim();

  let bloecke;
  try { bloecke = await Promise.all(files.map(dateiZuBlock)); } catch (e) { fehler(e.message); return; }
  bloecke.push({ type: "text", text: userPrompt({ link, text, ziel, eigenkapital, notizen: $("notizen").value.trim(), dateinamen: files.map((f) => f.name) }) });

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
  const messages = [{ role: "user", content: bloecke }];
  const heute = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });

  setzeLaeuft(true);
  $("log").innerHTML = "";
  $("denken").textContent = "";
  log(link ? `Starte Analyse für ${link}` : "Starte Analyse");

  const textTeile = [];
  try {
    for (let runde = 0; runde < 6; runde++) {
      const stream = client.beta.messages.stream({
        model: MODELL,
        max_tokens: 64000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "high" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: systemPrompt(heute),
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 20, user_location: { type: "approximate", country: "DE", timezone: "Europe/Berlin" } },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
        ],
        messages,
      });
      laufenderStream = stream;
      let textLaenge = 0;
      stream.on("thinking", (delta) => {
        const el = $("denken");
        el.textContent = (el.textContent + delta).slice(-1200);
        el.scrollTop = el.scrollHeight;
      });
      stream.on("text", (delta) => {
        textLaenge += delta.length;
        $("status").textContent = `Schreibe Bericht … (${Math.round(textLaenge / 100) / 10}k Zeichen)`;
      });
      stream.on("contentBlock", beschreibeBlock);

      const antwort = await stream.finalMessage();
      for (const b of antwort.content) if (b.type === "text") textTeile.push(textMitQuellen(b));

      if (antwort.stop_reason === "pause_turn") {
        // Server-Tools brauchen mehr Zeit: Antwort zurückgeben und weiterlaufen lassen
        messages.push({ role: "assistant", content: antwort.content });
        log("… recherchiere weiter");
        continue;
      }
      if (antwort.stop_reason === "refusal") throw new Error("Die KI hat die Anfrage abgelehnt. Bitte Eingaben prüfen und erneut versuchen.");
      if (antwort.stop_reason === "max_tokens") log("⚠ Bericht wurde wegen Längenlimit abgeschnitten.");
      break;
    }
    const voll = textTeile.join("");
    if (!voll.trim()) throw new Error("Die KI hat keinen Bericht geliefert. Bitte erneut versuchen.");
    const { bericht, daten } = trenneJson(voll);
    aktuell = {
      id: Date.now(),
      datum: new Date().toISOString(),
      titel: daten?.titel || ersteUeberschrift(bericht) || link || "Objekt",
      link,
      bericht,
      daten,
      finanz: { eigenkapital: num(eigenkapital) || null, zins_prozent: daten?.bauzins_prozent ?? 3.8, tilgung_prozent: 2 },
    };
    speichereAktuell();
    zeigeErgebnis();
    log("✅ Fertig", true);
  } catch (e) {
    if (abgebrochen || e instanceof Anthropic.APIUserAbortError) fehler("Analyse abgebrochen.");
    else if (e instanceof Anthropic.AuthenticationError) fehler("API-Schlüssel ungültig. Bitte in den Einstellungen prüfen.");
    else if (e instanceof Anthropic.PermissionDeniedError) fehler("Der API-Schlüssel hat keine Berechtigung (z. B. Websuche in der Console nicht freigeschaltet).");
    else if (e instanceof Anthropic.RateLimitError) fehler("Zu viele Anfragen oder Guthaben aufgebraucht. Bitte kurz warten bzw. Guthaben in der Anthropic Console prüfen.");
    else if (e instanceof Anthropic.APIConnectionError) fehler("Keine Verbindung zur KI. Bitte Internetverbindung prüfen.");
    else if (e instanceof Anthropic.APIError) fehler(`Fehler der KI-Schnittstelle (${e.status ?? "?"}): ${e.message}`);
    else fehler(e.message || String(e));
  } finally {
    laufenderStream = null;
    abgebrochen = false;
    setzeLaeuft(false);
  }
}

// Quellen der Websuche als kleine Links hinter den zitierten Text hängen
function textMitQuellen(block) {
  const urls = [...new Set((block.citations || []).map((c) => c.url).filter(Boolean))];
  if (!urls.length) return block.text;
  return block.text + urls.map((u) => ` [↗](${u})`).join("");
}

function trenneJson(text) {
  const treffer = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!treffer.length) return { bericht: text, daten: null };
  const letzter = treffer[treffer.length - 1];
  let daten = null;
  try { daten = JSON.parse(letzter[1]); } catch { /* Rechner bleibt dann leer */ }
  const bericht = (text.slice(0, letzter.index) + text.slice(letzter.index + letzter[0].length)).trim();
  return { bericht, daten };
}
function ersteUeberschrift(md) { return md.match(/^#\s+(.+)$/m)?.[1]?.trim(); }

function setzeLaeuft(an) {
  $("start").disabled = an;
  $("stopp").classList.toggle("versteckt", !an);
  $("fortschritt").classList.remove("versteckt");
  $("spinner").classList.toggle("versteckt", !an);
  $("status").textContent = an ? "Analyse läuft – KI liest das Inserat und recherchiert …" : "Analyse beendet";
  if (an) $("ergebnis").classList.add("versteckt");
}

$("start").onclick = starteAnalyse;
$("stopp").onclick = () => { abgebrochen = true; laufenderStream?.abort(); };

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
  rechne();
  $("ergebnis").scrollIntoView({ behavior: "smooth" });
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
  speichereAktuell();
});
for (const id of ["f-ek", "f-zins", "f-tilg", "f-stress"]) $(id).addEventListener("change", () => { rechne(); speichereAktuell(); });

function zeigeUeberblick(r) {
  const d = aktuell.daten || {};
  const farbe = { gruen: "var(--gruen)", gelb: "var(--gelb)", rot: "var(--rot)" }[d.ampel] || "var(--muted)";
  const markt = d.markt_kaufpreis_m2;
  const marktText = markt?.min && markt?.max ? `${eur(markt.min)} – ${eur(markt.max)}` : "–";
  const esc = (s) => DOMPurify.sanitize(String(s ?? ""), { ALLOWED_TAGS: [] });
  $("ueberblick").innerHTML = `
    <div class="ampel">
      <div class="punkt" style="background:${farbe}">${d.score ?? "?"}</div>
      <div>
        <h2 style="margin:0">${esc(aktuell.titel)}</h2>
        <div class="hinweis">${esc([d.objektart, d.ort, d.baujahr && "Bj. " + d.baujahr].filter(Boolean).join(" · "))}${aktuell.link ? ` · <a href="${esc(aktuell.link)}" target="_blank" rel="noopener">Inserat</a>` : ""}</div>
        ${d.empfehlung ? `<div style="margin-top:4px"><b>${esc(d.empfehlung)}</b></div>` : ""}
      </div>
    </div>
    ${r ? `<div class="kpis">
      <div class="kpi"><b>${eur(d.verhandlungsziel)}</b><span>Verhandlungsziel</span></div>
      <div class="kpi"><b>${eur(r.preisM2)}</b><span>Preis/m² (Markt ${marktText})</span></div>
      <div class="kpi"><b>${pct(r.bruttorendite)}</b><span>Bruttorendite (realistisch)</span></div>
      <div class="kpi"><b>${dez(r.faktor)}</b><span>Kaufpreisfaktor</span></div>
      <div class="kpi"><b class="${r.cashflowMonat < 0 ? "neg" : "pos"}">${eur(r.cashflowMonat)}</b><span>Cashflow/Monat (realistisch)</span></div>
      <div class="kpi"><b>${eur(r.ekFuerCashflow0)}</b><span>Eigenkapital für Cashflow 0</span></div>
    </div>` : `<p class="hinweis">Für den Rechner fehlten strukturierte Zahlen – siehe Bericht.</p>`}`;
}

// ---------- Aktionen ----------
$("drucken").onclick = () => window.print();
$("kopieren").onclick = async () => {
  try { await navigator.clipboard.writeText(aktuell.bericht); $("kopieren").textContent = "✓ Kopiert"; } catch { $("kopieren").textContent = "Kopieren nicht möglich"; }
  setTimeout(() => ($("kopieren").textContent = "Bericht kopieren (Markdown)"), 2000);
};
$("neu").onclick = () => {
  $("ergebnis").classList.add("versteckt");
  $("fortschritt").classList.add("versteckt");
  for (const id of ["link", "text", "notizen"]) $(id).value = "";
  $("dateien").value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ---------- Verlauf ----------
function speichereAktuell() {
  if (!aktuell) return;
  let liste = lese(VERLAUF_SPEICHER, []).filter((e) => e.id !== aktuell.id);
  liste.unshift(aktuell);
  liste = liste.slice(0, 25);
  while (liste.length && !schreibe(VERLAUF_SPEICHER, liste)) liste.pop(); // Speicher voll: älteste entfernen
  zeigeVerlauf();
}
function zeigeVerlauf() {
  const liste = lese(VERLAUF_SPEICHER, []);
  const box = $("verlauf");
  if (!liste.length) { box.innerHTML = `<p class="hinweis">Noch keine.</p>`; return; }
  box.innerHTML = "";
  for (const e of liste) {
    const zeile = document.createElement("div");
    zeile.className = "verlauf-eintrag";
    const a = document.createElement("a");
    a.textContent = `${{ gruen: "🟢", gelb: "🟡", rot: "🔴" }[e.daten?.ampel] ?? "⚪"} ${e.titel}`;
    a.onclick = () => { aktuell = e; zeigeErgebnis(); };
    const rechts = document.createElement("span");
    rechts.className = "hinweis";
    rechts.textContent = new Date(e.datum).toLocaleDateString("de-DE") + " ";
    const x = document.createElement("a");
    x.textContent = "löschen";
    x.onclick = () => { schreibe(VERLAUF_SPEICHER, lese(VERLAUF_SPEICHER, []).filter((v) => v.id !== e.id)); zeigeVerlauf(); };
    rechts.appendChild(x);
    zeile.append(a, rechts);
    box.appendChild(zeile);
  }
}

zeigeKeyStatus();
zeigeVerlauf();
