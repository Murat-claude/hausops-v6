// SMOOBU SYNC — holt Buchungen serverseitig (Proxy, wie von Smoobu vorgeschrieben)
// Seit 25.09.2026 verlangt Smoobu HMAC-Signaturen (X-API-Key/X-Timestamp/X-Nonce/X-Signature).
// Netlify-Variablen: SMOOBU_API_KEY + SMOOBU_API_SECRET (Smoobu → Einstellungen → Erweitert → API-Schlüssel).
// Ohne Secret wird das alte Verfahren versucht (wird von Smoobu abgelehnt).
// Wird von Livora Clean und HausOps Immobilien genutzt – Felder nur ergänzen, nicht umbenennen.
const { smoobuGet } = require("../lib/immo-sync-lib.js");
const SMOOBU_API_KEY = process.env.SMOOBU_API_KEY;

function heutePlus(tage) {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
}

async function holeSeite(page, from, to) {
  return smoobuGet("/api/reservations", { pageSize: 100, page, from, to, showCancellation: "true" });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  if (!SMOOBU_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: "SMOOBU_API_KEY fehlt (Netlify Environment Variable nicht gesetzt)." }) };
  }

  try {
    // Zeitraum: 30 Tage rückwirkend (offene Endkontrollen) bis 180 Tage voraus
    const from = heutePlus(-30);
    const to = heutePlus(180);

    let alle = [];
    let seite = 1, seitenGesamt = 1;
    do {
      const data = await holeSeite(seite, from, to);
      alle = alle.concat(data.bookings || []);
      seitenGesamt = data.page_count || 1;
      seite++;
    } while (seite <= seitenGesamt && seite <= 10); // Sicherheitslimit

    // Felder aus der Smoobu-API sind teils mit Bindestrich (guest-name, check-in, check-out)
    const buchungen = alle.map((b) => ({
      smoobu_id: b.id,
      einheit_name: b.apartment?.name || "Unbekannt",
      gast_name: b["guest-name"] || "Gast",
      personen: (b.adults || 0) + (b.children || 0) || 1,
      start_datum: b.arrival,
      end_datum: b.departure,
      check_in: b["check-in"] || "15:00",
      check_out: b["check-out"] || "11:00",
      preis: b.price || 0,
      status: b.type === "cancellation" ? "cancelled" : "confirmed",
      kanal: b.channel?.name || "Direkt",
      typ: "buchung",
      // Zusätzliche Felder für HausOps Immobilien (Rechnung, Gästekommunikation)
      erwachsene: b.adults || 0,
      kinder: b.children || 0,
      email: b.email || "",
      telefon: b.phone || "",
      adresse: b.address || null,
      anzahlung: b.prepayment || 0,
      notiz: b.notice || "",
      einheit_id: b.apartment?.id || null
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, count: buchungen.length, buchungen, zeitraum: { from, to } }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
