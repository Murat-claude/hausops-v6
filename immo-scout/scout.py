#!/usr/bin/env python3
"""Immo-Scout: tägliche Suche nach Anlage-Immobilien im Umkreis von 30 km um Hamm.

Zurückhaltend und ehrlich: eigener User-Agent, eine Seite je Kategorie (neueste zuerst),
2 Sekunden Pause zwischen Abrufen, nur von robots.txt erlaubte Pfade.

Aufrufe:
  python3 immo-scout/scout.py suche     -> lädt neue Anzeigen, schreibt immo-scout/heute.json + heute.md
  python3 immo-scout/scout.py detail N  -> lädt die Detailseiten der N besten neuen Kandidaten (max. 12)
  python3 immo-scout/scout.py merken    -> übernimmt heute.json in gesehen.json (nach dem Bericht aufrufen)
"""
import html
import json
import re
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

BASIS = Path(__file__).resolve().parent
UA = "immo-scout/1.0 (private taegliche Objektsuche, wenige Abrufe)"
ORT = "hamm"
ORT_ID = "l2018r30"  # Hamm, Umkreis 30 km
SUCHEN = [
    ("Mehrfamilienhaus", f"s-haus-kaufen/{ORT}/sortierung:neuste/c208{ORT_ID}+haus_kaufen.haustyp_s:mehrfamilienhaus"),
    ("Haus", f"s-haus-kaufen/{ORT}/sortierung:neuste/c208{ORT_ID}"),
    ("Eigentumswohnung", f"s-eigentumswohnung/{ORT}/sortierung:neuste/c196{ORT_ID}"),
    ("Grundstück", f"s-grundstuecke-garten/{ORT}/sortierung:neuste/c207{ORT_ID}"),
    ("Gewerbe", f"s-gewerbeimmobilien/{ORT}/sortierung:neuste/kaufen/k0c277{ORT_ID}"),
    ("Garage", f"s-garage-lagerraum/{ORT}/sortierung:neuste/garage-kaufen/k0c197{ORT_ID}"),
    ("Sanierungsobjekt", f"s-haus-kaufen/{ORT}/sortierung:neuste/sanierungsbeduerftig/k0c208{ORT_ID}"),
    ("Wohnung möbliert (FeWo-Idee)", f"s-mietwohnung/{ORT}/sortierung:neuste/moebliert/k0c203{ORT_ID}"),
]
MIETE_SCHAETZUNG = 7.5  # €/m² kalt, grobe Annahme für den Schnell-Faktor (Raum Hamm/Unna/Soest)
AUSSCHLUSS = ["neubau", "bauen sie", "hausbau", "massa", "town & country", "fertighaus", "wir suchen",
              "gesucht", "ankauf", "kostenlose vermarktung", "zu verkaufen?", "bauträger"]


def hole(pfad):
    req = urllib.request.Request(f"https://www.kleinanzeigen.de/{pfad.lstrip('/')}", headers={"User-Agent": UA, "Accept-Language": "de-DE"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def zahl(s):
    m = re.search(r"(\d[\d.]*(?:,\d+)?)", s or "")
    try:
        return float(m.group(1).replace(".", "").replace(",", ".")) if m else None
    except ValueError:
        return None


def parse_liste(seite, kategorie):
    treffer = []
    for a in re.findall(r"(<article .*?</article>)", seite, re.S):
        href = re.search(r'data-href="([^"]+)"', a)
        if not href:
            continue
        ld = re.search(r'(\{"creditText".*?\})\s*<', a, re.S)
        beschreibung = ""
        if ld:
            try:
                beschreibung = json.loads(html.unescape(ld.group(1))).get("description", "")
            except ValueError:
                pass
        text = re.sub(r"<script.*?</script>", "", a, flags=re.S)
        zeilen = [z.strip() for z in html.unescape(re.sub(r"<[^>]+>", "\n", text)).split("\n") if z.strip()]
        km = next((z for z in zeilen if re.fullmatch(r"\((ca\. )?\d+ km\)", z)), "")
        i = zeilen.index(km) if km else 0
        preis = next((z for z in zeilen if "€" in z or z == "VB"), "")
        groesse = next((z for z in zeilen if re.search(r"m²|Zi\.", z) and len(z) < 40), "")
        treffer.append({
            "id": re.search(r"/(\d+)-\d+-\d+$", href.group(1)).group(1) if re.search(r"/(\d+)-\d+-\d+$", href.group(1)) else href.group(1),
            "kategorie": kategorie,
            "titel": zeilen[i + 1] if km and i + 1 < len(zeilen) else "",
            "ort": zeilen[i - 1] if km else "",
            "km": int(re.sub(r"\D", "", km)) if km else None,
            "preis_text": preis,
            "groesse_text": groesse,
            "beschreibung": beschreibung[:500],
            "url": "https://www.kleinanzeigen.de" + href.group(1),
        })
    return treffer


def bewerte(o):
    p, a = zahl(o["preis_text"]), zahl(o["groesse_text"])
    t = (o["titel"] + " " + o["beschreibung"]).lower()
    o["preis"], o["flaeche"] = p, a
    o["preis_m2"] = round(p / a) if p and a and "€/m²" not in o["groesse_text"] else None
    o["faktor_geschaetzt"] = round(p / (a * MIETE_SCHAETZUNG * 12), 1) if o["preis_m2"] and o["kategorie"] not in ("Grundstück", "Garage", "Gewerbe", "Wohnung möbliert (FeWo-Idee)") else None
    m = re.search(r"faktor\s*(\d+[,.]?\d*)", t)
    if m:
        o["faktor_inserat"] = float(m.group(1).replace(",", "."))
    m = re.search(r"(\d+[,.]?\d*)\s*%\s*(miet)?rendite", t)
    if m:
        o["rendite_inserat"] = float(m.group(1).replace(",", "."))
    punkte = 0
    if o["faktor_geschaetzt"] is not None:
        punkte += 3 if o["faktor_geschaetzt"] <= 12 else 2 if o["faktor_geschaetzt"] <= 15 else 1 if o["faktor_geschaetzt"] <= 18 else 0
    if re.search(r"vermietet|mieteinnahm|rendite|kapitalanlage|wohneinheiten|mehrfamilien", t):
        punkte += 1
    if re.search(r"sanier|renovier|handwerker|modernisierungsbed", t):
        punkte += 1
    if o["kategorie"] == "Grundstück" and re.search(r"baugenehmigung|genehmigt|§\s*34|bebauungsplan", t):
        punkte += 2
    o["punkte"] = punkte
    kauf = o["kategorie"] not in ("Garage", "Wohnung möbliert (FeWo-Idee)")
    miete = "€/m²" in o["preis_text"] + o["groesse_text"] or "miete" in (o["preis_text"] + o["titel"]).lower() or "zu vermieten" in t
    o["ausschluss"] = (any(w in t for w in AUSSCHLUSS) or (o["km"] is not None and o["km"] > 32) or not p
                       or (kauf and (p < 30000 or miete)))
    return o


def suche():
    gesehen = set(json.loads((BASIS / "gesehen.json").read_text())) if (BASIS / "gesehen.json").exists() else set()
    alle, fehler = {}, []
    for kategorie, pfad in SUCHEN:
        try:
            for o in parse_liste(hole(pfad), kategorie):
                alle.setdefault(o["id"], bewerte(o))
        except Exception as e:  # eine Kategorie darf ausfallen
            fehler.append(f"{kategorie}: {e}")
        time.sleep(2)
    neu = [o for o in alle.values() if o["id"] not in gesehen and not o["ausschluss"]]
    neu.sort(key=lambda o: (-o["punkte"], o["preis_m2"] or 99999))
    (BASIS / "heute.json").write_text(json.dumps({"datum": date.today().isoformat(), "fehler": fehler, "neu": neu, "alle_ids": list(alle)}, ensure_ascii=False, indent=1))
    zeilen = [f"# Neue Anzeigen {date.today():%d.%m.%Y} ({len(neu)} neu, {len(alle)} gesichtet)", ""]
    if fehler:
        zeilen += ["Abruf-Fehler: " + "; ".join(fehler), ""]
    for o in neu:
        f = o.get("faktor_inserat") or o["faktor_geschaetzt"]
        zeilen.append(f"- [{o['punkte']}] {o['kategorie']} | {o['km']} km {o['ort']} | {o['titel'][:80]} | {o['groesse_text']} | {o['preis_text']} | "
                      f"{o['preis_m2'] or '-'} €/m² | Faktor ~{f or '-'} | {o['url']}")
    (BASIS / "heute.md").write_text("\n".join(zeilen) + "\n")
    print("\n".join(zeilen[:60]))


def detail(n):
    daten = json.loads((BASIS / "heute.json").read_text())
    for o in daten["neu"][: min(n, 12)]:
        try:
            s = hole(o["url"].replace("https://www.kleinanzeigen.de", ""))
        except Exception as e:
            print(f"===== {o['url']}\nFehler: {e}\n")
            continue
        t = html.unescape(re.sub(r"<script.*?</script>|<style.*?</style>", " ", s, flags=re.S))
        t = re.sub(r"<[^>]+>", "\n", t)
        t = re.sub(r"[ \t]+", " ", t)
        t = re.sub(r"\n\s*\n+", "\n", t)
        i = max(t.find(o["titel"][:40], t.find("Suche im Umkreis")), 0) if o["titel"] else 0
        ende = [k for k in (t.find("Nachricht schreiben", i), t.find("Anzeigennr", i), t.find("Ähnliche Anzeigen", i)) if k > i]
        print(f"===== {o['titel']} | {o['url']}\n" + t[i: min(ende) if ende else i + 4500][:4500].replace("\n", " | ") + "\n")
        time.sleep(2)


def merken():
    daten = json.loads((BASIS / "heute.json").read_text())
    pfad = BASIS / "gesehen.json"
    gesehen = set(json.loads(pfad.read_text())) if pfad.exists() else set()
    gesehen.update(daten["alle_ids"])
    pfad.write_text(json.dumps(sorted(gesehen)))
    print(f"{len(gesehen)} Anzeigen gemerkt")


if __name__ == "__main__":
    befehl = sys.argv[1] if len(sys.argv) > 1 else "suche"
    if befehl == "suche":
        suche()
    elif befehl == "detail":
        detail(int(sys.argv[2]) if len(sys.argv) > 2 else 8)
    elif befehl == "merken":
        merken()
    else:
        sys.exit(__doc__)
