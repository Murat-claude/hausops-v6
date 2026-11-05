# Rechtliches in HausOps Immobilien

Stand: November 2026. Die App setzt die folgenden Regeln technisch um und weist an den entscheidenden Stellen darauf hin. Sie ist **keine Rechtsberatung**. Warnungen blockieren nichts, was im Einzelfall zulässig sein kann; der Nutzer entscheidet bewusst („Trotzdem speichern?“). Vor dem Verkauf: alle Texte und Abläufe anwaltlich prüfen lassen (z. B. IT-Rechtskanzlei, Haus & Grund für Mietrecht).

## 1. Vermietung: was die App prüft

| Thema | Regel | Umsetzung in der App |
|---|---|---|
| Einheitsarten | Wohnraum (Wohnung, Haus), Gewerbe, Garage, Stellplatz, Carport, Keller/Abstellraum, Lager/Hobbyraum, Ferienwohnung | Wohnraumschutz (Kaution, Mieterhöhung, Mietpreisbremse) gilt nur für Wohnraum. Bei Garage, Stellplatz und Keller weist die App darauf hin, dass der Vertrag maßgeblich ist (§ 580a BGB) |
| Umsatzsteuer | Wohnraum, Keller, Lager steuerfrei (§ 4 Nr. 12 UStG); **Fahrzeugstellplätze steuerpflichtig** (§ 4 Nr. 12 S. 2 UStG), außer als Nebenleistung zur Wohnung desselben Mieters im selben Objekt; Option bei Gewerbe (§ 9 UStG); Kleinunternehmer (§ 19 UStG) | Automatisch je Mietvertrag (`recht.js → vatFor`) mit Begründung im Vertrag. Anlage V (netto) und DATEV (Erlöse 19 %) folgen automatisch. 19 % auf Wohnraum nur nach Rückfrage |
| Kaution | max. 3 Nettokaltmieten, 3 Raten, getrennte und insolvenzsichere Anlage (§ 551 BGB) | Warnung im Vertrag und im Mieterwechsel |
| Mieterhöhung (normale Miete) | wirksam frühestens 15 Monate nach Einzug bzw. letzter Erhöhung; Kappungsgrenze 20 % bzw. 15 % in 3 Jahren; nicht über ortsüblicher Vergleichsmiete; Textform mit Begründung (§§ 558–558b BGB) | Prüfung bei jeder Mietanpassung. Dashboard „Mieterhöhung möglich“ zeigt, wo und bis zu welchem Betrag (Kappungsgrenze) eine Erhöhung zulässig ist; Briefvorlage dazu |
| Staffel-/Indexmiete | Staffeln mindestens 1 Jahr Abstand, Beträge im Vertrag (§ 557a); Index mindestens 1 Jahr unverändert, nach VPI (§ 557b); keine Erhöhung nach §§ 558/559 | Mietart je Vertrag, Prüfung bei Anpassung |
| Mietpreisbremse | Neuvermietung max. Vergleichsmiete + 10 %; Ausnahmen (Vormiete, Neubau nach 1.10.2014, umfassende Modernisierung) mit Auskunftspflicht vor Vertragsschluss (§§ 556d–556g BGB) | Objekt-Einstellung „Mietpreisbremse“ und Vergleichsmiete €/m² → Prüfung im Mieterwechsel |
| NK-Vorauszahlung | Anpassung nur nach Abrechnung, angemessen, Textform (§ 560 Abs. 4 BGB) | Hinweis bei Anpassung, Vorschlag aus der Abrechnung, Briefvorlage |
| Betriebskostenabrechnung | Zeitraum max. 12 Monate; Zugang spätestens 12 Monate nach Ende (§ 556 Abs. 3 BGB); nur vereinbarte Kosten nach § 2 BetrKV; formelle Anforderungen (Gesamtkosten, Verteilerschlüssel, Anteil, Vorauszahlungen) | Zeitraumprüfung, Fristanzeige, Anschreiben mit **Erläuterung des Schlüssels je Kostenart** (Fläche x von y m², Personentage, Verbrauch), Einwendungsfrist (§ 556 Abs. 3 S. 5), Belegeinsicht |
| Heizkosten | 50–70 % nach Verbrauch (HeizkostenV); ohne Verbrauchserfassung Kürzungsrecht 15 % (§ 12) | Ohne Verbrauchswerte wird nach Fläche verteilt und der Mieter auf das Kürzungsrecht hingewiesen (statt dass der Vermieter die Kosten trägt) |
| CO2-Kosten | Aufteilung nach CO2KostAufG: Stufenmodell (0–95 % Vermieter) je kg CO2/m²·a; Nichtwohngebäude 50/50; Angabepflicht in der Abrechnung | Felder bei Heizung/Warmwasser, automatischer Vermieteranteil und Pflichtangaben im Anschreiben |
| Kabel-TV | seit 1.7.2024 nicht mehr umlagefähig; Glasfaser-Bereitstellungsentgelt nach § 72 TKG begrenzt | Fachkatalog, KI-Belegerkennung |
| Wohnungsgeberbestätigung | binnen 2 Wochen nach Einzug (§ 19 BMG) | Vorlage, direkt nach dem Mieterwechsel |
| Übergabeprotokoll | Beweissicherung bei Ein- und Auszug | Druckbares Protokoll mit Zählerständen, Schlüsseln, Räumen, Unterschriften |

## 2. Rechnungen (Ferienwohnung) – GoBD & UStG

- **Entwurf → Festschreiben → unveränderbar.** Die fortlaufende Nummer wird erst beim Festschreiben vergeben. Danach ist nur noch eine Stornorechnung möglich (GoBD, Unveränderbarkeit).
- **Pflichtangaben** nach § 14 Abs. 4 UStG werden vor dem Festschreiben geprüft: Name und Anschrift des Ausstellers, Steuernummer oder USt-IdNr., Empfänger (Anschrift ab 250 € brutto, Kleinbetragsrechnung § 33 UStDV), Leistungszeitraum, Positionen, Steuersatz je Position, Hinweis bei Kleinunternehmern.
- **E-Rechnung:** Bei Unternehmen als Empfänger zeigt die App den Stand an: bis Ende 2026 PDF zulässig, 2027 Pflicht für Unternehmen mit mehr als 800.000 € Vorjahresumsatz, ab 2028 für alle (B2B). Eine Ausgabe als XRechnung/ZUGFeRD ist noch nicht eingebaut.
- Übernachtung 7 %, Extras 19 %, Kurtaxe als durchlaufender Posten.

## 3. Datenschutz (DSGVO) gegenüber Mietern und Gästen

- **Auskunft nach Art. 15 DSGVO:** In der Mieterakte über „Datenauskunft“ – mit allen gespeicherten Daten, Zwecken, Rechtsgrundlagen, Speicherdauer und Rechten, zum Drucken.
- **Aufbewahrung und Löschung (Art. 17):** Einstellungen → Datenschutz & Aufbewahrung. Nach Ablauf der Fristen schlägt die App vor, ehemalige Mieter zu **anonymisieren**: Buchungsbelege 8 Jahre (§ 147 AO in der Fassung des BEG IV), Geschäftsbriefe 6 Jahre, Bücher 10 Jahre, jeweils ab Ende des Kalenderjahres. Kontakt- und Meldedaten von Feriengästen werden nach 1 Jahr bereinigt (Meldeschein § 30 BMG). Beträge bleiben für Steuer und Statistik erhalten.
- **KI datensparsam (Art. 5, 25):** Vor dem Senden an die KI werden Mieter- und Gastnamen durch „Mieter 1“ ersetzt und IBANs entfernt; die Antwort wird lokal zurückübersetzt (einstellbar). Belege werden nur auf ausdrücklichen Klick übertragen.
- Speicherung: lokal im Browser oder (Cloud-Modus) mit Datentrennung je Kunde über Row Level Security, EU-Region empfohlen.

## 4. Verkauf an Kunden (SaaS)

| Pflicht | Umsetzung |
|---|---|
| Impressum (§ 5 DDG), Datenschutzerklärung (Art. 13 DSGVO), AGB | Im Admin pflegbar, auf Start- und Kontoseite verlinkt |
| **Auftragsverarbeitung (Art. 28 DSGVO)**: Kunden verarbeiten Daten ihrer Mieter in der App, du bist Auftragsverarbeiter | AVV-Text im Admin, **Zustimmung bei der Registrierung Pflicht**, Zeitpunkt und Version werden gespeichert; bei neuer Version Banner mit „Zustimmen“ |
| Button-Lösung (§ 312j BGB) | Bestellübersicht mit Preis, Laufzeit, Kündigung, Vertragspartner und Button **„Zahlungspflichtig bestellen“** |
| Widerrufsrecht (§§ 355 ff. BGB) | Widerrufsbelehrung im Admin; ausdrückliche Zustimmung zum vorzeitigen Leistungsbeginn mit Hinweis auf Wertersatz (§§ 356 Abs. 4, 357a BGB) vor dem Bezahlen |
| Widerrufsfunktion (Richtlinie (EU) 2023/2673, gilt ab 19.06.2026) | „Vertrag widerrufen“ auf der Start- und Kontoseite, mit Bestätigung. Die nationale Umsetzung (Wortlaut der Schaltfläche) bitte anwaltlich prüfen |
| **Kündigungsbutton (§ 312k BGB)** | „Verträge hier kündigen“ → Formular **ohne Anmeldung** → „jetzt kündigen“ → sofortige Bestätigung zum Speichern/Drucken; mit `RESEND_API_KEY` zusätzlich per E-Mail (Textform), auch an den Kontoinhaber (Schutz vor Fremd-Kündigung, im Kundenportal rücknehmbar). Abo endet automatisch zum Laufzeitende |
| Preisangaben (PAngV) | Preishinweis („inkl. USt“) an allen Tarifen, im Admin pflegbar |
| Cookies/Speicher (§ 25 TDDDG) | nur technisch notwendige Speicherung (Anmeldung, Daten, Einstellungen), kein Tracking, deshalb kein Cookie-Banner nötig |
| Testphase/Abo-Ende | Nur-Lesen-Modus, Daten bleiben exportierbar (kein „Einsperren“ von Daten) |
| **Team-Zugriff** | Teammitglieder handeln für den Kunden (Verantwortlicher) als **weisungsgebundene Personen (Art. 29, 32 Abs. 4 DSGVO)**. Der Kunde lädt sie selbst ein, legt die Rolle fest und kann den Zugriff jederzeit entziehen. Hinweis im Team-Bereich: nur befugte Personen einladen, z. B. Mitarbeiter, Ehepartner oder Berater mit Verschwiegenheitspflicht. Ein Steuerberater ist eigener Verantwortlicher (Berufsgeheimnisträger), deshalb die Rolle „Nur lesen“. Die Einladung gilt nur für die eingeladene E-Mail-Adresse und läuft nach 14 Tagen ab. Die Rechte prüft der Server |
| **Mieterportal** | Der Vermieter ist Verantwortlicher, der Betreiber Auftragsverarbeiter. Der Mieter legt seinen Zugang selbst an (nur mit Einladung) und bestätigt die Datenschutzhinweise. Er sieht ausschließlich seine eigenen Vertragsdaten, Nachrichten und freigegebenen Dokumente; die Trennung erzwingt die Datenbank (RLS) und der Dateispeicher. Der Zugang lässt sich jederzeit entziehen. **Die Datenschutzerklärung um das Mieterportal ergänzen** (Zweck: Kommunikation im Mietverhältnis, Art. 6 Abs. 1 lit. b DSGVO) |
| **Reparaturen** | Ankündigung von Erhaltungsmaßnahmen (§ 555a BGB). Kleinreparaturklausel nur mit Grenze je Fall und Jahreshöchstbetrag (BGH); darüber zahlt der Mieter nichts. Modernisierung: Ankündigung 3 Monate vorher (§ 555c), Umlage 8 % (§ 559 BGB) |
| Konto löschen | Löscht Konto, Daten und Belege (Art. 17); Export vorher möglich (Art. 20) |

## 5. Mustertexte (Entwürfe – vor Verwendung anwaltlich prüfen)

### Widerrufsbelehrung (gesetzliches Muster für Dienstleistungen, Anlage 1 zu Art. 246a § 1 Abs. 2 S. 2 EGBGB)

> **Widerrufsrecht**
> Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.
> Um Ihr Widerrufsrecht auszuüben, müssen Sie uns ([Name/Firma], [Anschrift], [Telefon], [E-Mail]) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular oder die Funktion „Vertrag widerrufen“ verwenden, das jedoch nicht vorgeschrieben ist. Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.
> **Folgen des Widerrufs**
> Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.
> Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen soll, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.
>
> **Muster-Widerrufsformular** – An [Name/Firma, Anschrift, E-Mail]: Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung (*) – Bestellt am (*) – Name des/der Verbraucher(s) – Anschrift des/der Verbraucher(s) – Unterschrift (nur bei Mitteilung auf Papier) – Datum. (*) Unzutreffendes streichen.

### Gliederung Auftragsverarbeitungsvertrag (Art. 28 Abs. 3 DSGVO)

1. Gegenstand und Dauer (Bereitstellung der Software „HausOps Immobilien“, Laufzeit wie Hauptvertrag)
2. Art und Zweck der Verarbeitung; Art der Daten (Stammdaten, Kontaktdaten, Vertrags- und Zahlungsdaten, Bankverbindungen, Verbrauchsdaten, Dokumente); Kategorien Betroffener (Mieter, Mitbewohner, Feriengäste, Dienstleister)
3. Weisungsgebundenheit; Pflichten des Auftragsverarbeiters (Vertraulichkeit, TOMs nach Art. 32, Unterstützung bei Betroffenenrechten und Meldepflichten, Löschung/Rückgabe nach Vertragsende)
4. **Unterauftragsverarbeiter:** Supabase (Datenbank/Speicher, Region EU), Netlify (Hosting), Stripe (Zahlung – eigener Verantwortlicher für Zahlungsdaten), optional Anthropic (KI, nur bei Nutzung; Drittlandtransfer USA über EU-US Data Privacy Framework bzw. Standardvertragsklauseln), optional Resend (E-Mail)
5. Technische und organisatorische Maßnahmen (Verschlüsselung in Transit und at rest, Mandantentrennung per RLS, Zugriff nur über Authentifizierung, Rollen im Team (Inhaber / Bearbeiten / Nur lesen), Admins ohne Einsicht in Kundendaten, Backups, Protokollierung)
6. Kontrollrechte, Haftung, Schlussbestimmungen

## 6. Offen – bitte prüfen lassen bzw. später ergänzen

- Alle Rechtstexte (Impressum, Datenschutz, AGB, AVV, Widerruf) anwaltlich erstellen lassen; DPA/AVV mit Supabase, Netlify, Stripe, Anthropic abschließen.
- E-Rechnung als XRechnung/ZUGFeRD erzeugen (B2B, spätestens 2028).
- Bestätigungs-E-Mails (Kündigung, Widerruf) über einen E-Mail-Dienst einrichten (`RESEND_API_KEY`, `IMMO_MAIL_FROM`).
- Ferienwohnung: Gewerblichkeit, Zweckentfremdungssatzung, Beherbergungssteuer je Gemeinde; Meldeschein-Formular.
- Rechtsprechung ändert sich: Fachkatalog (`js/betrkv.js`) und Prüfungen (`js/recht.js`) jährlich prüfen; die KI-Websuche im Nebenkosten-Assistenten liefert aktuelle Quellen.
