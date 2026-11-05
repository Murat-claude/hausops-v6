# Testprotokoll HausOps Immobilien

Stand: 05.11.2026

## 1. Automatisch getestet

Alle Tests lassen sich jederzeit wiederholen (siehe README → „Tests“).

| Ebene | Umfang | Ergebnis |
|---|---|---|
| Fachlogik (`npm test`) | 59 Tests: Bankzuordnung, Soll/Ist, NK-Abrechnung, Heiz-/CO₂-Kosten, Anlage V, AfA, DATEV, Recht, Steuer, Rechnungsempfänger, PDF, Mailversand-Prüfung, Team-Zusammenführung, Reparaturen/Kleinreparatur/Wartung | ✅ alle bestanden |
| Datenbank-Zugriffsregeln (`npm run test:db`) | 7 Testreihen: Datentrennung, Abo-Sperre, Rechtstexte/Kündigung, Team, Admin-Gruppen, Mieterportal | ✅ alle bestanden |
| **Echt-Test** (`npm run test:e2e`) | Echte Supabase (Anmeldung, Datenbank, Dateispeicher) in Docker, Netlify-Funktionen, Chromium-Browser: **62 Prüfschritte** in 5 Abläufen plus Rundgang über **46 Seitenaufrufe** (Desktop und Handy) | ✅ alle bestanden |

Geprüft wurde im Echt-Test unter anderem:
- Registrierung, erstes Konto wird Admin, Speichern und Neuladen aus der Datenbank, Beleg-Upload.
- Team: Einladung, gleichzeitiges Bearbeiten wird zusammengeführt, „Nur lesen“ wird von der Datenbank durchgesetzt.
- Kündigungsbutton ohne Anmeldung, Konto löschen.
- Admin-Gruppen: hinzufügen, einladen, Admin-Konto wird abgewiesen, entfernen, Protokoll.
- Mieterportal: Einladung, Zugang anlegen, Mieterin sieht nur ihre Daten, Schaden mit Foto, Zählerstand, Dokument, Übernahme als Reparatur, Status und Antwort, Zugang entziehen.
- Rechnungen aus Smoobu-Buchungen: Firma als Empfänger, PDF, Ablage, E-Mail, Korrektur per Storno.
- Reparaturen: Kleinreparaturklausel, Handwerkerauftrag, Rechnung, Wartungsplan, Mangel → Auftrag.

**Gefunden und behoben** beim Testen:
- Mieter-Konten hätten den Gratis-Tarif „Intern“ bekommen und so die Vermieter-Funktionen kostenlos nutzen können.
- Zählerstand: Die Zählerart stand doppelt, die Zahl hatte einen Punkt statt eines Kommas.
- Handy: Die Reparaturliste war zusammengeschoben.

## 2. Mit deinen echten Zugängen noch prüfen

Diese Dienste lassen sich hier nicht echt testen. Sie sind mit nachgestellten Antworten getestet, aber nicht mit deinen Konten. Bitte einmal durchgehen und abhaken.

### Supabase (Pflicht, ca. 20 Min.)
- [ ] Projekt in der EU-Region anlegen und alle Dateien aus `supabase/migrations/` der Reihe nach im SQL-Editor ausführen.
- [ ] Netlify-Variablen `IMMO_SUPABASE_URL`, `IMMO_SUPABASE_ANON_KEY` und `IMMO_SUPABASE_SERVICE_ROLE_KEY` setzen, neu deployen.
- [ ] Selbst registrieren (wird Admin), Bestätigungsmail kommt an, Demo-Daten laden, auf einem zweiten Gerät anmelden: Die Daten sind da.
- [ ] Deine Frau einladen: Sie registriert sich, und ihr ändert beide gleichzeitig etwas. Beides bleibt erhalten.
- [ ] Einen Mieter (oder dich selbst mit zweiter E-Mail) ins Mieterportal einladen und einen Schaden mit Handyfoto melden.

### E-Mail-Versand – Resend (ca. 15 Min.)
- [ ] Domain bei Resend verifizieren (DNS-Einträge), `RESEND_API_KEY` und `IMMO_MAIL_FROM` setzen.
- [ ] Rechnung an dich selbst senden: Absendername, Antwort-an-Adresse und PDF-Anhang prüfen. Auch im Spam-Ordner nachsehen.

### Smoobu (ca. 10 Min.)
- [ ] `SMOOBU_API_KEY` und `SMOOBU_API_SECRET` setzen, in der App „Synchronisieren“ wählen.
- [ ] Eine echte Booking.com-Buchung prüfen: Kommen Anschrift, Land, E-Mail und Buchungsnummer an? Die Feldnamen bei Smoobu konnten nicht an der offiziellen Dokumentation geprüft werden; falls etwas fehlt, Bescheid geben.
- [ ] Den Smoobu-Namen der Ferienwohnung bei der Einheit eintragen, falls er abweicht.

### Bank – Enable Banking (ca. 30 Min.)
- [ ] Konto bei Enable Banking anlegen, App registrieren, `ENABLEBANKING_APP_ID` und `ENABLEBANKING_PRIVATE_KEY` setzen.
- [ ] Zuerst die Sandbox, dann die eigene Bank verbinden, Umsätze abrufen und die automatische Zuordnung der Miete prüfen.

### Stripe (nur für den Verkauf, ca. 30 Min.)
- [ ] Im Testmodus Produkte und Preise anlegen, Preis-IDs im Admin eintragen, Webhook einrichten.
- [ ] Mit Testkarte 4242 4242 4242 4242 einen Tarif buchen: Er wird freigeschaltet, das Kundenportal öffnet sich.
- [ ] Kündigung über „Verträge hier kündigen“ prüfen.

### Steuer
- [ ] Die Werte der Anlage V aus der App mit dem Vorjahresbescheid bzw. der letzten Erklärung vergleichen.
- [ ] DATEV-Export einmal vom Steuerberater einlesen lassen (Berater- und Mandantennummer, Kontenrahmen).

### Rechtliches vor dem Verkauf
- [ ] Impressum, Datenschutzerklärung (inkl. Mieterportal), AGB, AVV und Widerrufsbelehrung anwaltlich prüfen lassen (siehe `RECHTLICHES.md`).
