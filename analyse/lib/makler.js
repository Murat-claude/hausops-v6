// Makleranfrage nach dem Analyse-Skill: kurz, überzeugend, wenig verlangen, Stärke zeigen.
// Keine Preisnennung, keine lange Unterlagenliste im Erstkontakt. Versand immer nur durch Murat oder Yasemin.
export const ABSENDER_STANDARD = { name: "Murat & Yasemin Kurt", ort: "Hamm (Westfalen)", telefon: "", email: "" };

const kurzTitel = (t) => String(t || "Ihr Objekt").replace(/\s*[|–-]\s*(provisionsfrei|von privat|ohne makler).*$/i, "").slice(0, 70).trim();

export function makleranfrage(eingabe = {}, daten = {}, absender = {}) {
  const ab = { ...ABSENDER_STANDARD, ...Object.fromEntries(Object.entries(absender).filter(([, v]) => v)) };
  const an = eingabe.anbieter || {};
  const ort = String(daten.ort || eingabe.ort || "").replace(/^\d{5}\s*/, "") || "Ihrer Region";
  const titel = kurzTitel(daten.titel || eingabe.titel);
  const nr = an.objekt_nr ? `Objekt-Nr. ${an.objekt_nr}` : an.anzeigen_id ? `Anzeige ${an.anzeigen_id}` : titel;
  // Anrede ohne Annahme über das Geschlecht
  const anrede = an.name ? `Guten Tag ${an.name},` : "Guten Tag,";
  const art = String(daten.objektart || eingabe.objektart || "");
  const vorab = /grundst/i.test(art) ? "das Exposé und kurz die Angaben zum Baurecht"
    : /büro|gewerbe|hotel|pension/i.test(art) ? "das Exposé mit Grundrissen und kurz den aktuellen Vermietungsstand"
    : "das Exposé und kurz die aktuelle Mietsituation";
  const tel = ab.telefon || "[Telefon]";
  const mail = ab.email || "[E-Mail]";

  const betreff = `Kaufinteresse ${nr} – finanzierungsstarke Investoren, schnelle Abwicklung`;
  const email = `${anrede}

Ihr Objekt „${titel}“ in ${ort} passt gut in unser Portfolio.

Wir sind Immobilieninvestoren aus Hamm, halten mehrere Bestandsobjekte in NRW und kaufen regelmäßig. Eigenkapital ist vorhanden und unsere Hausbank steht hinter uns – eine Finanzierungsbestätigung senden wir Ihnen gern sofort zu.

Bei uns haben Sie klare Entscheidungen, kurze Wege und eine zügige Abwicklung bis zum Notartermin.

Wir würden das Objekt gern zeitnah besichtigen. Könnten Sie uns vorab ${vorab} schicken?

Freundliche Grüße
${ab.name}
${ab.ort}
Tel. ${tel}
${mail}`;

  const kurz = `${anrede} Ihr Objekt in ${ort} passt gut in unser Portfolio. Wir sind Immobilieninvestoren aus Hamm mit mehreren Bestandsobjekten in NRW, die Finanzierung steht – eine Bestätigung schicken wir gern sofort. Wir würden zeitnah besichtigen und entscheiden schnell. Könnten Sie uns vorab ${vorab} senden? Viele Grüße, ${ab.name}, Tel. ${tel}`;

  if (an.anmieten || eingabe.anmieten) {
    const betreffM = `Mietanfrage ${nr} – zuverlässige Mieter, langfristig`;
    const emailM = `${anrede}

wir interessieren uns für Ihr Objekt „${titel}“ in ${ort} und würden es gern langfristig anmieten.

Wir sind ein Ehepaar aus Hamm und Immobilieninvestoren. Unser Plan: die Wohnung hochwertig einzurichten und an Feriengäste zu vermieten – selbstverständlich nur mit Ihrer schriftlichen Zustimmung und allen nötigen Genehmigungen. Für Sie heißt das: pünktliche Miete, eine gepflegte Wohnung, regelmäßige Reinigung und eine feste Ansprechperson vor Ort.

Hätten Sie grundsätzlich Interesse an diesem Modell? Gern stellen wir uns bei einer Besichtigung vor.

Freundliche Grüße
${ab.name}
${ab.ort}
Tel. ${tel}
${mail}`;
    const kurzM = `${anrede} wir würden Ihr Objekt in ${ort} gern langfristig anmieten und – nur mit Ihrer schriftlichen Zustimmung – möbliert an Feriengäste vermieten. Pünktliche Miete, gepflegte Wohnung, feste Ansprechperson vor Ort. Hätten Sie grundsätzlich Interesse? Viele Grüße, ${ab.name}, Tel. ${tel}`;
    return { betreff: betreffM, email: emailM, kurz: kurzM, empfaenger: an.email || "", ansprechpartner: [an.name, an.firma].filter(Boolean).join(", "), telefon_makler: an.telefon || "", fehlt: [!ab.telefon && "Telefon", !ab.email && "E-Mail"].filter(Boolean) };
  }
  const fehlt = [!ab.telefon && "Telefon", !ab.email && "E-Mail"].filter(Boolean);
  return { betreff, email, kurz, empfaenger: an.email || "", ansprechpartner: [an.name, an.firma].filter(Boolean).join(", "), telefon_makler: an.telefon || "", fehlt };
}
