// Smoobu für Homevio: Buchungen mit dem Smoobu-Zugang DES JEWEILIGEN KONTOS abrufen (nicht mit einem gemeinsamen Schlüssel)
const { smoobuGet } = require("./immo-sync-lib.js");

const heutePlus = (tage, now = new Date()) => { const d = new Date(now); d.setDate(d.getDate() + tage); return d.toISOString().slice(0, 10); };

function adresse(a) {
  if (!a || typeof a !== "object") return null;
  const street = a.street || a.streetAndNumber || a.address || "";
  const postalCode = a.postalCode || a.postal_code || a.zip || "";
  const location = a.location || a.city || "";
  const country = a.country || a.countryCode || "";
  return street || postalCode || location ? { street, postalCode, location, country } : null;
}

function mapBooking(b) {
  return {
    smoobu_id: b.id,
    einheit_name: b.apartment?.name || "Unbekannt",
    einheit_id: b.apartment?.id || null,
    gast_name: b["guest-name"] || [b.firstname || b.firstName, b.lastname || b.lastName].filter(Boolean).join(" ") || "Gast",
    personen: (b.adults || 0) + (b.children || 0) || 1,
    erwachsene: b.adults || 0, kinder: b.children || 0,
    start_datum: b.arrival, end_datum: b.departure,
    preis: b.price || 0, anzahlung: b.prepayment || 0,
    status: b.type === "cancellation" ? "cancelled" : "confirmed",
    kanal: b.channel?.name || "Direkt",
    email: b.email || "", telefon: b.phone || "", adresse: adresse(b.address),
    vorname: b.firstname || b.firstName || "", nachname: b.lastname || b.lastName || "",
    firma: b["company-name"] || b.companyName || b.company || "",
    referenz: b["reference-id"] || b.referenceId || "",
    gast_id: b.guestId || b["guest-id"] || null,
    sprache: b.language || "", notiz: b.notice || "",
  };
}

async function gaesteErgaenzen(buchungen, creds, fetchImpl) {
  const offen = buchungen.filter((b) => b.gast_id && (!b.adresse || !b.email)).slice(0, 40);
  for (let i = 0; i < offen.length; i += 5) {
    await Promise.all(offen.slice(i, i + 5).map(async (b) => {
      try {
        const g = await smoobuGet(`/api/guests/${encodeURIComponent(b.gast_id)}`, {}, { ...creds, fetchImpl });
        const ga = adresse(g.address) || adresse(Array.isArray(g.addresses) ? g.addresses[0] : null);
        if (ga && !b.adresse) b.adresse = ga;
        const mail = g.email || (Array.isArray(g.emails) ? (g.emails[0]?.email || g.emails[0]) : "");
        if (mail && !b.email) b.email = String(mail);
        const tel = g.phone || (Array.isArray(g.telephoneNumbers) ? (g.telephoneNumbers[0]?.number || g.telephoneNumbers[0]) : "");
        if (tel && !b.telefon) b.telefon = String(tel);
        const firma = g.companyName || g.company || "";
        if (firma && !b.firma) b.firma = String(firma);
      } catch { /* Gast-Profil nicht verfügbar */ }
    }));
  }
}

// Zeitraum: standardmäßig 1 Jahr zurück (Rechnungen, Monatsberichte) bis 1 Jahr voraus
async function fetchBookings(creds, { daysBack = 365, daysAhead = 365, guests = true, fetchImpl = fetch, now = new Date() } = {}) {
  const from = heutePlus(-daysBack, now), to = heutePlus(daysAhead, now);
  let alle = [], seite = 1, seiten = 1;
  do {
    const data = await smoobuGet("/api/reservations", { pageSize: 100, page: seite, from, to, showCancellation: "true" }, { ...creds, fetchImpl });
    alle = alle.concat(data.bookings || []);
    seiten = data.page_count || 1; seite++;
  } while (seite <= seiten && seite <= 30);
  const buchungen = alle.map(mapBooking);
  if (guests) await gaesteErgaenzen(buchungen, creds, fetchImpl);
  return { buchungen, zeitraum: { from, to } };
}

module.exports = { fetchBookings, mapBooking, adresse };
