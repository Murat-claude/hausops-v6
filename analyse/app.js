import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm";
import { systemPrompt, userPrompt } from "./prompt.js";
import { rechneSzenario, maxKaufpreisCashflowNull, num } from "./rechner.js";

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

// ---------- Ablage: Dateien, Screenshots, Einfügen, Hineinziehen ----------
// Jeder Anhang: { name, art: "bild"|"pdf", media_type, data (base64), vorschau }
let anhaenge = [];
const MAX_KANTE = 2000; // Bilder werden verkleinert, das spart Zeit und Kosten

function leseDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

async function bildVorbereiten(file) {
  // In JPEG umwandeln und verkleinern (auch HEIC von iPhones, sofern der Browser es lesen kann)
  try {
    const bmp = await createImageBitmap(file);
    const f = Math.min(1, MAX_KANTE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * f);
    c.height = Math.round(bmp.height * f);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.85);
    return { media_type: "image/jpeg", data: url.split(",")[1], vorschau: url };
  } catch {
    const url = await leseDataUrl(file);
    const typ = url.slice(5, url.indexOf(";"));
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(typ)) throw new Error(`Bildformat nicht lesbar: ${file.name}`);
    return { media_type: typ, data: url.split(",")[1], vorschau: url };
  }
}

async function dateienHinzufuegen(liste) {
  for (const file of liste) {
    try {
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        const url = await leseDataUrl(file);
        anhaenge.push({ name: file.name, art: "pdf", media_type: "application/pdf", data: url.split(",")[1] });
      } else if (file.type.startsWith("image/") || /\.(heic|heif|png|jpe?g|webp|gif)$/i.test(file.name)) {
        anhaenge.push({ name: file.name || "Screenshot", art: "bild", ...(await bildVorbereiten(file)) });
      } else {
        fehler(`Dateityp nicht unterstützt: ${file.name}`);
      }
    } catch (e) {
      fehler(e.message);
    }
  }
  zeigeAnhaenge();
}

function zeigeAnhaenge() {
  const box = $("anhaenge");
  box.innerHTML = "";
  anhaenge.forEach((a, i) => {
    const d = document.createElement("div");
    d.className = "anhang";
    if (a.art === "bild") {
      const img = document.createElement("img");
      img.src = a.vorschau;
      img.alt = a.name;
      d.appendChild(img);
    } else {
      d.textContent = "📄 " + a.name;
    }
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = "Entfernen";
    x.onclick = () => { anhaenge.splice(i, 1); zeigeAnhaenge(); };
    d.appendChild(x);
    box.appendChild(d);
  });
  const mb = anhaenge.reduce((s, a) => s + a.data.length * 0.75, 0) / 1024 / 1024;
  $("ablage-info").textContent = anhaenge.length ? `${anhaenge.length} Anhang/Anhänge · ${mb.toFixed(1)} MB` : "";
}

function anhangZuBlock(a) {
  return a.art === "pdf"
    ? { type: "document", source: { type: "base64", media_type: a.media_type, data: a.data }, title: a.name }
    : { type: "image", source: { type: "base64", media_type: a.media_type, data: a.data } };
}

function findeLinks(text) {
  return [...new Set((text.match(/https?:\/\/[^\s<>"')]+/g) || []).map((u) => u.replace(/[.,;]+$/, "")))];
}

$("datei-knopf").onclick = () => $("dateien").click();
$("dateien").onchange = (e) => { dateienHinzufuegen([...e.target.files]); e.target.value = ""; };
document.addEventListener("paste", (e) => {
  const dateien = [...(e.clipboardData?.files || [])];
  if (dateien.length) { e.preventDefault(); dateienHinzufuegen(dateien); }
});
const ablage = $("ablage");
["dragenter", "dragover"].forEach((t) => ablage.addEventListener(t, (e) => { e.preventDefault(); ablage.classList.add("ziehen"); }));
["dragleave", "drop"].forEach((t) => ablage.addEventListener(t, () => ablage.classList.remove("ziehen")));
ablage.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) dateienHinzufuegen([...e.dataTransfer.files]);
  else {
    const t = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (t) $("text").value += ($("text").value ? "\n" : "") + t;
  }
});

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

  const text = $("text").value.trim();
  const links = findeLinks(text);
  const link = links[0] || "";
  if (!text && !anhaenge.length) { fehler("Bitte einen Link, Text, Screenshots oder ein Exposé reinlegen."); return; }
  const gesamtGroesse = anhaenge.reduce((s, a) => s + a.data.length * 0.75, 0);
  if (gesamtGroesse > 24 * 1024 * 1024) { fehler("Die Anhänge sind zusammen zu groß (max. ca. 24 MB). Bitte weniger oder kleinere Dateien wählen."); return; }

  const ziel = $("ziel").value;
  const eigenkapital = $("ek").value.trim();
  const modus = $("modus").value;
  const schnell = modus === "schnell";

  const bloecke = anhaenge.map(anhangZuBlock);
  bloecke.push({ type: "text", text: userPrompt({ links, text, ziel, eigenkapital, notizen: $("notizen").value.trim(), dateinamen: anhaenge.map((a) => a.name), modus }) });

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
        output_config: { effort: schnell ? "low" : "high" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: systemPrompt(heute),
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: schnell ? 5 : 20, user_location: { type: "approximate", country: "DE", timezone: "Europe/Berlin" } },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: schnell ? 4 : 10 },
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
      // Ohne Angabe: 25 % des Kaufpreises als Eigenkapital annehmen
      finanz: { eigenkapital: num(eigenkapital) || (daten?.kaufpreis ? Math.round(daten.kaufpreis * 0.25) : null), zins_prozent: daten?.bauzins_prozent ?? 4.0, tilgung_prozent: 2 },
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
  zeigeStrategien();
  rechne();
  $("ergebnis").scrollIntoView({ behavior: "smooth" });
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
      <div class="kpi"><b class="${r.maxKpCf0 >= num(d.kaufpreis) ? "pos" : "neg"}">${eur(r.maxKpCf0)}</b><span>Max. Kaufpreis für Cashflow ≥ 0 (bei ${eur(r.eigenkapital)} EK)</span></div>
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
  for (const id of ["text", "notizen"]) $(id).value = "";
  anhaenge = [];
  zeigeAnhaenge();
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
