# HausOps Immobilien

Verwaltung vermieteter Immobilien (angelehnt an den Funktionsumfang von immocloud) mit Ferienwohnungs-Modul.
Läuft als eigenständige Web-App unter **`/immo/`** auf derselben Netlify-Seite wie Livora Clean. Die bestehende App bleibt unverändert.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Objekte & Einheiten** | Häuser, ETW, Garagenhöfe mit Adresse, Baujahr, Kaufpreis und AfA-Basis. Einheiten: Wohnung, Haus, Gewerbe, **Garage**, **Stellplatz**, **Ferienwohnung**, jeweils mit Fläche, Zimmern, Lage, Zählern und Ausstattung |
| **Mieter & Verträge** | Mieter mit IBAN(s), Verträge mit Kaltmiete, NK-Vorauszahlung, Zuschlägen und Kaution, dazu **Mietanpassungen** (Erhöhung, Staffel, Index) ab einem Stichmonat |
| **Bank** | Import von **CSV** (alle deutschen Banken, Spalten werden automatisch erkannt) und **CAMT.053 (XML)**. Duplikate werden erkannt |
| **Automatische Zuordnung** | Mieteingänge werden über Mieter-IBAN, Name, Betrag (= Warmmiete), Einheit im Verwendungszweck und **gelernte Regeln** erkannt. Der Soll-Monat kommt aus dem Verwendungszweck („Miete 11/2026“, „Dezember“), sonst gilt: Zahlung ab dem 20. zählt für den Folgemonat. Ausgaben (Stadtwerke, Grundsteuer, Versicherung, Zinsen …) erkennt die App über Stichwörter und Regeln |
| **Mieteingänge** | Soll/Ist je Monat, Jahresmatrix (✓ / ½ / ✗), Rückstände, Barzahlungen |
| **Ausgaben** | Werbungskosten nach Kategorien, je Objekt, aus Bankumsätzen oder manuell (bar/Karte) |
| **Ferienwohnung** | Belegungskalender, Buchungen mit Kanal (Airbnb, Booking …), Prüfung auf Überschneidungen, **Smoobu-Import** über die vorhandene Netlify-Function |
| **Rechnungen** | Fortlaufende Nummern (`RE-2026-0001`), 7 % USt auf Übernachtung und Endreinigung, 19 % auf Extras, **Kurtaxe als durchlaufender Posten**, Kleinunternehmer-Option (§ 19 UStG), Pflichtangaben nach § 14 UStG, Druck/PDF, Storno mit Stornorechnung, Zahlungsstatus |
| **Steuer** | **Anlage-V-Zusammenstellung** je Objekt (Zuflussprinzip, AfA automatisch zeitanteilig) |
| **DATEV** | **DATEV-Buchungsstapel (EXTF 700, Windows-1252)** für Monat, Quartal oder Jahr, SKR 03/04, Konten anpassbar. Dazu Buchungsliste (Excel) und druckbarer Monatsbericht für den Steuerberater |
| **Daten** | Speicherung lokal im Browser. Sicherung/Wiederherstellung als JSON-Datei, Demo-Daten zum Ausprobieren |

## Nutzung

1. Netlify-Seite öffnen: `https://<deine-seite>/immo/`. Lokal geht es z. B. mit `python3 -m http.server` im Repo-Root und dann http://localhost:8000/immo/.
2. **Einstellungen**: Name, Anschrift, Steuernummer und IBAN für Rechnungen eintragen, außerdem Berater- und Mandantennummer für DATEV und den Kontenrahmen.
3. Objekte → Einheiten → Mieter → Mietverträge anlegen. Für die automatische Zuordnung die **IBAN des Mieters** eintragen.
4. **Bank**: Konto anlegen und im Online-Banking „Umsätze exportieren“ (CSV oder CAMT.053) wählen, Datei importieren, Vorschläge mit ✓ bestätigen. „Regel merken“ sorgt dafür, dass derselbe Zahler beim nächsten Mal automatisch zugeordnet wird.
5. **Steuer & DATEV**: Monat wählen, „DATEV-Buchungsstapel“ und „Bericht drucken“ an den Steuerberater schicken.

## Wichtige Hinweise

- Die **Konten-Vorschläge** (SKR 03: Bank 1200, Mieterlöse steuerfrei 8100, Erlöse 7 % 8300, durchlaufende Posten 1590 …) bitte einmal mit dem Steuerberater abstimmen. Ändern kannst du sie unter Einstellungen.
- Der DATEV-Export nutzt die ersten 14 Standardspalten des Buchungsstapels. Bitte beim ersten Mal vom Steuerberater einen Testimport machen lassen.
- Die Anlage V ist eine **Zusammenstellung, keine Steuerberatung**. Ferienwohnungen mit hotelähnlichen Leistungen können gewerblich sein. Bei Regelbesteuerung kommt die USt-Voranmeldung dazu.
- Die Daten liegen **nur im Browser**. Bitte regelmäßig unter Einstellungen → Datensicherung sichern.

## Nächste Ausbaustufen

1. **Live-Bankanbindung** (PSD2 über einen lizenzierten Kontoinformationsdienst wie finAPI, Tink oder Salt Edge, oder FinTS mit DK-Produktregistrierung) als Netlify-Function, die die Umsätze dann automatisch statt per Datei abholt. Das braucht einen Vertrag oder eine Registrierung beim Anbieter.
2. **Cloud-Sync** über Supabase (wie bei Livora Clean), damit die Daten auf mehreren Geräten verfügbar sind und ein Login möglich ist.
3. **Nebenkostenabrechnung** mit Umlageschlüsseln (Fläche, Personen, Verbrauch).
4. **Belege hochladen** (Foto/PDF) mit Weitergabe an DATEV Unternehmen online.
5. **E-Rechnung (XRechnung/ZUGFeRD)** für Geschäftskunden (Pflicht für alle ab 2028).

## Entwicklung

Kein Build-Schritt nötig: reines HTML/CSS/JavaScript (ES-Module).

```
immo/
  index.html, styles.css
  js/core.js    Fachlogik: Zuordnung, Soll/Ist, Rechnungen, AfA, Anlage V, DATEV, CSV/CAMT
  js/store.js   Speicherung, Sicherung, Demo-Daten
  js/app.js     Oberfläche
  tests/        node --test (npm test)
```
