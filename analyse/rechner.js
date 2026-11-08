// Reine Rechenlogik (ohne DOM), damit sie sich testen lässt.
// Alle Werte vor Steuern. Prozentangaben als Prozentzahl (6.5 = 6,5 %).

export function annuitaetMonat(darlehen, zinsProzent, tilgungProzent) {
  if (darlehen <= 0) return 0;
  return (darlehen * (zinsProzent + tilgungProzent)) / 100 / 12;
}

export function rechneSzenario(basis, s, fin) {
  const kp = num(basis.kaufpreis);
  const flaeche = num(basis.wohnflaeche_m2);
  const nkProzent = num(basis.grunderwerbsteuer_prozent) + num(basis.notar_grundbuch_prozent) + num(basis.makler_prozent);
  const nebenkosten = (kp * nkProzent) / 100;
  const sanierung = num(s.sanierung);
  const invest = kp + nebenkosten + sanierung;

  const ek = Math.min(num(fin.eigenkapital), invest);
  const darlehen = Math.max(invest - ek, 0);
  const zins = num(fin.zins_prozent) + num(fin.zins_aufschlag);
  const rateMonat = annuitaetMonat(darlehen, zins, num(fin.tilgung_prozent));
  const zinsMonat = (darlehen * zins) / 100 / 12;

  const mieteMonat = num(s.kaltmiete_monat) * (1 + num(fin.miete_aenderung_prozent) / 100);
  const jahresKaltmiete = mieteMonat * 12;
  const effektivMiete = jahresKaltmiete * (1 - num(s.leerstand_prozent) / 100);
  const bewirtschaftung = num(s.nicht_umlagefaehig_monat) * 12 + num(s.instandhaltung_m2_jahr) * flaeche + num(s.verwaltung_monat) * 12;
  const reinertrag = effektivMiete - bewirtschaftung;

  const cashflowMonat = reinertrag / 12 - rateMonat;
  return {
    nebenkosten,
    invest,
    eigenkapital: ek,
    darlehen,
    rateMonat,
    zinsMonat,
    tilgungMonat: rateMonat - zinsMonat,
    jahresKaltmiete,
    bewirtschaftung,
    reinertrag,
    cashflowMonat,
    bruttorendite: kp > 0 ? (jahresKaltmiete / kp) * 100 : null,
    nettorendite: invest > 0 ? (reinertrag / invest) * 100 : null,
    faktor: jahresKaltmiete > 0 ? kp / jahresKaltmiete : null,
    preisM2: flaeche > 0 ? kp / flaeche : null,
    ekRendite: ek > 0 ? ((reinertrag - zinsMonat * 12) / ek) * 100 : null,
    // Eigenkapital, ab dem der Cashflow vor Steuern 0 ist
    ekFuerCashflow0: ekFuerCashflowNull(invest, reinertrag, zins, num(fin.tilgung_prozent)),
  };
}

function ekFuerCashflowNull(invest, reinertrag, zins, tilgung) {
  const satz = (zins + tilgung) / 100;
  if (satz <= 0) return 0;
  const maxDarlehen = Math.max(reinertrag, 0) / satz;
  return Math.max(invest - maxDarlehen, 0);
}

export function num(v) {
  const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : v;
  return Number.isFinite(n) ? n : 0;
}
