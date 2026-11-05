# HausOps Immobilien

Verwaltung vermieteter Immobilien (angelehnt an den Funktionsumfang von immocloud) mit Ferienwohnungs-Modul.
Läuft als eigenständige Web-App unter **`/immo/`** auf derselben Netlify-Seite wie Livora Clean. Die bestehende App bleibt unverändert.

> **Rechtliches:** Welche gesetzlichen Regeln die App prüft (Mietrecht, Betriebskosten, CO2-Aufteilung, Umsatzsteuer bei Stellplätzen, GoBD, DSGVO, Verbraucherrecht beim Verkauf), mit Mustertexten und offenen Punkten, steht in [`RECHTLICHES.md`](RECHTLICHES.md).

## Bedienung – so einfach wie möglich

- **Start „Heute zu tun“:** Die App zeigt selbst, was ansteht, jeweils mit einem Knopf zum Erledigen. Dazu gehören:
  - Kontobewegungen zuordnen (sichere Vorschläge mit einem Klick)
  - Mietrückstände mit „Erinnerung schreiben“, fällige Vorgänge und Mängel
  - Belege im Eingang, Rechnungsentwürfe, unvollständige Mieterakten
  - fällige Nebenkostenabrechnung mit Frist, Steuererklärung (Januar bis Juli), ablaufende Bankfreigabe, mögliche Mieterhöhung
- **„Was möchtest du tun?“:** große Kacheln für Beleg fotografieren, Neuer Mieter, Konto abrufen, Mieten prüfen, Nebenkosten und Steuererklärung. Alle Zahlen gibt es aufklappbar darunter.
- **Einrichtungs-Assistent beim ersten Start** in 4 Schritten: deine Daten, das erste Haus (Art per Bild-Knopf), Einheiten mit ＋/− zählen (Wohnungen, ganzes Haus, Garagen, Stellplätze, Keller, Ferienwohnungen, Gewerbe), danach die nächsten Schritte.
- **Menü in Gruppen und Alltagssprache:** Vermietung · Geld & Belege · Ferienwohnung (nur sichtbar, wenn vorhanden) · Steuer · Mehr. Suche überall mit „/“.
- **Am Handy:** Leiste unten (Start, Mieter, **＋**, Geld, Menü) mit großen Tippflächen. Über ＋ geht alles Häufige mit einem Tipp: Beleg fotografieren, PDF ablegen, Neuer Mieter, Ausgabe, Miete bar, Notiz/Mangel, Ferien-Buchung, Haus/Wohnung.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Objekte & Einheiten** | Häuser, ETW, Garagenhöfe mit Adresse, Baujahr, Kaufpreis und AfA-Basis. Einheiten: Wohnung, Haus, Gewerbe, **Garage**, **Stellplatz**, **Ferienwohnung**, jeweils mit Fläche, Zimmern, Lage, Zählern und Ausstattung |
| **Mieter & Verträge** | **Belegung je Einheit** (aktueller Mieter, seit wann, Auszug geplant, Nachmieter). Der **Assistent für Einzug und Mieterwechsel** erfasst Mietende, Rückgabe, Schlüssel, Zählerstände, Kaution und Mängel des Vormieters sowie Stammdaten, Mitmieter, IBAN, Personen, Mietbeginn, Miete, Kaution und Zählerstände des Nachmieters. Er prüft, dass sich die Verträge nicht überschneiden, und zeigt Leerstandstage. Danach: **Übergabeprotokoll** (Einzug/Auszug) zum Drucken, Wohnungsgeberbestätigung, Kautions-/Auszugsbrief. Die **Mieterakte** enthält Mietkonto, Kaution, Vertragshistorie, Zahlungen, Zählerstände, NK-Abrechnungen, Dokumente und Briefe. Dazu Mietanpassungen ab einem Stichmonat |
| **Mieterordner (digitale Akte)** | Mieter als Ordner-Karten mit Status, Rückstand, offenen Mängeln und fehlenden Unterlagen; Ansicht „Belegung je Einheit“. In der Akte gibt es die Register **Überblick** (Steckbrief mit Miete, Kaution, Kontakt per Klick, Mietkonto, Vollständigkeits-Check), **Dokumente** (Mietvertrag, Nachträge, Protokolle, Kaution, Selbstauskunft, Wohnungsgeberbestätigung, Kündigung, Schriftverkehr, Fotos/Mängel – direkt fotografieren, scannen oder als PDF ablegen), **Vorgänge** (Notizen, Anrufe, Mängel, Termine, Vereinbarungen mit Wiedervorlage), **Mietkonto**, **Vertrag & Historie** und **Nebenkosten & Zähler**. Den **Mietvertrag liest die KI aus** (Miete, Kaution, Mietart, Staffeln, Kündigungsfrist, Betriebskosten-Klausel, sonstige BK, Besonderheiten, bedenkliche Klauseln) und überträgt die Daten auf Wunsch |
| **Schnellsuche** | Suchfeld in der Seitenleiste (Taste „/“): findet Mieter, Wohnungen, Objekte, Dokumente, Vorgänge, Ausgaben, Gäste, Rechnungen und Briefe |
| **Bank** | Import von **CSV** (alle deutschen Banken, Spalten werden automatisch erkannt) und **CAMT.053 (XML)**. Duplikate werden erkannt |
| **Automatische Zuordnung** | Mieteingänge werden über Mieter-IBAN, Name, Betrag (= Warmmiete), Einheit im Verwendungszweck und **gelernte Regeln** erkannt. Der Soll-Monat kommt aus dem Verwendungszweck („Miete 11/2026“, „Dezember“), sonst gilt: Zahlung ab dem 20. zählt für den Folgemonat. Ausgaben (Stadtwerke, Grundsteuer, Versicherung, Zinsen …) erkennt die App über Stichwörter und Regeln |
| **Mieteingänge** | Soll/Ist je Monat, Jahresmatrix (✓ / ½ / ✗), Rückstände, Barzahlungen |
| **Ausgaben** | Werbungskosten nach Kategorien, je Objekt, aus Bankumsätzen oder manuell (bar/Karte) |
| **Ferienwohnung** | Belegungskalender inkl. Eigennutzung, Buchungen mit Kanal (Airbnb, Booking …), Prüfung auf Überschneidungen, **Smoobu-Import** über die vorhandene Netlify-Function. Kennzahlen **Auslastung, ADR, RevPAR** mit Vorjahresvergleich, Ø Aufenthaltsdauer, **Stornoquote**, **Direktbuchungsanteil**, Netto-Ertrag. **Reinigungsplan** mit Hinweis auf Wechsel am selben Tag und Auftrag zum Kopieren. **Gäste-Nachrichten** (Bestätigung, 3 Tage vor Anreise, während des Aufenthalts, Abreise/Bewertung). Hinweis auf den **Meldeschein** bei ausländischen Gästen, **Registrierungsnummer** auf Rechnungen |
| **Rechnungen** | Fortlaufende Nummern (`RE-2026-0001`), 7 % USt auf Übernachtung und Endreinigung, 19 % auf Extras, **Kurtaxe als durchlaufender Posten**, Kleinunternehmer-Option (§ 19 UStG), Pflichtangaben nach § 14 UStG, Storno mit Stornorechnung, Zahlungsstatus. Details unten unter „Rechnungen für Portal-Buchungen“ |
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
| **Team & Zugriff** | Mehrere Personen auf **einen gemeinsamen Bestand**, z. B. Ehepartner, Mitarbeiter oder Steuerberater, jede mit eigenem Login. Details unten |
| **Cloud-Speicherung** | Automatisch nach jeder Änderung, mit Versionsprüfung (zwei Geräte überschreiben sich nicht), Offline-Zwischenspeicher und Nachholen. Belege liegen im privaten Ordner des Nutzers. Lokale Daten werden beim ersten Login auf Wunsch übernommen |
| **Admin: Übersicht** | Nutzer gesamt, neue und aktive Nutzer, zahlende Kunden, **Monatsumsatz (MRR)**, Speicher, Testphasen, die bald enden |
| **Admin: Nutzer** | Suche, Objekte/Einheiten/Dokumente je Kunde (nur Anzahl), Tarif zuweisen, Testphase verlängern, **sperren/entsperren**, Admin-Rechte vergeben, interne Notiz, Passwort-Reset-Mail, Konto löschen |
| **Admin: Tarife** | Preise, Einheiten-Limit (**wird serverseitig geprüft**), KI inklusive, sichtbar/buchbar |
| **Admin: Einstellungen** | Produktname, Support-E-Mail, Dauer der Testphase, Registrierung öffnen/schließen, **Ankündigungsbanner**, **Impressum, Datenschutzerklärung, AGB** |
| **Admin: Protokoll** | Alle Admin-Änderungen mit Zeitpunkt |

### Team: gemeinsam verwalten (z. B. Ehepaar, Hausverwaltung)

- **Einladen**: Unter „Mein Konto → Team & Zugriff“ die E-Mail-Adresse und die Rolle eingeben. Die App erzeugt einen Einladungslink zum Verschicken per E-Mail oder WhatsApp, 14 Tage gültig. Er funktioniert **nur mit der eingeladenen E-Mail-Adresse**. Meldet sich die Person mit dieser Adresse an, erscheint die Einladung auch ohne Link.
- **Rollen**:
  - **Inhaber**: alles, inklusive Tarif, Team und Kontolöschung.
  - **Bearbeiten**: alle Daten und Belege.
  - **Nur lesen**: Einsicht und Export, ideal für den Steuerberater.
  - Die Rechte prüft der Server (Datenbank und Beleg-Speicher), nicht nur die Oberfläche.
- **Gleichzeitig arbeiten**: Speichern zwei Personen fast gleichzeitig, führt die App die Änderungen **je Datensatz und Feld zusammen**, statt eine zu verwerfen. Nur wenn beide dieselbe Angabe ändern, gilt die zuletzt gespeicherte. Änderungen der anderen erscheinen nach spätestens 30 Sekunden, beim Zurückkehren zur App sofort, mit dem Hinweis „Änderung von …“.
- **Rechnungsnummern**: Vor dem Festschreiben holt die App den neuesten Stand, damit keine Nummer doppelt vergeben wird. Passiert es trotzdem, weist sie darauf hin.
- **Mehrere Bestände**: Wer eingeladen wurde, behält seinen eigenen Bestand und wechselt über die Auswahl in der Seitenleiste oder unter „Mein Konto“.
- **Tarif**: Abo und Limits richten sich nach dem Inhaber. Die Anzahl weiterer Personen pro Tarif wird im Admin-Bereich unter „Tarife“ festgelegt; Standard ist Testphase +2, Basis +1, Pro +4, Business unbegrenzt.
- **Sperre**: Wird der Inhaber gesperrt oder läuft sein Abo ab, gilt das auch für die Mitglieder (Sperre bzw. Nur-Lesen).
- **Lokaler Modus**: Ohne Konto liegen die Daten nur im Browser; ein Team ist dann nicht möglich.

### Admin: Vermieter-Gruppen

Unter **Admin → Gruppen** siehst du alle gemeinsamen Bestände (Inhaber plus weitere Personen).
- Für jedes Kundenkonto kannst du eine Gruppe anlegen und Personen hinzufügen. Ein vorhandenes Konto kommt sofort dazu, für alle anderen entsteht ein Einladungslink.
- Rollen lassen sich ändern („Bearbeiten“ / „Nur lesen“), Personen entfernen und Einladungen zurückziehen.
- Im Nutzer-Dialog stehen Gruppe und Mitgliedschaften; die Nutzerliste zeigt „Mitglied bei …“.
- **Datenschutz**: Admin-Konten können über den Admin-Bereich nicht in Kundenbestände aufgenommen werden. Sonst könnte sich ein Admin selbst Einsicht verschaffen. Jede Änderung steht im Protokoll.
- Mieter-Zugänge aus dem Mieterportal zählen nicht als Kunden. Sie sind in der Nutzerliste ausgeblendet und lassen sich einblenden.

## Mieterportal

Mieter bekommen einen eigenen, kostenlosen Zugang, der fürs Handy gemacht ist. Sie sehen **nur ihre eigenen Daten**, nie deinen Bestand.

| Für Mieter | Für dich |
|---|---|
| Startseite mit Wohnung, Miete, Kaution, Bankverbindung und deinen Kontaktdaten | Einladen aus der Mieterakte (Karte „🔑 Mieterportal“), Link per E-Mail oder WhatsApp, 30 Tage gültig, nur mit der eingeladenen E-Mail |
| **Schaden melden** mit Raum, Beschreibung, bis zu 6 Fotos, Kennzeichen „dringend“ | **Postfach** (Menü „Mieterportal“) mit Fotos, Status (neu / gesehen / in Bearbeitung / erledigt) und Antwort |
| **Zählerstand melden** mit Foto | Schadensmeldung **als Reparaturauftrag übernehmen**: Fotos, Raum und Dringlichkeit werden mitgenommen. Erledigst du die Reparatur, sieht der Mieter den Status und auf Wunsch eine Nachricht |
| **Nachrichten** an dich, Verlauf mit deinen Antworten | Zählerstand mit einem Klick übernehmen (für Nebenkosten und Verbrauch) |
| **Dokumente**, die du freigibst (z. B. NK-Abrechnung, Protokoll) | Dokumente in der Mieterakte mit „🔑 Teilen“ freigeben |
| **Notfall-Kontakte** (Hausmeister, Notdienst) | Notfall-Kontakte einmal für alle Mieter pflegen, Zugang jederzeit entziehen |

- **Datenschutz**: Du bist Verantwortlicher, der Betreiber verarbeitet im Auftrag (AVV). Der Mieter legt seinen Zugang selbst an und bestätigt die Datenschutzhinweise. Die Datenbank (Row Level Security) und der Dateispeicher stellen sicher, dass ein Mieter nur seinen eigenen Ordner und seine eigenen Einträge sieht und schreiben kann.
- **Missbrauchsschutz**: Ein Mieter-Zugang lässt sich nur mit Einladung anlegen, auch bei geschlossener Registrierung. Er bekommt keine kostenlose Vermieter-Testphase.
- **Einrichtung**: Datenbank-Update `immo/supabase/migrations/20261110000000_portal.sql` ausführen. Das Portal gibt es nur im Konto-Modus.

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

Getestet: Die Zugriffsregeln laufen mit `immo/supabase/tests/rls_test.sql` gegen ein lokales Postgres mit nachgebauter Supabase-Umgebung (`tests/supabase_stub.sql`). Geprüft werden Datentrennung, Rechte, Tarif-Limit, Versionskonflikt, Sperre und geschlossene Registrierung. `team_test.sql` prüft Einladen, Annehmen nur mit der richtigen E-Mail, „Bearbeiten“ und „Nur lesen“ für Daten und Belege, Entfernen, Verlassen, Team-Limit und die Sperre des Inhabers. Das Zusammenführen gleichzeitiger Änderungen testet `tests/team.test.mjs`.

### Online-Bezahlung mit Stripe (Abos)

So funktioniert es für deine Kunden:
- **Tarif buchen**: Unter „Mein Konto“ oder im Hinweis nach der Testphase auf „Jetzt buchen“ klicken. Das öffnet die Stripe-Bezahlseite (Karte, SEPA-Lastschrift u. a., Gutscheincodes, Rechnungsadresse, USt-IdNr.).
- **Automatische Freischaltung**: Nach der Zahlung meldet Stripe das per Webhook. Der Tarif wird gesetzt und die Testphase beendet.
- **Kundenportal** („Zahlungen, Rechnungen & Kündigung“): Zahlungsart ändern, Rechnungen herunterladen, Tarif wechseln, kündigen oder die Kündigung zurücknehmen.
- **Zahlung fehlgeschlagen**: Der Kunde sieht einen Hinweis mit Link zum Portal; im Admin-Bereich erscheint „past_due“.
- **Testphase abgelaufen oder Abo beendet**: Das Konto wechselt in den **Nur-Lesen-Modus**. Daten bleiben sichtbar und exportierbar, Änderungen und Uploads sperrt der Server, bis ein Tarif gebucht ist. Admins und Tarife ohne Testphase sind davon nicht betroffen.
- Tarife ohne Stripe-Preis-ID bleiben manuell (Admin weist zu, oder es geht eine E-Mail an den Support).

Einrichtung:
1. In Supabase zusätzlich nacheinander alle Dateien aus `immo/supabase/migrations/` ausführen (billing, legal, team, admin_groups, portal), sortiert nach Dateiname.
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

## Monatsbericht für den Steuerberater

Menü **Steuer → Monatsbericht StB** (oder `#/monat/2026-10`). Pro Monat:
- **Mieteinnahmen**: Soll laut Vertrag (kalt, NK, Zuschläge) und tatsächlich erhaltene Beträge mit Eingangsdatum, je Mieter und Einheit. Dazu alle Zahlungseingänge des Monats nach dem Zuflussprinzip (auch Nachzahlungen und NK-Nachzahlungen). Kautionen werden getrennt ausgewiesen.
- **Ferienwohnung**:
  - Rechnungen des Monats mit Netto, USt 7 % / 19 %, Kurtaxe (durchlaufend), brutto und bezahlt.
  - Buchungen mit Anreise im Monat, mit Kanal und Buchungsnummer.
  - Portal-Provisionen.
- **Ausgaben** des Monats und **offene Punkte** (fehlende Miete, Buchung ohne Rechnung, fehlender Beleg).
- **Ein Klick „An Steuerberater senden“**:
  - Die Mail enthält drei Anhänge: PDF-Bericht, Einzelposten als Excel-Tabelle (CSV) und DATEV-Buchungsstapel.
  - Der Bericht wird unter Belege & Dokumente abgelegt und als „gesendet“ markiert.
  - Ohne eingerichteten Mailversand geht es über das Teilen-Menü bzw. Download und eigenes Mail-Programm.
- Name und E-Mail des Steuerberaters stehen unter **Einstellungen → DATEV**. Vom 1. bis 15. eines Monats erinnert die Startseite an den Bericht des Vormonats.

## Reparaturen & Instandhaltung

Menü **Vermietung → Reparaturen**, außerdem „🔧 Reparatur / Schaden“ im „+“-Menü.

- **Aufträge**:
  - Was ist kaputt, wo (Objekt, Einheit oder Gemeinschaftseigentum), Art, Dringlichkeit und Status (gemeldet → beauftragt → in Arbeit → erledigt).
  - Dazu Handwerker mit Telefon und E-Mail, Termin, Angebot, Fotos und ein Verlauf.
  - Mängel aus der Mieterakte oder dem Mieterportal werden mit einem Klick zum Auftrag.
- **Handwerker beauftragen**: Der Auftragstext mit Adresse, Ansprechpartner vor Ort und Rechnungsanschrift geht per E-Mail, WhatsApp oder in die Zwischenablage. Er enthält den Hinweis, den Lohnanteil auszuweisen (§ 35a EStG). Danach steht der Auftrag auf „beauftragt“.
- **Mieter informieren**: Ankündigung der Erhaltungsmaßnahme (§ 555a BGB) mit Termin und Firma.
- **Kosten**:
  - Die Handwerkerrechnung wird als Ausgabe gebucht und mit dem Auftrag verknüpft (Anlage V, DATEV). Erhaltungsaufwand lässt sich auf 2–5 Jahre verteilen (§ 82b EStDV).
  - Wer zahlt: Vermieter, Mieter (Kleinreparatur oder selbst verursachter Schaden), Versicherung oder Umlage über die Nebenkosten.
- **Kleinreparaturklausel**: Grenze je Fall und Jahreshöchstbetrag werden am Mietvertrag hinterlegt. Die App prüft beides nach der Rechtsprechung des BGH.
  - Liegen die Kosten über der Grenze je Fall, zahlt der Mieter nichts.
  - Fehlt der Jahreshöchstbetrag, warnt die App, weil die Klausel dann unwirksam ist.
- **Wartungsplan**: Vorlagen für Heizung, Schornsteinfeger, Rauchmelder, Legionellen, Aufzug, Dachrinne, Feuerlöscher, E-Check, Rückstausicherung, Spielplatz und Dach.
  - Jede Vorlage hat ein Intervall und ist der passenden Betriebskostenart zugeordnet.
  - Fälligkeiten erscheinen auf der Startseite. „Erledigt“ rechnet den nächsten Termin aus und bucht umlagefähige Kosten direkt für die Nebenkostenabrechnung.
- **Kosten & Steuer**: Jahresübersicht nach Art und Kostenträger, offene Angebote. Dazu eine Anzeige der **15-%-Grenze** für anschaffungsnahe Herstellungskosten in den ersten 3 Jahren nach dem Kauf (§ 6 Abs. 1 Nr. 1a EStG).

## Rechnungen für Portal-Buchungen (Booking.com, Airbnb … über Smoobu)

1. **Daten aus Smoobu**: Gast, Anschrift mit Land, E-Mail, Telefon, Kanal und **Buchungsnummer des Portals** werden übernommen, die Firma, wenn der Kanal sie liefert. Fehlen Anschrift oder E-Mail in der Reservierung, ergänzt die App sie aus dem Gast-Profil in Smoobu.
2. **Buchungen ohne Rechnung**: Unter „Gäste-Rechnungen“ stehen alle Buchungen ohne Rechnung. Mit einem Klick entsteht ein Entwurf, auf Wunsch für alle auf einmal. Wahlweise legt die App für jede neue Smoobu-Buchung automatisch einen Entwurf an.
3. **Firma statt Gast**: „👤 Empfänger / Firma“ öffnet das Formular für Firma, Ansprechpartner, Anschrift, USt-IdNr. und Rechnungs-E-Mail. Der Gast steht dann als „z. Hd.“ und „Gast: …“ auf der Rechnung.
   - **Nach dem Festschreiben** darf eine Rechnung nicht mehr überschrieben werden (GoBD, § 14 UStG). Deshalb erzeugt „Empfänger ändern“ automatisch eine **Stornorechnung** und eine **neue Rechnung** mit neuer Nummer und dem Hinweis „ersetzt Rechnung …“. Zahlungen werden übernommen.
4. **Zahlungshinweis**: Überweisung mit Zahlungsziel oder „bereits bezahlt über Booking.com/Airbnb/bar“. Bei Airbnb ist „über Airbnb bezahlt“ voreingestellt.
5. **PDF im Ordner**: Beim Festschreiben (und bei Storno oder Korrektur) entsteht ein echtes PDF (A4, passend für Fensterumschläge). Es wird unter **Belege & Dokumente → Ausgangsrechnungen** abgelegt, im Cloud-Modus auch online. Das Original bleibt unverändert, so wie es die Aufbewahrungspflicht verlangt.
6. **Per E-Mail senden**:
   - Empfänger, Betreff und Text sind vorausgefüllt, das PDF ist angehängt. Auf Wunsch geht eine Kopie an dich, und Antworten des Gastes landen bei dir.
   - Jeder Versand wird mit Datum und Empfänger protokolliert.
   - Ohne eingerichteten Mailversand geht es über das Teilen-Menü des Handys oder per Download und eigenem Mail-Programm.
   - Bei Weiterleitungs-Adressen der Portale (`…@guest.booking.com`) weist die App darauf hin, dass Anhänge dort nicht immer ankommen. Für Firmen besser die Adresse der Buchhaltung eintragen.

**Mailversand einrichten** (einmalig): Bei https://resend.com ein Konto anlegen und deine Domain verifizieren. Dann in Netlify `RESEND_API_KEY` und `IMMO_MAIL_FROM` setzen (z. B. `Rechnungen <rechnung@deine-domain.de>`). Der Absendername wird automatisch dein Name aus den Einstellungen. Die Funktion `immo-mail` nimmt nur angemeldete Nutzer bzw. den Sync-Schlüssel an, erlaubt nur PDF-Anhänge bis 4 MB und höchstens 60 Mails pro Stunde.

## Steuererklärung selbst machen (ohne Steuerberater)

Unter **Steuer & DATEV → „Erklärung vorbereiten“** (bzw. `#/erklaerung/<Jahr>`):

1. **Vorprüfung** – was sonst der Steuerberater prüft:
   - nicht zugeordnete Bankumsätze, Ausgaben ohne Objekt oder Beleg, fehlende Zinsbescheinigung
   - fehlende AfA-Daten
   - **15-%-Grenze** für anschaffungsnahe Aufwendungen in den ersten 3 Jahren nach dem Kauf, mit Frühwarnung
   - als Herstellung erfasste Ausgaben
   - **verbilligte Vermietung** (unter 66 % bzw. 50 % der ortsüblichen Warmmiete)
   - **Eigennutzung der Ferienwohnung** (Kosten anteilig) und geringe Auslastung
   - **Miteigentum ohne Ehe** (Feststellungserklärung ESt 1 B nötig)
   - Umsatzsteuerpflicht
   - Liste oft vergessener Werbungskosten
2. **Ausfüllhilfe Anlage V / Anlage V-FeWo** je Objekt, nach den Feldbezeichnungen in Mein ELSTER (Zeilennummern ändern sich jährlich):
   - Lage, Aktenzeichen, Anschaffung, Wohnfläche, Miteigentum
   - Einnahmen: Wohnungen, andere Räume/Garagen, Ferienwohnung, Umlagen, vereinnahmte USt
   - Werbungskosten: AfA, Schuldzinsen, Erhaltung (sofort bzw. **auf 2–5 Jahre verteilt nach § 82b EStDV**, je Ausgabe einstellbar), Betriebskosten, Verwaltung, Sonstiges, Vorsteuer
   - Jeder Wert mit 📋-Knopf in vollen Euro, Einnahmen abgerundet und Werbungskosten aufgerundet, dazu Ausdruck als PDF
3. **Umsatzsteuer:** Kennzahlen 81/86/66 der Voranmeldung je Quartal und Jahr (Ist-Versteuerung). Vorsteuer kann je Ausgabe erfasst werden. Für Kleinunternehmer gibt es die Grenzen ab 2025.
4. **Abgabe in Mein ELSTER Schritt für Schritt:** Konto (Aktivierungsbrief ca. 2 Wochen), Frist (in der Regel 31. Juli des Folgejahres), Belegabruf, Anlagen, Prüfen und Absenden, Bescheid prüfen und ggf. Einspruch (1 Monat).

Die Abgabe erfolgt über das kostenlose Portal Mein ELSTER. Eine Direktübermittlung aus der App würde eine Registrierung als ELSTER-Softwarehersteller und die zertifizierte ERiC-Bibliothek auf einem eigenen Server erfordern (möglicher späterer Ausbau für den Verkauf). Keine Steuerberatung: In Sonderfällen (Feststellungserklärung, gewerbliche Ferienvermietung, Verkauf innerhalb von 10 Jahren, große Sanierung nach dem Kauf) bleibt der Steuerberater sinnvoll.

## Live-Synchronisation: Bank, Smoobu, Airbnb & Booking.com

Die App ruft **beim Öffnen, danach alle 15 Minuten und beim Zurückkehren in die App** automatisch ab:

| Quelle | Was kommt an | Wie |
|---|---|---|
| **Bankkonto (live)** | Alle gebuchten Umsätze, Mieten werden sofort zugeordnet; keine Duplikate, auch nicht zu früher importierten CSV-Umsätzen | Open Banking (PSD2) über den lizenzierten Kontoinformationsdienst **Enable Banking**: nur Lesezugriff, Freigabe bei der eigenen Bank, gültig bis 180 Tage (Hinweis vor Ablauf, „verlängern“) |
| **Smoobu** | Buchungen aller Portale (Airbnb, Booking.com, FeWo-direkt …) **mit Gastname, E-Mail, Telefon, Personen, Preis**; Änderungen und Stornos | Smoobu-API mit der seit 25.09.2026 vorgeschriebenen **HMAC-Signatur** |
| **iCal von Airbnb / Booking.com / FeWo-direkt / Vrbo / Holidu …** | Belegung (neue Buchungen, Verschiebungen, Stornos, Sperrzeiten), bei Airbnb mit Reservierungscode und den letzten 4 Ziffern der Telefonnummer | Kalender-Link je Ferienwohnung; Buchungen, die schon über Smoobu da sind, werden verknüpft statt verdoppelt |
| **Export-Kalender (Cloud-Modus)** | Deine Direkt- und Smoobu-Buchungen als iCal für die Portale → keine Doppelbuchungen | geheimer Link je Ferienwohnung und Portal (eigene Buchungen des Portals werden ausgeblendet) |

Airbnb und Booking.com bieten privaten Vermietern **keine offene Schnittstelle** (nur zertifizierten Partnern). Vollständige Buchungsdaten in Echtzeit gibt es deshalb über einen Channel-Manager wie Smoobu; iCal liefert ohne Channel-Manager die Belegung.

### Einrichtung
1. **Bank (Enable Banking):** Unter https://enablebanking.com ein Konto anlegen, eine Anwendung erstellen (für eigene Konten kostenlos im „restricted production“-Modus; für Kunden ist ein Vertrag nötig) und als **Redirect-URL** `https://<deine-seite>/immo/` eintragen. In Netlify `ENABLEBANKING_APP_ID` (Anwendungs-ID) und `ENABLEBANKING_PRIVATE_KEY` (privater Schlüssel als PEM) setzen. Danach in der App unter **Bank → „+ Bank verbinden“** die Bank wählen und dort freigeben.
2. **Smoobu:** In Smoobu unter Einstellungen → Erweitert → API-Schlüssel einen neuen Schlüssel mit **Secret** erzeugen. In Netlify `SMOOBU_API_KEY` und **`SMOOBU_API_SECRET`** setzen. **Wichtig:** Ohne Secret lehnt Smoobu seit 25.09.2026 alle Abrufe ab – das betrifft auch Livora Clean, das dieselbe Funktion nutzt. In der App unter Ferienwohnung „Smoobu automatisch abrufen“ anhaken und bei jeder Ferienwohnung den Smoobu-Namen eintragen, falls er abweicht.
3. **iCal:** Unter Ferienwohnung → Kanäle → „+ Kalender importieren“ den Export-Link aus Airbnb/Booking einfügen. Im Cloud-Modus über „Export-Kalender für Portale“ die Links erzeugen und in Airbnb bzw. Booking unter „Kalender importieren“ eintragen.
4. **Zugriffsschutz:** Im Cloud-Modus über die Anmeldung. Im lokalen Modus in Netlify `IMMO_SYNC_TOKEN` (langer Zufallswert) setzen und denselben Wert in der App unter Einstellungen → Synchronisation eintragen.

Getestet: HMAC-Signatur, Enable-Banking-Signatur (RS256-JWT), Umsatz-Umwandlung, iCal-Einlesen und -Abgleich, Duplikatschutz und erlaubte Kalender-Anbieter (`tests/sync.test.cjs`, `tests/core.test.mjs`); im Browser der Ablauf Bank verbinden → Rückkehr → Abruf → Zuordnung → erneuter Abruf ohne Duplikate, dazu iCal und Smoobu gegen simulierte Schnittstellen. Gegen die echten Schnittstellen von Enable Banking und Smoobu konnte hier nicht getestet werden – bitte zuerst mit eigenem Konto und Testbuchungen prüfen.

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

1. **Abruf im Hintergrund** auch bei geschlossener App (geplante Netlify-Function mit Zwischenspeicher pro Kunde) und Smoobu-Webhooks für Sofort-Meldungen.
2. **Belege an DATEV Unternehmen online** übergeben, Zuschneiden und Geraderücken beim Scannen.
3. **E-Rechnung (XRechnung/ZUGFeRD)** für Geschäftskunden (Pflicht für alle ab 2028).

## Tests

| Befehl | Was | Voraussetzung |
|---|---|---|
| `npm test` | Fachlogik: Zuordnung, NK, Steuer, Recht, Rechnungen/PDF, Mail, Team-Zusammenführung, Reparaturen | Node 20+ |
| `npm run test:db` | Zugriffsregeln der Datenbank (Datentrennung, Abo-Sperre, Team, Admin-Gruppen, Mieterportal) | Postgres, `DATABASE_URL` |
| `npm run test:e2e` | **Echt-Test**: startet Supabase lokal (Docker), die Netlify-Funktionen und einen Browser. Spielt Registrierung, Speichern, Belege, Team, Admin-Gruppen, Mieterportal, Rechnungen, Reparaturen und einen Rundgang durch alle Seiten (Desktop und Handy) durch | Docker, Node, Playwright |

Was zusätzlich mit echten Zugängen geprüft werden muss (Stripe, Bank, Smoobu, Resend, ELSTER), steht in `TESTPROTOKOLL.md`.

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
  js/pdf.js     PDF-Rechnungen (jsPDF, vendor/jspdf.js, MIT-Lizenz)
  js/instand.js Reparaturen, Kleinreparaturklausel, Wartungsplan, 15-%-Grenze
  js/app.js     Oberfläche
  supabase/     Datenbank-Migrationen + RLS-/Billing-Tests
netlify/functions/immo-billing.js         Stripe Checkout + Kundenportal
netlify/functions/immo-stripe-webhook.js  Stripe-Webhook (Signatur geprüft) → Tarif im Profil
netlify/lib/immo-billing-lib.js           gemeinsame Stripe-/Supabase-Logik
netlify/functions/immo-mail.js            Rechnungsversand per E-Mail mit PDF-Anhang (Resend)
netlify/functions/immo-kuendigung.js      Kündigungsbutton / Widerruf (öffentlich) mit Bestätigung
netlify/functions/immo-bank.js            Live-Bankanbindung (Enable Banking, PSD2)
netlify/functions/immo-ical.js            iCal-Kalender der Portale abrufen (nur erlaubte Anbieter)
netlify/functions/immo-ical-feed.js       Export-Kalender je Ferienwohnung für die Portale
netlify/functions/smoobu-sync.js          Smoobu-Buchungen (HMAC), auch von Livora Clean genutzt
netlify/lib/immo-sync-lib.js              gemeinsame Sync-Logik (HMAC, JWT, iCal, Zugriffsschutz)
immo/js/recht.js                          rechtliche Prüfungen (Kaution, Mieterhöhung, USt Stellplatz, CO2, DSGVO …)
immo/js/steuer.js                         Steuererklärung: Vorprüfung, Werte Anlage V / V-FeWo, Umsatzsteuer-Voranmeldung
  vendor/       Anthropic SDK (Browser-Bundle) + Lizenz
  tests/        node --test (npm test)
```
