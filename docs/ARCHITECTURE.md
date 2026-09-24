# Architektur

Dieses Dokument beschreibt Datenmodell, Konventionen und Modulgrenzen des Solar Shadow Analyzer.
Es ist die verbindliche Referenz für alle Beiträge.

## Stack

- React 19, TypeScript 6 (strict), Vite 8
- Vitest 5 (zwei Projekte: `model` in Node, `ui` in jsdom) + Testing Library, Playwright (E2E in Chromium)
- ESLint 10 (flat config, typbasierte Regeln für `src/`) + Prettier 3
- Zustand für den App-State (mit `persist` für localStorage)
- Three.js über `@react-three/fiber` 9 + `@react-three/drei` 10 (nur in der lazy geladenen 3D-Ansicht)
- fast-png: Dekodierung der DEM-Kacheln (Terrarium-PNG) in `model/terrain.ts`
- Styling: CSS-Variablen (`src/styles/global.css`) + CSS Modules pro Komponente (`*.module.css`), keine Inline-Style-Monolithen
- Alle 2D-Visualisierungen als SVG (Heatmap als `<canvas>`), keine Chart-Library

## Verzeichnisstruktur

```
src/
  main.tsx                 Einstieg: initUrlSync() vor dem ersten Render, dann <App/>
  App.tsx                  Layout: Header, Sidebar, KPI-Leiste, Ansichten, Analyse, Footer
  setupTests.ts            jsdom-Setup der UI-Tests (fetch gesperrt; Stubs für matchMedia, ResizeObserver,
                           IntersectionObserver, Canvas-Kontext = null, URL.createObjectURL)
  model/                   Reine, UI-freie Berechnungen (keine React-/State-/UI-Imports, per ESLint erzwungen)
    types.ts               Alle Domänentypen (Config, Vec3, Ergebnisse …)
    defaults.ts            DEFAULT_CONFIG, Wertebereiche (LIMITS) aller Felder
    units.ts               deg/rad, cm↔m, clamp, Winkel-Normalisierung
    time.ts                Zeitzonen (IANA via Intl), Ortszeit ↔ UTC, Tag im Jahr
    sun.ts                 Sonnenstand (NOAA), Sonnenauf-/untergang, Sonnenvektor
    geometry.ts            Fassaden-Koordinaten, Panel-Layout, Schattenwurf zwischen Stockwerken, Teilstrang-Verlust
    horizon.ts             Horizontprofile, Hindernisse (Nachbargebäude) → Horizont, CSV-Import
    terrain.ts             Gelände-Horizont aus DEM-Kacheln (AWS Terrarium) im Browser; Kachel-Retries (2×, n·400 ms,
                           nur Netzwerkfehler/429/5xx), Ergebnis-Cache ssa.terrain.v1:* (max. 40: 8 Höhen × 5 Standorte)
    pvgis.ts               PVGIS-printhorizon-Import (JSON/CSV/basic; Azimut S-basiert → N-basiert: A + 180)
    irradiance.ts          Clear-Sky-Modell, Einfallswinkel, IAM, POA-Einstrahlung, Himmelssichtfaktor
    weather.ts             Stündliche Wetterdaten (Open-Meteo-Archiv, Modell best_match) + Clear-Sky-Jahr,
                           localStorage-Cache ssa.weather.v1:* (max. 3 Jahre)
    simulation.ts          Jahressimulation (kWh je Stockwerk/Monat, Verschattungsverlust)
    analysis.ts            Heatmap-Daten, Neigungs-Sweep (0–90° in 5°-Schritten), Tagesprofil
    economics.ts           Wirtschaftlichkeit
    presets.ts             Standort- (24) und Modul-Presets (5), Ortssuche (Open-Meteo Geocoding)
    share.ts               Config ⇄ URL-Hash (Base64url) und JSON, Validierung (sanitizeConfig), Migration v1 → v2
  app/                     App-Shell: Header, WarningsBar, KpiBar, ViewToggles, ShareButton, ExportMenu, Footer,
                           DataLoader (startet die Loader), useDocumentSettings (<html> data-theme/lang, Titel,
                           theme-color)
  components/              Generische UI-Bausteine: Button, Card, InfoTip, NumberField (+ numberInput.ts),
                           Placeholder, Section, Segmented, SelectField, Skeleton, Slider, Spinner, TextField,
                           Toggle, ViewCard, icons, cssVars
  controls/                Eingaben (Sidebar): Sidebar, TimeControls, TiltControl und je Einstellungsgruppe eine
                           *Section.tsx (Location, Building, Panel, System, Horizon, Weather, Economics)
    location/              PlaceSearch, PresetSelect, MyLocationButton, CompassDial, TimeZoneField, timeZones, icons
    horizon/               TerrainStatus, ObstacleList/ObstacleItem, ManualHorizon (inkl. PVGIS-Dateiimport),
                           HorizonSparkline, horizonData, icons
  views/                   2D-Ansichten: FrontalView, ProfileView (Seite), SunPathView, PanelShadowView
    svg/                   Reine Layout-Module ohne React (frontalLayout, profileLayout, sunPathLayout,
                           panelShadowLayout, geometry2d, legend, constants) + SvgFigure, Legend, ViewNotice,
                           primitives, ids, messages, useElementWidth, svg.module.css; testUtils.ts (nur für Tests)
    scene3d/               3D-Ansicht (three.js/R3F), lazy: index.ts → Scene3D → SceneView; SceneStage, SceneContent,
                           Building, PanelRows, Ground, Surroundings, SkyAndLights, SunMarker, CameraRig, Label,
                           SceneErrorBoundary, useSceneData; coords.ts, sceneLayout, palette, shadeMaterial
                           (Modellschatten-Overlay), textures, webgl, messages
  charts/                  Analyse: DailyProfileChart, ShadeHeatmap (Canvas), MonthlyYieldChart, TiltSweepChart,
                           EconomicsCard, MonthlyTable
    lib/                   Chart-Bausteine ohne Library: scale, Axes, paths, text, timeAxis, legend/SvgLegend,
                           ChartTooltip, ChartStats, DataTable, HatchPattern, heatmap, monthlyTable, colors,
                           canvasTheme, floors, focus, sourceLabel, usePlotPointer, useElementWidth, useSvgId
  export/                  png, csv (RFC 4180), resultsCsv (Monatsertrag, Neigungsvergleich, Heatmap), configFile
                           (JSON speichern/laden), clipboard, download, filenames, Druckbericht (print.ts, print.css,
                           PrintReport.tsx)
  hooks/                   useModel (memoisierte Modell-Hooks) + cache.ts, useTerrain/useWeather (je Loader + Leser),
                           useAnimation
  state/                   configStore, timeStore, uiStore, dataStore, urlSync (#c=-Hash), storage (localStorage,
                           das Fehler abfängt)
  i18n/                    index.ts (useLang, useMessages, useFormat, floorLabel, compassPoint …), common.ts
  styles/                  global.css: Design-Tokens (CSS-Variablen) für Dark/Light, globale Styles
  test/                    utils.ts: resetStores(), TEST_DATE

e2e/                       Playwright-Specs (smoke.spec.ts, features.spec.ts)
scripts/validate-terrain.ts  Gelände-Horizont gegen PVGIS printhorizon prüfen (braucht Netzwerk)
.github/workflows/ci.yml   CI: Lint, Format, Typecheck, Tests, Build; danach E2E
```

## Einheiten und Konventionen

- **Winkel in API/Config:** Grad. Intern in Formeln Radiant (`units.ts`).
- **Azimut:** 0° = Nord, 90° = Ost, 180° = Süd, 270° = West (im Uhrzeigersinn).
- **Fassaden-Azimut:** Richtung, in die die Fassade (Aussennormale) schaut.
- **Panelneigung (`panels.tiltFromVertical`):** 0° = senkrecht hängend, 90° = liegend. PV-Neigung ab Horizontal:
  `β = 90° − tiltFromVertical`. **Überall in der UI wird `tiltFromVertical` angezeigt**, β nur als Zusatzinfo.
- **Längen in Config:** Gebäude/Panels in **cm** (UI-freundlich), Hindernisse in **m**, Standorthöhe in m.
- **Längen im Modell:** **Meter**. Umrechnung ausschliesslich in `panelLayout()` und `floorPlacements()`
  (geometry.ts) über `cmToM` aus `units.ts`.
- **Zeit:** Modell rechnet in UTC-Millisekunden. UI zeigt **lokale Uhrzeit** der Standort-Zeitzone (inkl. Sommerzeit).
- **Stockwerke:** Index `k = 0 … numFloors−1`, 0 = unterstes Panel-Stockwerk. Anzeige-Nummer = `building.lowestFloor + k`.

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
   Beschattung je Modul (`geometry.ts`, `substringBeamLoss`):
   - `linear`: verschatteter Flächenanteil des Moduls.
   - `substring`: 3 Bypass-Teilstränge parallel zur langen Modulseite, je 2 Zellreihen. Zellraster: 6 Zellen über die
     kurze Seite × `round(lang / (kurz/6))` entlang der langen Seite (deckt das Modul exakt ab; quer = Bänder entlang
     `u`, hoch = Bänder entlang `v`). Ein Teilstrang verliert seinen Beam-Anteil im Verhältnis der verschatteten
     Fläche seiner am stärksten verschatteten Zelle zur Zellfläche, höchstens ganz. Modulverlust = Mittel der
     3 Teilstränge, stets ≥ `linear`.
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
(im Browser nicht nutzbar, da ohne CORS) erfolgt über `scripts/validate-terrain.ts`: Beobachter 5 m über Grund,
RMS 0.34° / 1.19° / 1.22° und Korrelation r = 0.986 / 0.993 / 0.984 für Mittelland (47.1/7.45), Grindelwald
(46.62/8.04) und Zermatt (46.02/7.75), Lauf vom 24.09.2026. Eine heruntergeladene printhorizon-Datei kann im
Abschnitt „Horizont & Umgebung“ als eigener Horizont importiert werden (`model/pvgis.ts`).

## State

- `useConfigStore` (Zustand, persistiert unter `ssa.config`, Version 2): `config: Config` + `patch(section, partial)`,
  `setConfig(updater)`, `replace(config)`, `reset()`. Jeder Schreibzugriff läuft durch `sanitizeConfig` und wird
  strukturell geteilt: unveränderte Abschnitte (`location`, `building`, …) behalten ihre Objektidentität.
- `useTimeStore` (nicht persistiert): Datum, Uhrzeit (lokale Minuten), Animation (`playing`, `speed`).
- `useUiStore` (persistiert unter `ssa.ui`): Sprache, Theme, sichtbare Ansichten, offene Abschnitte, analysiertes Stockwerk.
- `useDataStore` (nicht persistiert): Gelände-Horizont und Wetterreihe inkl. Ladezustand/Fehler; geschrieben von den
  Loadern in `hooks/useTerrain.ts` und `hooks/useWeather.ts` (einmal in `<DataLoader/>` gemountet).
- URL-Hash `#c=…` überschreibt beim Laden die gespeicherte Config (Teilen-Link, `state/urlSync.ts`); danach wird der
  Hash bei Config-Änderungen (entprellt) nachgeführt.
- localStorage-Zugriffe laufen über `state/storage.ts` (fehlendes, gesperrtes oder volles localStorage bricht nichts).
- Abgeleitete Daten über Hooks in `hooks/useModel.ts`: ein komponentenübergreifender Cache (`hooks/cache.ts`), dessen
  Schlüssel die Config-_Abschnitte_ sind. Neigungsänderungen berechnen daher z. B. den Neigungs-Sweep nicht neu,
  Zeitänderungen nur den Momentanzustand. Jahresrechnungen lesen ihre Eingaben über `useDeferredValue`.

## i18n

Jede Komponente definiert ihre Texte lokal:

```ts
const messages = { de: { title: 'Heatmap' }, en: { title: 'Heatmap' } };
const t = useMessages(messages);
```

Gemeinsame Texte liegen in `i18n/common.ts`. Zahlen/Daten werden über `useFormat()` (Intl, Locale `de-CH`/`en-GB`) formatiert.

## Tests

- **Modell** (Vitest-Projekt `model`, Node), Referenzwerte:
  - NREL-SPA-Referenzfall (Reda & Andreas 2004) und astronomy-engine-Werte für Sonnenstand, Deklination,
    Zeitgleichung und Auf-/Untergang (Toleranz Sonnenstand 0.02°); NOAA-Refraktionsformel.
  - pvlib-0.15.2-Werte (Luftmasse Kasten & Young, IAM ASHRAE).
  - Brute-Force-Ray-Casting gegen die Schattenrechtecke von `shadeFromAbove()`.
  - Analytische Fälle (Himmelssichtfaktor, Diffus-POA, Transitgeometrie).
  - Konsistenzprüfungen (Monate = Jahr, oberstes Stockwerk = unverschattet, Clipping).
  - Wörtliche Auszüge der PVGIS-printhorizon-Antwort.
- **UI** (Projekt `ui`, jsdom, `src/setupTests.ts`): Rendern und Interaktion mit Testing Library.
  - Netzwerk gesperrt (`fetch` wird abgelehnt, ausser ein Test stubbt es).
  - `resetStores()` aus `src/test/utils.ts` setzt den App-State zurück.
  - `getContext` liefert `null`, deshalb zeigt die 3D-Ansicht ihren Hinweis ohne WebGL und die Heatmap zeichnet nicht.
    `SceneStage.test.tsx` mockt `./webgl`, um die DOM-Teile der 3D-Ansicht zu testen.
- **E2E** (`npm run e2e`, Playwright gegen den `vite preview`-Build, Chromium + SwiftShader, Open-Meteo und Kacheln
  blockiert, Port über `E2E_PORT`): App lädt mit Jahresertrag; kein horizontales Scrollen bei 360 px; 3D-Canvas zeichnet
  Inhalt (mehr als 20 Farben, kein Screenshot-Vergleich); Teilen-Link stellt die Konfiguration wieder her;
  Sprachumschaltung DE → EN.
- **CI** (`.github/workflows/ci.yml`, Node aus `.nvmrc`): Lint, `format:check`, Typecheck, Tests und Build; danach
  E2E mit dem von Playwright installierten Chromium.
