// SMOOBU SYNC — holt Buchungen serverseitig (Proxy, wie von Smoobu vorgeschrieben)
// WICHTIG: Legacy "Api-Key" Auth wird von Smoobu am 25.09.2026 abgeschaltet.
// Dann muss auf HMAC (X-API-Key/X-Timestamp/X-Nonce/X-Signature) migriert werden — Secret nötig!
const SMOOBU_API_KEY = process.env.SMOOBU_API_KEY;

function heutePlus(tage) {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
}

async function holeSeite(page, from, to) {
  const url = `https://login.smoobu.com/api/reservations?pageSize=100&page=${page}&from=${from}&to=${to}&showCancellation=true`;
  const res = await fetch(url, { headers: { "Api-Key": SMOOBU_API_KEY, "Content-Type": "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Smoobu API Fehler: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
  }
  return res.json();
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
      typ: "buchung"
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, count: buchungen.length, buchungen, zeitraum: { from, to } }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
