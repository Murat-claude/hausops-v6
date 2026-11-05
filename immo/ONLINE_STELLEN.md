# HausOps Immobilien online stellen (ca. 15 Minuten)

Die Netlify-Seite **hausops-immobilien** ist schon angelegt. Adresse der App danach: **https://hausops-immobilien.netlify.app/immo/**

## Schritt 1 – Supabase-Projekt (5 Min.)
1. https://supabase.com öffnen, anmelden und **New project** wählen.
   - Name: `hausops-immobilien`, Region **Central EU (Frankfurt)**, ein Datenbank-Passwort vergeben und notieren.
2. Warten, bis das Projekt bereit ist (ca. 1–2 Min.).
3. Links **SQL Editor** → **New query** wählen, den kompletten Inhalt von `immo/supabase/SETUP_ALLES_IN_EINEM.sql` einfügen und **Run** drücken. Meldungen mit „NOTICE“ sind normal.
4. Links **Authentication** → **URL Configuration** öffnen:
   - Site URL: `https://hausops-immobilien.netlify.app/immo/`
   - Redirect URLs: `https://hausops-immobilien.netlify.app/immo/**`
5. *(Empfohlen für den Test)* **Authentication** → **Sign In / Providers** → **Email** → „Confirm email“ ausschalten. Dann klappt die Anmeldung sofort, ohne Bestätigungsmail. Vor dem Verkauf wieder einschalten.
6. **Project Settings** → **API Keys** (bzw. **API**) öffnen und drei Werte bereithalten:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon / public** Key
   - **service_role** Key (geheim!)

## Schritt 2 – Netlify (5 Min.)
1. https://app.netlify.com/projects/hausops-immobilien öffnen.
2. **Project configuration** → **Environment variables** → **Add a variable** und anlegen:
   - `IMMO_SUPABASE_URL` = Project URL
   - `IMMO_SUPABASE_ANON_KEY` = anon Key
   - `IMMO_SUPABASE_SERVICE_ROLE_KEY` = service_role Key (als „secret“ markieren)
   - (alternativ die drei Werte an Claude geben; Claude trägt sie ein)
3. **Project configuration** → **Build & deploy** → **Continuous deployment** → **Link repository** → GitHub → `hausops-v6`.
   - Branch to deploy: `claude/immobilien-verwaltungs-app-2wlwy9`
   - Build-Einstellungen leer lassen (kommen aus `netlify.toml`) → **Deploy**.
4. Nach ca. 1 Minute ist die App erreichbar: **https://hausops-immobilien.netlify.app/immo/**

## Schritt 3 – Loslegen
1. **Du registrierst dich zuerst.** Das erste Konto wird automatisch Admin.
2. Unter **Admin → Einstellungen** Produktname und Support-E-Mail setzen; Impressum und Datenschutz kurz eintragen.
3. Deinen Freund schickst du einfach auf die Adresse oben; er registriert sich selbst und bekommt automatisch einen eigenen, getrennten Bestand mit Testphase.
4. Willst du mit ihm gemeinsam an **einem** Bestand arbeiten: **Mein Konto → Team & Zugriff → Person einladen**.

## Optional, wenn gewünscht
- **Smoobu**: `SMOOBU_API_KEY` und `SMOOBU_API_SECRET` als Variablen setzen (dieselben Werte wie bei Livora Clean).
- **E-Mail-Versand von Rechnungen**: `RESEND_API_KEY` und `IMMO_MAIL_FROM` (siehe README).
- **KI**: Jeder Nutzer trägt seinen eigenen Claude-API-Schlüssel unter Einstellungen → KI ein.

Hinweis: Die Startseite `https://hausops-immobilien.netlify.app/` zeigt die andere App aus demselben Repository. Die Immobilien-App liegt unter **/immo/**.
