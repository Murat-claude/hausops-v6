# HausOps Immobilien

Verwaltung vermieteter Immobilien (angelehnt an den Funktionsumfang von immocloud) mit Ferienwohnungs-Modul.
Läuft als eigenständige Web-App unter **`/immo/`** auf derselben Netlify-Seite wie Livora Clean. Die bestehende App bleibt unverändert.

> **Rechtliches:** Welche gesetzlichen Regeln die App prüft (Mietrecht, Betriebskosten, CO2-Aufteilung, Umsatzsteuer bei Stellplätzen, GoBD, DSGVO, Verbraucherrecht beim Verkauf), mit Mustertexten und offenen Punkten, steht in [`RECHTLICHES.md`](RECHTLICHES.md).

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Objekte & Einheiten** | Häuser, ETW, Garagenhöfe mit Adresse, Baujahr, Kaufpreis und AfA-Basis. Einheiten: Wohnung, Haus, Gewerbe, **Garage**, **Stellplatz**, **Ferienwohnung**, jeweils mit Fläche, Zimmern, Lage, Zählern und Ausstattung |
| **Mieter & Verträge** | **Belegung je Einheit** (aktueller Mieter, seit wann, Auszug geplant, Nachmieter). Der **Assistent für Einzug und Mieterwechsel** erfasst Mietende, Rückgabe, Schlüssel, Zählerstände, Kaution und Mängel des Vormieters sowie Stammdaten, Mitmieter, IBAN, Personen, Mietbeginn, Miete, Kaution und Zählerstände des Nachmieters. Er prüft, dass sich die Verträge nicht überschneiden, und zeigt Leerstandstage. Danach: **Übergabeprotokoll** (Einzug/Auszug) zum Drucken, Wohnungsgeberbestätigung, Kautions-/Auszugsbrief. Die **Mieterakte** enthält Mietkonto, Kaution, Vertragshistorie, Zahlungen, Zählerstände, NK-Abrechnungen, Dokumente und Briefe. Dazu Mietanpassungen ab einem Stichmonat |
| **Bank** | Import von **CSV** (alle deutschen Banken, Spalten werden automatisch erkannt) und **CAMT.053 (XML)**. Duplikate werden erkannt |
| **Automatische Zuordnung** | Mieteingänge werden über Mieter-IBAN, Name, Betrag (= Warmmiete), Einheit im Verwendungszweck und **gelernte Regeln** erkannt. Der Soll-Monat kommt aus dem Verwendungszweck („Miete 11/2026“, „Dezember“), sonst gilt: Zahlung ab dem 20. zählt für den Folgemonat. Ausgaben (Stadtwerke, Grundsteuer, Versicherung, Zinsen …) erkennt die App über Stichwörter und Regeln |
| **Mieteingänge** | Soll/Ist je Monat, Jahresmatrix (✓ / ½ / ✗), Rückstände, Barzahlungen |
| **Ausgaben** | Werbungskosten nach Kategorien, je Objekt, aus Bankumsätzen oder manuell (bar/Karte) |
| **Ferienwohnung** | Belegungskalender inkl. Eigennutzung, Buchungen mit Kanal (Airbnb, Booking …), Prüfung auf Überschneidungen, **Smoobu-Import** über die vorhandene Netlify-Function. Kennzahlen **Auslastung, ADR, RevPAR** mit Vorjahresvergleich, Ø Aufenthaltsdauer, **Stornoquote**, **Direktbuchungsanteil**, Netto-Ertrag. **Reinigungsplan** mit Hinweis auf Wechsel am selben Tag und Auftrag zum Kopieren. **Gäste-Nachrichten** (Bestätigung, 3 Tage vor Anreise, während des Aufenthalts, Abreise/Bewertung). Hinweis auf den **Meldeschein** bei ausländischen Gästen, **Registrierungsnummer** auf Rechnungen |
| **Rechnungen** | Fortlaufende Nummern (`RE-2026-0001`), 7 % USt auf Übernachtung und Endreinigung, 19 % auf Extras, **Kurtaxe als durchlaufender Posten**, Kleinunternehmer-Option (§ 19 UStG), Pflichtangaben nach § 14 UStG, Druck/PDF, Storno mit Stornorechnung, Zahlungsstatus |
| **Nebenkostenabrechnung** | Kostenarten nach § 2 BetrKV, Umlageschlüssel Fläche, Personen(-tage), Einheiten, Verbrauch, **Heizkosten-VO (50–70 % Verbrauch)** oder direkt je Einheit. Abrechnung **tagegenau** bei Mieterwechsel; den Leerstandsanteil trägt der Vermieter. Vorauszahlungen werden aus den echten Zahlungseingängen übernommen. Die App prüft die **12-Monats-Frist** (§ 556 Abs. 3 BGB), schlägt eine neue Vorauszahlung vor und erstellt ein druckbares **Anschreiben** je Mieter mit Hinweis auf Belegeinsicht. Garagen und Stellplätze tragen keine Hauskosten |
| **Belege & Dokumente** | **Foto aufnehmen** (Handykamera), **Dokument scannen** (Kontrastverstärkung zu Schwarz-Weiß), **PDFs/Bilder hochladen** oder per Drag & Drop. Ein Eingangskorb mit Kategorien (Rechnung, Bescheid, Versorgerabrechnung, Mietvertrag, Übergabeprotokoll, Zählerstand …). Belege lassen sich an Ausgaben anhängen, Ausgaben ohne Beleg sind markiert. Gespeichert wird lokal (IndexedDB), die Sicherung kann die Belege enthalten |
| **KI (Claude)** | **Belegerkennung, vermieterfreundlich**: Aussteller, Datum, Betrag, Rechnungsnummer, Kategorie, Zeitraum und Zählerstände werden aus Foto oder PDF gelesen. **Gemischte Rechnungen** (Hausmeister, Heizungsfirma, Aufzug, Versicherung) werden in Positionen zerlegt, jede mit Betriebskostenart und Begründung, ob sie umlagefähig ist. Auf Wunsch wird die Rechnung in mehrere Buchungen aufgeteilt (je Kostenart + nicht umlagefähiger Rest), dazu kommt ein konkreter Tipp, wie mehr umgelegt werden kann. Erkannte Zählerstände lassen sich direkt einer Einheit zuordnen. Beim Buchen schlägt die App vor, den Beleg an eine vorhandene Ausgabe oder einen Bankumsatz zu hängen statt doppelt zu buchen. **KI-Assistent** mit Zugriff auf die App-Daten (Rückstände, Anlage V, NK-Abrechnungen, Ferienwohnung …). **KI-Prüfung** der Nebenkostenabrechnung. **Briefe mit KI** formulieren, umformulieren oder übersetzen |
| **Briefe an Mieter** | Vorlagen: Zahlungserinnerung und Mahnung (mit echten Rückständen), Anpassung der NK-Vorauszahlung (aus der letzten Abrechnung), Ankündigung Ablesung/Handwerker, Mieterhöhung nach § 558 BGB, **Wohnungsgeberbestätigung (§ 19 BMG)**, Mietbescheinigung, Kündigungsbestätigung, freier Brief. Druck/PDF mit Briefkopf, E-Mail, **Briefarchiv** |
| **Nebenkosten-Assistent** | Fragt dich Schritt für Schritt ab: Klausel im Mietvertrag, Zentralheizung, Wasserzähler, Aufzug, Garten, Hausmeister, Waschküche und welche **sonstigen Betriebskosten** im Vertrag stehen (Rauchmelder-Wartung, Dachrinne, E-Check …). Danach geht er alle 17 Kostenarten nach § 2 BetrKV durch: Beträge sind aus den Ausgaben vorbelegt, dazu „Was gehört dazu?“ (umlagefähig, nicht umlagefähig, **vermieterfreundliche Tipps**). Er weist auf übersehene umlagefähige Anteile in deinen Ausgaben hin. **🔎 Im Internet prüfen**: Die KI recherchiert per Web-Suche aktuelle Rechtsprechung mit Quellen, einzeln je Kostenart oder als Gesamtcheck. Verbrauchswerte kommen aus den Zählerständen |
| **Steuer** | **Anlage-V-Zusammenstellung** je Objekt (Zuflussprinzip, AfA automatisch zeitanteilig) mit Aufteilung bei **Miteigentum** |
| **Jahrespaket Steuerberater** | Querformat-PDF mit Deckblatt, Übersicht, **Monatstabellen je Einheit** (Kalt/NK/FeWo), Werbungskosten, separat markierten **Anschaffungs-/Herstellungskosten**, Nebenkostenabrechnungen, **Beleg-Checkliste** (fehlende Belege markiert) und **offenen Fragen** (unzugeordnete Umsätze, fehlende AfA-Daten, überlappende Mietverträge, Einordnung der Ferienwohnung) |
| **DATEV** | **DATEV-Buchungsstapel (EXTF 700, Windows-1252)** für Monat, Quartal oder Jahr, SKR 03/04, Konten anpassbar. Dazu Buchungsliste (Excel) und druckbarer Monatsbericht für den Steuerberater |
| **Daten** | Speicherung lokal im Browser. Sicherung/Wiederherstellung als JSON-Datei, Demo-Daten zum Ausprobieren |

## Mehrbenutzer-Betrieb (SaaS) mit Admin-Bereich

Die App läuft in zwei Modi:

- **Lokaler Modus** (Standard, ohne Einrichtung): Alle Daten bleiben im Browser. Gedacht für dich allein und zum Ausprobieren.
- **Cloud-Modus** (sobald Supabase eingerichtet ist): Jeder Kunde **registriert sich selbst** und hat ein **eigenes Konto mit eigenen Daten, Häusern und Belegen**. Die Daten sind über Row Level Security in der Datenbank getrennt; auch Admins sehen keine Objekt- oder Mieterdaten der Kunden.

| Bereich | Funktionen |
|---|---|
| **Anmeldung** | Registrierung mit Name, Firma, E-Mail und Passwort, Zustimmung zu AGB und Datenschutz, E-Mail-Bestätigung, Passwort vergessen, Tarifübersicht auf der Startseite. Das **erste registrierte Konto wird automatisch Admin** |
| **Mein Konto** | Profil, Passwort ändern, Tarif und Nutzung (Einheiten-Limit), Testphase, Tarifwechsel anfragen, alle Daten exportieren, **Konto und Daten löschen** (DSGVO) |
| **Cloud-Speicherung** | Automatisch nach jeder Änderung, mit Versionsprüfung (zwei Geräte überschreiben sich nicht), Offline-Zwischenspeicher und Nachholen. Belege liegen im privaten Ordner des Nutzers. Lokale Daten werden beim ersten Login auf Wunsch übernommen |
| **Admin: Übersicht** | Nutzer gesamt, neue und aktive Nutzer, zahlende Kunden, **Monatsumsatz (MRR)**, Speicher, Testphasen, die bald enden |
| **Admin: Nutzer** | Suche, Objekte/Einheiten/Dokumente je Kunde (nur Anzahl), Tarif zuweisen, Testphase verlängern, **sperren/entsperren**, Admin-Rechte vergeben, interne Notiz, Passwort-Reset-Mail, Konto löschen |
| **Admin: Tarife** | Preise, Einheiten-Limit (**wird serverseitig geprüft**), KI inklusive, sichtbar/buchbar |
| **Admin: Einstellungen** | Produktname, Support-E-Mail, Dauer der Testphase, Registrierung öffnen/schließen, **Ankündigungsbanner**, **Impressum, Datenschutzerklärung, AGB** |
| **Admin: Protokoll** | Alle Admin-Änderungen mit Zeitpunkt |

### Einrichtung (einmalig, ca. 15 Minuten)

1. Bei https://supabase.com ein **neues Projekt** anlegen (Region EU, z. B. Frankfurt). Bitte nicht das Projekt von Livora Clean verwenden.
2. Im Supabase-Dashboard unter **SQL Editor** den Inhalt von `immo/supabase/migrations/20261105000000_hausops_immo.sql` ausführen. Das legt Tabellen, Zugriffsregeln, Tarife und den Beleg-Speicher an.
3. **Authentication → URL Configuration**: Site URL `https://<deine-seite>/immo/` eintragen und dieselbe Adresse unter „Redirect URLs“.
4. In **Netlify → Site settings → Environment variables** anlegen:
   - `IMMO_SUPABASE_URL` = Project URL
   - `IMMO_SUPABASE_ANON_KEY` = anon/public Key
   - `IMMO_SUPABASE_SERVICE_ROLE_KEY` = service_role Key (**geheim**, wird nur zum Löschen von Konten gebraucht)
5. Neu deployen, `/immo/` öffnen und **sofort selbst registrieren**: Das erste Konto wird Admin.
6. Im Admin-Bereich unter **Einstellungen** Impressum, Datenschutz und AGB eintragen (vor dem Verkauf rechtlich prüfen lassen) und die Support-E-Mail setzen.

Getestet: Die Zugriffsregeln laufen mit `immo/supabase/tests/rls_test.sql` gegen ein lokales Postgres mit nachgebauter Supabase-Umgebung (`tests/supabase_stub.sql`). Geprüft werden Datentrennung, Rechte, Tarif-Limit, Versionskonflikt, Sperre und geschlossene Registrierung.

### Online-Bezahlung mit Stripe (Abos)

So funktioniert es für deine Kunden:
- **Tarif buchen**: Unter „Mein Konto“ oder im Hinweis nach der Testphase auf „Jetzt buchen“ klicken. Das öffnet die Stripe-Bezahlseite (Karte, SEPA-Lastschrift u. a., Gutscheincodes, Rechnungsadresse, USt-IdNr.).
- **Automatische Freischaltung**: Nach der Zahlung meldet Stripe das per Webhook. Der Tarif wird gesetzt und die Testphase beendet.
- **Kundenportal** („Zahlungen, Rechnungen & Kündigung“): Zahlungsart ändern, Rechnungen herunterladen, Tarif wechseln, kündigen oder die Kündigung zurücknehmen.
- **Zahlung fehlgeschlagen**: Der Kunde sieht einen Hinweis mit Link zum Portal; im Admin-Bereich erscheint „past_due“.
- **Testphase abgelaufen oder Abo beendet**: Das Konto wechselt in den **Nur-Lesen-Modus**. Daten bleiben sichtbar und exportierbar, Änderungen und Uploads sperrt der Server, bis ein Tarif gebucht ist. Admins und Tarife ohne Testphase sind davon nicht betroffen.
- Tarife ohne Stripe-Preis-ID bleiben manuell (Admin weist zu, oder es geht eine E-Mail an den Support).

Einrichtung:
1. In Supabase zusätzlich `immo/supabase/migrations/20261106000000_billing.sql` und `immo/supabase/migrations/20261107000000_legal.sql` ausführen.
2. Bei https://dashboard.stripe.com je Tarif ein **Produkt mit monatlichem, wiederkehrendem Preis** anlegen und die **Preis-ID** (`price_…`) im Admin-Bereich unter „Tarife“ eintragen.
3. Stripe → **Einstellungen → Billing → Kundenportal** aktivieren: Zahlungsmethode ändern, Rechnungen, Kündigung und Tarifwechsel (die Produkte freigeben).
4. Stripe → **Entwickler → Webhooks**: Endpoint `https://<deine-seite>/.netlify/functions/immo-stripe-webhook` mit den Ereignissen `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` und `invoice.payment_failed`.
5. In Netlify zusätzlich `STRIPE_SECRET_KEY` (sk_…) und `STRIPE_WEBHOOK_SECRET` (whsec_…) setzen, optional `IMMO_PUBLIC_URL` (z. B. `https://deine-domain.de`). Für die Bestätigungsmails von Kündigung und Widerruf (§ 312k BGB verlangt Textform): `RESEND_API_KEY` und `IMMO_MAIL_FROM`.
6. Zuerst im **Testmodus** (Testschlüssel und Testkarte 4242 4242 4242 4242) durchspielen, dann auf Live-Schlüssel umstellen.
7. Steuern: Für Rechnungen mit USt in Stripe die Firmendaten und **Stripe Tax** oder feste Steuersätze einrichten (Kleinunternehmer: ohne USt, Hinweis § 19 UStG in den Rechnungseinstellungen).

Getestet: Signaturprüfung, Formularkodierung und die Abbildung aller Abo-Ereignisse auf Tarif und Schreibrecht (`tests/billing.test.cjs`), die Schreibsperre in der Datenbank (`supabase/tests/billing_test.sql`) und im Browser der Ablauf Sperre → Tarif buchen → Rückkehr → Freischaltung → Zahlungsausfall → Portal.

### Vor dem Verkauf noch offen

- **KI für Kunden**: Derzeit trägt jeder Nutzer seinen eigenen Claude-API-Schlüssel ein. Für „KI inklusive“-Tarife braucht es eine Server-Funktion mit deinem Schlüssel und einem Nutzungslimit.
- Rechtliches: Impressum, Datenschutzerklärung mit Auftragsverarbeitung (Supabase, Netlify, Anthropic), AGB, AV-Vertrag für Kunden.
- Eigene Domain und Branding (Produktname ist im Admin-Bereich einstellbar).

## Fachliche Grundlage

Die Regeln stammen aus den Fach-Skills *Nebenkostenabrechnung* (BetrKV, HeizkostenV, § 556 BGB), *Ferienwohnung-Profi* (Revenue-Kennzahlen, Gästekommunikation, Pflichten in Deutschland) und *Steuerberater-Unterlagen* (Aufbau des Jahrespakets). Alles ist als Vorbereitung gedacht, nicht als Rechts- oder Steuerberatung.

## Nutzung

1. Netlify-Seite öffnen: `https://<deine-seite>/immo/`. Lokal geht es z. B. mit `python3 -m http.server` im Repo-Root und dann http://localhost:8000/immo/.
2. **Einstellungen**: Name, Anschrift, Steuernummer und IBAN für Rechnungen eintragen, außerdem Berater- und Mandantennummer für DATEV und den Kontenrahmen.
3. Objekte → Einheiten → Mieter → Mietverträge anlegen. Für die automatische Zuordnung die **IBAN des Mieters** eintragen.
4. **Bank**: Konto anlegen und im Online-Banking „Umsätze exportieren“ (CSV oder CAMT.053) wählen, Datei importieren, Vorschläge mit ✓ bestätigen. „Regel merken“ sorgt dafür, dass derselbe Zahler beim nächsten Mal automatisch zugeordnet wird.
5. **Steuer & DATEV**: Monat wählen, „DATEV-Buchungsstapel“ und „Bericht drucken“ an den Steuerberater schicken.

## KI einrichten

1. Unter https://console.anthropic.com einen API-Schlüssel erstellen. Abgerechnet wird nach Nutzung, eine Belegerkennung oder Frage kostet meist nur wenige Cent.
2. In der App unter **Einstellungen → KI-Assistent** den Schlüssel eintragen. Er wird nur auf diesem Gerät gespeichert und ist nicht Teil der Datensicherung.
3. Die App nutzt Claude Opus 5.5 über das offizielle Anthropic-SDK (`vendor/anthropic-sdk.js`, Version 1.1.0, Apache-2.0). Lehnt das Modell eine Anfrage ab, übernimmt automatisch ein Ersatzmodell (serverseitiger Fallback).
4. Datenschutz: Nur wenn du eine KI-Funktion nutzt, werden der Beleg bzw. die nötigen App-Daten an Anthropic übertragen. Alles andere bleibt lokal.

## Wichtige Hinweise

- Die **Konten-Vorschläge** (SKR 03: Bank 1200, Mieterlöse steuerfrei 8100, Erlöse 7 % 8300, durchlaufende Posten 1590 …) bitte einmal mit dem Steuerberater abstimmen. Ändern kannst du sie unter Einstellungen.
- Der DATEV-Export nutzt die ersten 14 Standardspalten des Buchungsstapels. Bitte beim ersten Mal vom Steuerberater einen Testimport machen lassen.
- Die Anlage V ist eine **Zusammenstellung, keine Steuerberatung**. Ferienwohnungen mit hotelähnlichen Leistungen können gewerblich sein. Bei Regelbesteuerung kommt die USt-Voranmeldung dazu.
- Die Daten liegen **nur im Browser**. Bitte regelmäßig unter Einstellungen → Datensicherung sichern.

## Nächste Ausbaustufen

1. **Live-Bankanbindung** (PSD2 über einen lizenzierten Kontoinformationsdienst wie finAPI, Tink oder Salt Edge, oder FinTS mit DK-Produktregistrierung) als Netlify-Function, die die Umsätze dann automatisch statt per Datei abholt. Das braucht einen Vertrag oder eine Registrierung beim Anbieter.
2. **Belege an DATEV Unternehmen online** übergeben, Zuschneiden und Geraderücken beim Scannen.
3. **E-Rechnung (XRechnung/ZUGFeRD)** für Geschäftskunden (Pflicht für alle ab 2028).

## Entwicklung

Kein Build-Schritt nötig: reines HTML/CSS/JavaScript (ES-Module).

```
immo/
  index.html, styles.css
  js/betrkv.js  Fachkatalog Betriebskosten (umlagefähig / nicht / Tipps / sonstige BK)
  js/core.js    Fachlogik: Zuordnung, Soll/Ist, Rechnungen, AfA, Anlage V, DATEV, CSV/CAMT
  js/store.js   Speicherung, Sicherung, Demo-Daten
  js/files.js   Belege/Dokumente (IndexedDB, Bildverkleinerung, Scan-Filter)
  js/ki.js      KI-Funktionen (Belegerkennung, Assistent, Briefe) über die Claude API
  js/cloud.js   Anmeldung, Cloud-Speicherung, Admin (Supabase)
  js/app.js     Oberfläche
  supabase/     Datenbank-Migrationen + RLS-/Billing-Tests
netlify/functions/immo-billing.js         Stripe Checkout + Kundenportal
netlify/functions/immo-stripe-webhook.js  Stripe-Webhook (Signatur geprüft) → Tarif im Profil
netlify/lib/immo-billing-lib.js           gemeinsame Stripe-/Supabase-Logik
netlify/functions/immo-kuendigung.js      Kündigungsbutton / Widerruf (öffentlich) mit Bestätigung
immo/js/recht.js                          rechtliche Prüfungen (Kaution, Mieterhöhung, USt Stellplatz, CO2, DSGVO …)
  vendor/       Anthropic SDK (Browser-Bundle) + Lizenz
  tests/        node --test (npm test)
```
