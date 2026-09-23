# Architektur

Dieses Dokument beschreibt Datenmodell, Konventionen und Modulgrenzen des Solar Shadow Analyzer.
Es ist die verbindliche Referenz für alle Beiträge.

## Stack

- React 19, TypeScript 6 (strict), Vite 8, Vitest 5 (jsdom), ESLint 10 (flat config) + Prettier
- Zustand für den App-State (mit `persist` für localStorage)
- Three.js über `@react-three/fiber` 9 + `@react-three/drei` 10 (nur in der lazy geladenen 3D-Ansicht)
- Styling: CSS-Variablen (`src/styles/global.css`) + CSS Modules pro Komponente (`*.module.css`), keine Inline-Style-Monolithen
- Alle 2D-Visualisierungen als SVG (Heatmap als `<canvas>`), keine Chart-Library

## Verzeichnisstruktur

```
src/
  main.tsx, App.tsx          App-Einstieg und Layout
  model/                     Reine, UI-freie Berechnungen (keine React-Imports!)
    types.ts                 Alle Domänentypen (Config, Vec3, Ergebnisse …)
    defaults.ts              DEFAULT_CONFIG, Wertebereiche (Limits) aller Felder
    units.ts                 deg/rad, cm↔m, clamp, Winkel-Normalisierung
    time.ts                  Zeitzonen (IANA via Intl), Ortszeit ↔ UTC, Tag im Jahr
    sun.ts                   Sonnenstand (NOAA), Sonnenauf-/untergang, Sonnenvektor
    geometry.ts              Fassaden-Koordinaten, Panel-Layout, Schattenwurf zwischen Stockwerken
    horizon.ts               Horizontprofile, Hindernisse (Nachbargebäude) → Horizont, CSV-Import
    terrain.ts               Gelände-Horizont aus DEM-Kacheln (AWS Terrarium) im Browser
    irradiance.ts            Clear-Sky-Modell, Einfallswinkel, POA-Einstrahlung, Himmelssichtfaktor
    weather.ts               Stündliche Wetterdaten (Open-Meteo ERA5) + Clear-Sky-Jahr
    simulation.ts            Jahressimulation (kWh je Stockwerk/Monat, Verschattungsverlust)
    analysis.ts              Heatmap-Daten, Neigungs-Sweep, Tagesprofil
    economics.ts             Wirtschaftlichkeit
    presets.ts               Standort- und Modul-Presets
    share.ts                 Config ⇄ URL-Hash (Base64url), Validierung/Migration
  state/                     Zustand-Store(s) und Selektoren
  i18n/                      Sprache (de/en), useMessages, Zahl-/Datumsformat
  hooks/                     React-Hooks, die Modell-Funktionen memoisiert aufrufen
  controls/                  Eingabe-Komponenten (Sidebar)
  views/                     Ansichten (SVG + 3D)
  charts/                    Diagramme
  export/                    PNG/CSV/JSON-Export
  styles/                    globale Styles / Design-Tokens
```

## Einheiten und Konventionen

| Grösse | Konvention |
|---|---|
| Winkel in API/Config | Grad. Intern in Formeln Radiant (`units.ts`). |
| Azimut | 0° = Nord, 90° = Ost, 180° = Süd, 270° = West (im Uhrzeigersinn). |
| Fassaden-Azimut | Richtung, in die die Fassade (Aussennormale) schaut. |
| Panelneigung (`panels.tiltFromVertical`) | 0° = senkrecht hängend, 90° = liegend. PV-Neigung ab Horizontal: `β = 90° − tiltFromVertical`. **Überall in der UI wird `tiltFromVertical` angezeigt**, β nur als Zusatzinfo. |
| Längen in Config | Gebäude/Panels in **cm** (UI-freundlich), Hindernisse in **m**, Standorthöhe in m. |
| Längen im Modell | **Meter**. Umrechnung ausschliesslich in `panelLayout()` / `units.ts`. |
| Zeit | Modell rechnet in UTC-Millisekunden. UI zeigt **lokale Uhrzeit** der Standort-Zeitzone (inkl. Sommerzeit). |
| Stockwerke | Index `k = 0 … numFloors−1`, 0 = unterstes Panel-Stockwerk. Anzeige-Nummer = `building.lowestFloor + k`. |

### Koordinatensysteme

- **ENU (Welt):** `x` = Ost, `y` = Nord, `z` = oben. Sonnenvektor `s = (cos h·sin A, cos h·cos A, sin h)`.
- **Fassadenrahmen:** `n` = Aussennormale `(sin γ, cos γ, 0)`, `u` = entlang der Fassade, positiv nach **rechts für eine Person, die von aussen auf die Fassade schaut**: `u = (−cos γ, sin γ, 0)`, `z` = oben.
  Sonne im Fassadenrahmen: `s_n = cos h·cos(A−γ)`, `s_u = −cos h·sin(A−γ)`, `s_z = sin h`.
- **Panel-Ebene:** Koordinaten `(u, v)`, `v ∈ [0, L]` = Abstand entlang der Neigung ab Oberkante (am Geländer). Punkt `(u, v)` liegt bei `n = n_rail + v·sin θ`, `z = z_rail − v·cos θ` (θ = tiltFromVertical).
- **three.js:** `X = Ost`, `Y = oben`, `Z = −Nord` (Süd = +Z). Umrechnung nur in `views/scene3d/coords.ts`.

## Geometrie des Schattenwurfs (Stockwerk k+1 → k)

Die Panelreihen aller Stockwerke sind identisch und um `H` (Stockwerkhöhe) vertikal versetzt. Beide Panel-Ebenen sind parallel;
der Schatten der oberen Reihe auf der unteren Ebene ist daher eine **Verschiebung** der oberen Reihe:

```
cosInc = s_n·cos θ + s_z·sin θ          (Einfallswinkel-Cosinus, Normale N = (cos θ, sin θ) in (n,z))
t      = H·sin θ / cosInc                (Strahllänge zwischen den Ebenen)
Δu     = t·s_u                           (seitliche Verschiebung)
Δv     = t·s_n / sin θ = H·s_n / cosInc  (Verschiebung entlang der Neigung)
```

Ein Punkt `(u, v)` der unteren Reihe ist verschattet, wenn `(u + Δu, v + Δv)` auf einem Modul der oberen Reihe liegt.
Verschattetes Rechteck: `v ∈ [0, L − Δv]`, `u ∈ Modul − Δu`. Für θ = 0 (senkrecht) gibt es keinen Schatten.
Äquivalent zum 2D-Kriterium: Schatten beginnt, sobald der Profilwinkel `atan(s_z/s_n)` den kritischen Winkel
`atan((H − L·cos θ)/(L·sin θ))` überschreitet — aber nur, wenn zusätzlich `|Δu|` kleiner als die Reihenbreite ist.
Modelliert wird nur das direkt darüberliegende Stockwerk: Weiter entfernte Stockwerke verschieben den Schatten weiter in
dieselbe Richtung und liegen bei lückenlosen Reihen vollständig im Schatten des nächsten Stockwerks. Nur durch Lücken
zwischen Modulen kann ein höheres Stockwerk zusätzlich schatten; der Effekt liegt in realistischen Setups unter
0.01 Prozentpunkten des Jahresertrags und wird vernachlässigt.

Die Gebäudewand blockiert Sonne mit `s_n ≤ 0` („Sonne hinter der Fassade“). Die Balkonplatte liegt hinter der
Geländerebene und wirft keinen Schatten auf aussen hängende Panels.

## Energie-Modell

Pro Zeitschritt (Wetterdaten stündlich, Werte = Mittel der vorangehenden Stunde → Sonnenstand zur Intervallmitte):

1. Sonnenstand (NOAA) → Fassadenrahmen.
2. Direktstrahlung blockiert, wenn `s_n ≤ 0` oder Sonnenhöhe < Horizont des Stockwerks (Gelände ∪ manuell ∪ Hindernisse).
3. Beam auf Panel: `DNI · cosInc⁺ · IAM · (1 − Beschattung)`, IAM nach ASHRAE (b0 = 0.05).
   Beschattung je Modul: `linear` (Flächenanteil) oder `substring` (3 Bypass-Teilstränge parallel zur langen Modulseite; ein berührter Teilstrang verliert seinen Beam-Anteil).
4. Diffus: isotropes Himmelsmodell mit numerisch integriertem **Himmelssichtfaktor** je Stockwerk (Horizont, Fassade, oberes Panel).
5. Bodenreflexion: `GHI · Albedo · (1 − cos β)/2`.
6. Modultemperatur `T_c = T_a + POA·(NOCT − 20)/800`, DC = `Wp·POA/1000·(1 + γ_T·(T_c − 25))`, dann Systemverluste, AC-Begrenzung je Stockwerk.

Datenquellen: Open-Meteo Historical Weather API (Modell `best_match`, CORS, ohne Key) für ein wählbares Jahr; Fallback:
Clear-Sky (Meinel-DNI, DHI = 0.1·DNI) — in der UI als „theoretisches Maximum bei klarem Himmel“ gekennzeichnet.

Validierung (Bern, 47.1° N / 7.45° E, freistehend, 1 kWp, 14 % Verluste): Abweichung zu PVGIS-ERA5 (gleiche Jahre
2020–2023) −0.7 % bis −1.3 %, zu PVGIS-SARAH3 (2005–2023) +3.6 % bis +5.8 % für β = 35° Süd, 45° und 90° bei 202°.

## Gelände-Horizont

`terrain.ts` lädt AWS-Terrarium-Kacheln (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, CORS `*`),
dekodiert Höhen (`(R·256 + G + B/256) − 32768`) und berechnet für jeden Azimut (1°) den maximalen Höhenwinkel bis ~50 km
inkl. Erdkrümmung und Refraktion (`Δz = d²/(2R)·(1 − k)`, k = 0.13). Validierung gegen PVGIS-`printhorizon`
(im Browser nicht nutzbar, da ohne CORS) erfolgt über `scripts/validate-terrain.ts`.

## State

- `useConfigStore` (Zustand, persistiert): `config: Config` + Setter pro Bereich.
- `useTimeStore` (nicht persistiert): Datum, Uhrzeit (lokale Minuten), Animation.
- `useUiStore` (persistiert): Sprache, Theme, sichtbare Ansichten.
- URL-Hash `#c=…` überschreibt beim Laden die gespeicherte Config (Teilen-Link).
- Abgeleitete Daten (Wetter, Horizont, Simulation) über Hooks in `hooks/`, memoisiert per stabiler Config-Referenz.

## i18n

Jede Komponente definiert ihre Texte lokal:

```ts
const messages = { de: { title: 'Heatmap' }, en: { title: 'Heatmap' } };
const t = useMessages(messages);
```

Gemeinsame Texte liegen in `i18n/common.ts`. Zahlen/Daten werden über `useFormat()` (Intl, Locale `de-CH`/`en-GB`) formatiert.

## Tests

- Modell: Unit-Tests mit Referenzwerten (NOAA-Tabellenwerte, analytische Geometrie-Fälle, Energieerhaltung).
- Komponenten: Rendern + Interaktion (Testing Library). WebGL wird in jsdom gemockt; die 3D-Ansicht wird zusätzlich per
  Playwright-Screenshot in Chromium geprüft (`npm run e2e`).
