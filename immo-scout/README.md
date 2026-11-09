# Immo-Scout (Hamm + 30 km)

Tägliche Objektsuche für Anlage-Immobilien: Mehrfamilienhäuser, Häuser, Sanierungsobjekte (Fix & Flip),
Eigentumswohnungen, Grundstücke, Gewerbe/Büro zum Umbau, Garagen, möblierte Wohnungen (FeWo-Idee).

- `scout.py suche` lädt je Kategorie eine Ergebnisseite (neueste zuerst) von Kleinanzeigen, filtert Neubau-/Bauträger-
  und Gesuch-Anzeigen, bewertet nach Preis/m² und geschätztem Faktor (7,5 €/m² Miete) und schreibt `heute.md`.
- `scout.py detail N` lädt die Detailseiten der N besten neuen Treffer (höchstens 12).
- `scout.py merken` speichert die gesichteten Anzeigen in `gesehen.json`, damit am nächsten Tag nur Neues kommt.
- Tagesberichte liegen in `berichte/JJJJ-MM-TT.md`.

Abrufe sind bewusst sparsam: eigener User-Agent, 2 Sekunden Pause, nur Pfade, die robots.txt erlaubt.
