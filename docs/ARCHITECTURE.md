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
- Web Worker (Modul-Worker) für Download, Dekodierung und Berechnung des Geländehorizonts (`src/workers`), mit
  Rückfall in den Hauptthread, siehe [Gelände-Horizont](#gelände-horizont)
- vite-plugin-pwa (Workbox): Web-App-Manifest und Service Worker, siehe [PWA und Deployment](#pwa-und-deployment)
- Styling: CSS-Variablen (`src/styles/global.css`) + CSS Modules pro Komponente (`*.module.css`), keine Inline-Style-Monolithen
- Alle 2D-Visualisierungen als SVG (Heatmap als `<canvas>`), keine Chart-Library

## Verzeichnisstruktur

```
src/
  main.tsx                 Einstieg: initUrlSync(), initInstallPrompt() und initStaleChunkReload() vor dem ersten
                           Render, dann <App/>
  App.tsx                  Layout je Breite (siehe Layout und Bedienung): Header, Sidebar bzw. Zeitpunkt/Neigung,
                           KPI-Leiste, Ansichten, Analyse, Einstellungen, Footer, BottomBar (Handys), PwaToast
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
    terrain.ts             Gelände-Horizont aus DEM-Kacheln (AWS Terrarium) im Browser; mehrere Beobachterhöhen aus einem
                           Download in einem Durchgang (fetchTerrainHorizons, computeHorizons); Kachel-Retries (2×,
                           n·400 ms, nur Netzwerkfehler/429/5xx), Kachelpläne der letzten 5 Standorte im Speicher,
                           Ergebnis-Cache ssa.terrain.v1:* (max. 40: 8 Höhen × 5 Standorte)
    pvgis.ts               PVGIS-printhorizon-Import (JSON/CSV/basic; Azimut S-basiert → N-basiert: A + 180)
    irradiance.ts          Clear-Sky-Modell, Einfallswinkel, IAM, POA-Einstrahlung, Himmelssichtfaktor (Winkeltabellen
                           des Himmelsrasters je Rasterform wiederverwendet)
    weather.ts             Stündliche Wetterdaten (Open-Meteo-Archiv, Modell best_match) + Clear-Sky-Jahr,
                           localStorage-Cache ssa.weather.v1:* (max. 3 Jahre)
    simulation.ts          Jahressimulation (kWh je Stockwerk/Monat, Verschattungsverlust)
    analysis.ts            Heatmap-Daten (Sonne im Fassadenrahmen je Fassade und Horizont: heatmapSunCells, dann nur die
                           Verschattung: heatmapFromSunCells), Neigungs-Sweep (0–90° in 5°-Schritten), Tagesprofil
    economics.ts           Wirtschaftlichkeit
    storageCache.ts        localStorage-LRU-Cache der Wetter- und Geländeergebnisse (fängt fehlendes, gesperrtes oder
                           volles localStorage ab)
    presets.ts             Standort- (24) und Modul-Presets (5), Ortssuche (Open-Meteo Geocoding)
    share.ts               Config ⇄ URL-Hash (Base64url) und JSON, Validierung (sanitizeConfig), Migration v1 → v2
  app/                     App-Shell: Header, WarningsBar, KpiBar, ViewToggles, ShareButton, ExportMenu, Footer,
                           DataLoader (startet die Loader), useDocumentSettings (<html> data-theme/lang, Titel,
                           theme-color), BottomBar (Steuerleiste der Handys: Uhrzeit, Neigung, «Springe zu»),
                           jumpTo (Sprung zu einer Seitenregion ohne Änderung des URL-Hashs), layout.ts (Media
                           Queries der Layouts: WIDE_LAYOUT, BOTTOM_BAR_LAYOUT)
  components/              Generische UI-Bausteine: Button, InfoTip, NumberField (+ numberInput.ts),
                           Placeholder, Section, Segmented, SelectField, Skeleton, Slider, Spinner, TextField,
                           Toggle, ViewCard, icons, cssVars, usePopover (Popover im Viewport halten, Schliessen bei
                           Klick ausserhalb; auch für das Menü «Springe zu»)
    svg/                   SVG-Helfer für Diagramme und 2D-Ansichten: useElementWidth, useSvgId, paths, text
                           (Textbreiten, Fliesslayout), legend (gemeinsamer Legendenstil), HatchPattern
  controls/                Eingaben (Sidebar): Sidebar, TimeControls, TiltControl und je Einstellungsgruppe eine
                           *Section.tsx (Location, Building, Panel, System, Horizon, Weather, Economics);
                           sections.module.css (gemeinsames Layout der Abschnitte), icons (gemeinsame Icons der
                           Eingaben), loadError.ts + LoadErrorDetails (übersetzte Ursache eines Ladefehlers,
                           technische Meldung aufklappbar), useTimeSlider (Uhrzeitregler für TimeControls und
                           BottomBar)
    location/              PlaceSearch, PresetSelect, MyLocationButton, CompassDial, TimeZoneField, timeZones
    horizon/               TerrainStatus, ObstacleList/ObstacleItem, ManualHorizon (inkl. PVGIS-Dateiimport),
                           HorizonSparkline, horizonData
  views/                   2D-Ansichten: FrontalView, ProfileView (Seite), SunPathView, PanelShadowView
    svg/                   Reine Layout-Module ohne React (frontalLayout, profileLayout, sunPathLayout,
                           panelShadowLayout, geometry2d, legend, constants) + SvgFigure, Legend, ViewNotice,
                           primitives, messages, svg.module.css
    scene3d/               3D-Ansicht (three.js/R3F), lazy: index.ts → Scene3D → SceneView; SceneStage, SceneContent,
                           Building, PanelRows, Ground, Surroundings, SkyAndLights, SunMarker, CameraRig, Label,
                           SceneErrorBoundary, useSceneData, useKeptWhileHidden (Szene ausserhalb des Bildschirms
                           eingefroren); coords.ts, sceneLayout, palette, shadeMaterial (Modellschatten-Overlay),
                           textures, webgl, messages, captureRender (Bild für PNG-Export und Druck sofort und in
                           höherer Auflösung rendern)
  charts/                  Analyse: DailyProfileChart, ShadeHeatmap (Canvas), MonthlyYieldChart, TiltSweepChart,
                           EconomicsCard, MonthlyTable
    lib/                   Chart-Bausteine ohne Library: scale, Axes, timeAxis, legend/ChartLegend, ChartTooltip,
                           ChartStats, DataTable (+ ColumnHeader), heatmap, monthlyTable, colors, canvasTheme,
                           floors, focus, sourceLabel, usePlotPointer (Maus und Touch-Gesten, siehe Layout und
                           Bedienung), PlotSlider (Tastatur-/Zeiger-Ebene mit Fadenkreuz), sliderKeys, shadingTotals
                           (Verschattungsverlust für KPI, Monatsertrag und Monatstabelle)
  export/                  png, csv (RFC 4180), resultsCsv (Monatsertrag, Neigungsvergleich, Heatmap), configFile
                           (JSON speichern/laden), clipboard, download, filenames, Druckbericht (print.ts, print.css,
                           PrintReport.tsx, PrintRoot.tsx), canvasRender (Canvas vor PNG-Export/Druck synchron neu
                           zeichnen)
  hooks/                   useModel (memoisierte Modell-Hooks) + cache.ts, useTerrain/useWeather (je Loader + Leser),
                           useAnimation, useMediaQuery (Layouts aus app/layout.ts, pointer: coarse),
                           useNearViewport (Karten weit unter dem Bildschirm rechnen nicht, ausser im Druck)
  state/                   configStore, timeStore, uiStore, dataStore, shareLinkStore (Hinweise zum Teilen-Link),
                           urlSync (#c=-Hash), storage (Persistenz der Stores, fängt localStorage-Fehler ab),
                           loadGate (Gelände-Download erst nach der Wetteranfrage)
  workers/                 Gelände-Worker: terrain.worker.ts (Modul-Worker), terrainWorkerHandler.ts (sein
                           Nachrichten-Handler, ohne Worker testbar), terrainProtocol.ts (Nachrichten),
                           terrainClient.ts (computeTerrainInWorker, Rückfall in den Hauptthread)
  pwa/                     install.ts (beforeinstallprompt/appinstalled → useInstallStore, promptInstall, isIos,
                           Standalone-Erkennung), InstallButton (Header), PwaToast (Service-Worker-Registrierung,
                           Hinweise «Neue Version verfügbar» / «Offline verfügbar»), updates.ts (stündliche
                           Update-Prüfung, reloadPage), staleChunks.ts (einmal neu laden bei fehlenden Chunks)
  i18n/                    index.ts (useLang, useMessages, useFormat, floorLabel, compassPoint …), common.ts
  styles/                  global.css: Design-Tokens (CSS-Variablen) für Dark/Light, globale Styles; tokens.ts:
                           Token-Zugriff aus TypeScript (Stockwerksfarben, useThemeKey, cssVar, parseCssColor)
  test/                    utils.ts: resetStores(), TEST_DATE; svg.ts: Helfer für die Tests der SVG-Ansichten;
                           pwaRegister.ts: Ersatz für virtual:pwa-register/react in den UI-Tests

public/                    favicon.svg und die daraus erzeugten App-Icons (pwa-192x192, pwa-512x512,
                           pwa-maskable-512x512, apple-touch-icon)
e2e/                       Playwright-Specs (smoke.spec.ts, features.spec.ts, mobile.spec.ts, pwa.spec.ts)
scripts/validate-terrain.ts  Gelände-Horizont gegen PVGIS printhorizon prüfen (braucht Netzwerk)
scripts/validate-yield.ts    Jahresertrag gegen PVGIS seriescalc/PVcalc prüfen (braucht Netzwerk)
scripts/generate-icons.ts    App-Icons aus public/favicon.svg rendern (Playwright-Chromium, `npm run icons`)
scripts/basePath.ts          BASE_PATH → Vite-`base` (für vite.config.ts und playwright.config.ts)
.github/workflows/ci.yml     CI: Lint, Format, Typecheck, Tests, Build; danach E2E unter / und unter einem Unterpfad
.github/workflows/pages.yml  Deployment auf GitHub Pages (nach erfolgreicher CI für einen Push auf main, manuell)
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

Validierung (`scripts/validate-yield.ts`; Bern, 47.1° N / 7.45° E, freistehend (`facade: false`), 1 kWp, 14 % Verluste,
ohne Horizont und AC-Grenze; β = 35° Süd, 45° und 90° bei 202°; Wetter 2020–2023, gegen PVGIS 5.3):

| Open-Meteo-Modell | PVGIS-ERA5 2020–2023 | PVGIS-SARAH3 2020–2023 | PVGIS-SARAH3 2005–2023 (PVcalc) |
| ----------------- | -------------------- | ---------------------- | ------------------------------- |
| `era5`            | −0.7 % bis −1.3 %    | +0.6 % bis +3.6 %      | +3.6 % bis +5.8 %               |
| `best_match`      | −1.8 % bis +0.6 %    | +1.4 % bis +2.9 %      | +4.3 % bis +5.3 %               |

## Gelände-Horizont

`terrain.ts` lädt AWS-Terrarium-Kacheln (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, CORS `*`),
dekodiert Höhen (`(R·256 + G + B/256) − 32768`) und berechnet für jeden Azimut (1°) den maximalen Höhenwinkel bis ~50 km
inkl. Erdkrümmung und Refraktion (`Δz = d²/(2R)·(1 − k)`, k = 0.13). Validierung gegen PVGIS-`printhorizon`
(im Browser nicht nutzbar, da ohne CORS) erfolgt über `scripts/validate-terrain.ts`: Beobachter 5 m über Grund,
RMS 0.34° / 1.19° / 1.22° und Korrelation r = 0.986 / 0.993 / 0.984 für Mittelland (47.1/7.45), Grindelwald
(46.62/8.04) und Zermatt (46.02/7.75), Lauf vom 24.09.2026. Eine heruntergeladene printhorizon-Datei kann im
Abschnitt „Horizont & Umgebung“ als eigener Horizont importiert werden (`model/pvgis.ts`).

Beobachterhöhe ist je Panel-Stockwerk die Oberkante seiner Panelreihe (Platte + Geländer, unabhängig von der
Neigung, auf 1 m gerundet: `floorTerrainHeight` in `hooks/useTerrain.ts`). Alle Höhen eines Standorts kommen aus
einem Kachel-Download und einem Durchgang über die Strahlen (`fetchTerrainHorizons`, `computeHorizons`; je Höhe
dasselbe Ergebnis wie `computeHorizon`); Höhen im Ergebnis-Cache werden nicht neu gerechnet.

Laden (`useTerrainLoader`, einmal in `<DataLoader/>` gemountet):

- Nach einer Änderung von Standort oder Stockwerkhöhen wartet der Loader `TERRAIN_DEBOUNCE_MS` = 800 ms; der
  erste Aufruf, ein neuer Versuch und das Wiedereinschalten starten sofort. Ändern sich nur die Stockwerkhöhen,
  bleiben die bisherigen Profile (nächstgelegene Höhe, `terrainProfileAt`) stehen, bis die neuen aus den Kacheln im
  Speicher gerechnet sind.
- Ein Download wartet auf `terrainDownloadGate()` (`state/loadGate.ts`): bis keine Wetteranfrage mehr läuft und
  jede mit `holdTerrainDownload()` angemeldete Anfrage fertig ist, höchstens `TERRAIN_GATE_MAX_MS` = 5 s. Die rund
  2 MB Kacheln (`TILE_CONCURRENCY` = 6 Anfragen gleichzeitig) würden auf einer langsamen Mobilverbindung sonst das
  Wetter verzögern, das die Jahresergebnisse brauchen. Solange nur das Gelände fehlt, erscheinen die Jahreswerte als
  vorläufig (siehe [Laden und Rechenlast](#laden-und-rechenlast)); die WarningsBar zeigt den Fortschritt des
  Downloads in Prozent (nur sichtbar: die Live-Region meldet den Hinweis einmal, nicht jede Kachel).
- Download, PNG-Dekodierung und Berechnung laufen in einem Modul-Worker. `computeTerrainInWorker`
  (`workers/terrainClient.ts`, Typ `TerrainComputer` wie `computeTerrainHorizons`) schickt je Auftrag `compute`
  mit einer `id` an `terrain.worker.ts` und erhält `progress`, `result` oder `error`; ein Abbruch schickt `abort`,
  der Worker verwirft den Auftrag. Der Worker bleibt bestehen, sein Kachel-Cache im Speicher (bis 96 Kacheln) dient
  späteren Aufträgen, etwa neuen Stockwerkhöhen am selben Standort. Der localStorage-Ergebnis-Cache bleibt auf der
  Seite (Worker haben kein localStorage). Ohne `Worker` (jsdom, alte Browser), mit eingespieltem `fetchImpl`
  (Tests) oder wenn das Worker-Skript nicht startet oder abstürzt, rechnet dieselbe Funktion im Hauptthread, offene
  Aufträge eingeschlossen.

## State

- `useConfigStore` (Zustand, persistiert unter `ssa.config`, Version 2): `config: Config` + `patch(section, partial)`,
  `setConfig(updater)`, `replace(config)`, `reset()`. Jeder Schreibzugriff läuft durch `sanitizeConfig` und wird
  strukturell geteilt: unveränderte Abschnitte (`location`, `building`, …) behalten ihre Objektidentität.
- `useTimeStore` (nicht persistiert): Datum, Uhrzeit (lokale Minuten), Animation (`playing`, `speed`).
- `useUiStore` (persistiert unter `ssa.ui`): Sprache, Theme, sichtbare Ansichten, offene Abschnitte, analysiertes Stockwerk.
- `useDataStore` (nicht persistiert): Gelände-Horizont und Wetterreihe inkl. Ladezustand/Fehler; geschrieben von den
  Loadern in `hooks/useTerrain.ts` und `hooks/useWeather.ts` (einmal in `<DataLoader/>` gemountet).
- `useShareLinkStore` (nicht persistiert, von `resetStores()` zurückgesetzt): Hinweise zum Teilen-Link für die
  WarningsBar (ersetzte eigene Config wiederherstellen, ungültiger Link).
- URL-Hash `#c=…` überschreibt beim Laden die gespeicherte Config (Teilen-Link, `state/urlSync.ts`); ein nicht
  lesbarer `#c=` wird gemeldet. Danach wird der Hash bei Config-Änderungen gedrosselt nachgeführt (sofort, danach
  höchstens alle 400 ms, `HASH_THROTTLE_MS`, mit dem letzten Stand am Schluss); die Standard-Config leert den Hash. Ein
  beim Verlassen der Seite noch ausstehender Hash geht über den sessionStorage (`ssa.pendingHash`) an den nächsten
  Aufruf.
- Speicher: Store-Persistenz über `state/storage.ts`, Wetter- und Geländecache über `model/storageCache.ts` (das Modell
  importiert keinen State); beide fangen fehlendes, gesperrtes oder volles localStorage ab. Das Skript in `index.html`
  liest `ssa.ui` direkt, um das Theme vor dem ersten Paint zu setzen.
- Abgeleitete Daten über Hooks in `hooks/useModel.ts`: ein komponentenübergreifender Cache (`hooks/cache.ts`), dessen
  Schlüssel die Config-_Abschnitte_ sind. Neigungsänderungen berechnen daher z. B. den Neigungs-Sweep nicht neu,
  Zeitänderungen nur den Momentanzustand. Jahresrechnungen lesen ihre Eingaben über `useDeferredValue`.
  Neigungs-Sweep im Hintergrund und vorläufige Jahreswerte: siehe [Laden und Rechenlast](#laden-und-rechenlast).

## i18n

Jede Komponente definiert ihre Texte lokal:

```ts
const messages = { de: { title: 'Heatmap' }, en: { title: 'Heatmap' } };
const t = useMessages(messages);
```

Gemeinsame Texte liegen in `i18n/common.ts`. Zahlen/Daten werden über `useFormat()` (Intl, Locale `de-CH`/`en-GB`) formatiert.

## Layout und Bedienung

### Layouts

`App.tsx` rendert die Container je Layout (Media Queries in `app/layout.ts`, CSS-Umbrüche in `App.module.css`);
die DOM-Reihenfolge ist die Lesereihenfolge, Tastaturfokus und Screenreader folgen also dem Bild:

- **ab 1100 px** (`WIDE_LAYOUT`): Sticky-Sidebar (Zeitpunkt, Neigung, Einstellungen) | Hauptspalte (Hinweise und
  Kennzahlen, Ansichten, Analyse);
- **900–1099 px ohne groben Zeiger:** eine Spalte Kennzahlen → Zeitpunkt/Neigung → Ansichten → Analyse →
  Einstellungen;
- **Handys, Tablets mit Touchscreen und schmale Fenster** (`BOTTOM_BAR_LAYOUT`: unter 900 px, mit
  `pointer: coarse` unter 1100 px): Kennzahlen → Ansichten → Zeitpunkt/Neigung → Analyse → Einstellungen, dazu die
  Steuerleiste am unteren Rand. Die 3D-Ansicht folgt so direkt auf die Kennzahlen.

Zeitpunkt/Neigung und Einstellungen wechseln an den Umbrüchen den Container; `<main>` und die Ergebnisse bleiben an
ihrem Platz im Baum (kein Neuaufbau des WebGL-Kontexts der 3D-Ansicht). Zwischen 700 und 1099 px stehen die Karten
Zeitpunkt und Neigung nebeneinander (`controls/Sidebar.module.css`).

### Steuerleiste (Handys und Touch-Tablets)

`app/BottomBar.tsx` (Region «Schnellsteuerung», `position: fixed`, `data-print="hide"`) hält die Uhrzeit in
Reichweite, während 3D-Ansicht oder Ergebnisse im Bild sind:

- **−/+** verschieben die Uhrzeit um `TIME_STEP` = 15 min auf das 15-Minuten-Raster (12:05 → 12:15 bzw. 12:00) und
  halten die Animation an. Die **Uhrzeit** (mit Datum, unter 360 px ohne) öffnet den Zeitregler (`useTimeSlider`,
  derselbe wie in `TimeControls`), daneben **Abspielen/Anhalten**. **θ** öffnet den Neigungsregler mit dem
  Optimum als Marke («Opt. 40°»); den Sweep dafür rechnet das Panel erst nach seinem ersten Paint und nur mit
  endgültigen Eingaben (`useResultsReady`). Es ist immer höchstens ein Regler offen; die Animation selbst läuft in
  `TimeControls` (`useAnimation` ist dort einmal gemountet).
- **«Springe zu»** öffnet ein Menü (Knopf mit `aria-expanded` und `<nav>`) zu den Regionen `results`, `views`,
  `quick`, `analysis` und `settings` (in diesem Layout mit `tabIndex={-1}`). `jumpTo()` (`app/jumpTo.ts`, auch
  vom Skip-Link benutzt) scrollt ohne Navigation zu `#id`, die den `#c=`-Teilen-Hash ersetzen und einen
  Verlaufseintrag anlegen würde, sanft ausser bei `prefers-reduced-motion`, und setzt den Fokus auf die Region.
  Die Region steht oben am Bildschirm; läge ein mit `data-jump-reveal` markierter Teil (die Bühne der 3D-Ansicht
  mit den Kameraknöpfen) dann hinter der Leiste, scrollt es weiter, bis er 8 px darüber endet, höchstens bis sein
  oberer Rand den Bildschirmrand erreicht (niedrige Bildschirme, etwa iPhone SE und Handys quer).
  Escape schliesst das Menü und gibt den Fokus an den Knopf zurück; ein Druck ausserhalb und Tab aus dem Menü
  hinaus schliessen es ebenfalls.
- Unter 600 px liegt die Leiste über die ganze Breite, der offene Regler über den Knöpfen; breiter schwebt sie als
  Dock (höchstens 48rem) mit dem Regler zwischen den Knöpfen. Sie hält die Safe Areas ein und veröffentlicht die
  Höhe, die sie verdeckt, als `--bottom-bar-h` auf `<html>`: `global.css` gibt dem Seitenende diesen Abstand (im
  Druck 0) und hält fokussierte Elemente darüber (`scroll-padding-bottom`); `PwaToast` steht über der Leiste, der
  Tooltip-Knopf des Neigungsvergleichs ebenfalls. Neu gemessen wird, wenn sich die Border-Box der Leiste ändert
  (offener Regler, Safe-Area-Abstand unten auf Handys) oder der untere Safe-Area-Abstand allein (ein unsichtbarer
  Messpunkt dieser Höhe; iOS Safari ändert ihn beim Einklappen seiner Leiste, das Dock rückt dabei nur hoch).

### Touch

Auf dem Handy beginnt ein Bildlauf oft auf einem Regler oder Diagramm. Eine Berührung ändert deshalb erst etwas,
wenn sie kein Bildlauf ist: bei einem Tipp oder sobald sie seitwärts zieht. Übernimmt der Browser die Geste zum
Scrollen, sendet er `pointercancel`; dann bleibt nichts verstellt und kein Tooltip offen. Maus, Stift, Tastatur
und Hilfstechnologien wirken sofort.

- **Regler** (`components/Slider.tsx`, alle Schieberegler inkl. `NumberField`): Blink setzt den Wert schon beim
  Aufsetzen des Fingers. Eine Berührung hält ihn zurück, bis sie mindestens `TOUCH_DRAG_SLOP` = 6 px und mehr
  waagrecht als senkrecht zieht (dann live) oder als Tipp auf die Spur endet (`pointerup`); ein Bildlauf verwirft
  ihn. Daumen 24 px auf Touchscreens.
- **Fassadenkompass** (`CompassDial`, `touch-action: pan-y pinch-zoom`): Ein Tipp setzt die Richtung, und zwar erst
  mit dem `click`, den der Browser nur für einen echten Tipp sendet (nicht für langes Drücken oder einen Tipp, der
  einen Bildlauf stoppt); Ziehen dreht erst nach mehr als 8 px seitwärts. Bricht der Browser die Geste ab, gilt
  wieder der Wert von vor der Berührung.
- **Diagramme** (`charts/lib/usePlotPointer.ts`, Overlays mit `touch-action: pan-y`): Ein Tipp wählt mit dem
  folgenden `click`. Im Tagesverlauf (`drag`) beginnt das Ziehen erst nach mehr als 8 px seitwärts (`CLICK_SLOP`);
  wird es doch zum Bildlauf, stellt `onDragCancel` Uhrzeit und Animation von vor der Berührung wieder her. In der
  Heatmap wählt auch das Loslassen nach seitlichem Wischen (`touchScrubSelects`), weil eine Fingerkuppe etwa eine
  Woche Tage bedeckt. Der Tooltip einer Berührung bleibt nach dem Loslassen stehen und schliesst beim nächsten Tipp
  ausserhalb; in Tagesverlauf und Heatmap lautet sein Hinweis dann «Tippen oder seitwärts ziehen …» statt
  «Klicken …».
- **Neigungsvergleich** (`touchPreview`): Ein Tipp zeigt nur die Werte eines Punkts, denn die Neigung ist
  gespeichert und rechnet alle Ergebnisse neu. Übernommen wird sie mit dem Knopf «Neigung … übernehmen» im Tooltip
  (`ChartTooltip` mit `action`; der Knopf trägt `data-chart-action`, sein Tipp schliesst den Tooltip nicht, danach
  geht der Fokus an den Regler des Diagramms). Dieser Tooltip bleibt im sichtbaren Teil des Diagramms über der
  Steuerleiste, notfalls über dem angetippten Punkt; den `click` des Tipps, der ihn geöffnet hat, erhält ein
  Element mit `data-chart-action` unter dem Finger nie (`usePlotPointer` fängt ihn ab).
- `HorizonSparkline` entfernt bei `pointercancel` das Fadenkreuz. In der 3D-Ansicht scrollt senkrechtes Wischen
  mit einem Finger die Seite, waagrechtes dreht, zwei Finger zoomen.

Touch-Ziele und Felder auf Touchscreens (`pointer: coarse`):

- `--touch` ist 36 px, dort 44 px (Apple HIG 44 pt, nahe an Materials 48 dp): Knöpfe (dort auch mindestens so
  breit wie hoch), Segmente, Schalter, InfoTips, Aufklapper von Tabellen und Ladefehlern, Kamera- und
  Legendenknöpfe der 3D-Ansicht und die Einträge von «Springe zu».
- Eingabefelder (ausser Regler, Kontroll- und Optionsfelder), Auswahllisten und Textbereiche haben mindestens
  16 px Schrift, sonst zoomt iOS Safari beim Fokussieren die Seite (und bleibt gezoomt).
- `NumberField`: Die Dezimaltastatur von iOS hat kein Minus. Felder mit beiden Vorzeichen bekommen deshalb die
  Texttastatur (`inputMode="text"`, deren Zahlenebene «-» hat); in Feldern nur für negative Werte (z. B. der
  Temperaturkoeffizient, im Datenblatt «−0.35 %/K») zählt eine Zahl ohne Vorzeichen als negativ.

### Schmale Bildschirme

- **Kennzahlen** kompakt, wenn die KPI-Leiste schmaler als 560 px ist, und auf Handys quer (bis 1099 px breit und
  500 px hoch): ohne die Aufteilung je Stockwerk und ohne «Sonnenhöhe» und «Profilwinkel» (beides zeigen Ansichten
  und Diagramme); alle Unterzeilen bleiben.
- **3D-Ansicht:** Bis 520 px Breite zeigt die Legende nur die Ebenen-Schalter, die Erklärungen öffnet «Legende
  erklären» (gedruckt immer mit Erklärungen). Stockwerks- und Stundenbeschriftungen sind auf Touchscreens
  mindestens `TOUCH_LABEL_MIN_PX` = 22 px hoch (etwa 11 px Text; `Label` mit `minPx`, vor jedem gerenderten Frame
  skaliert), die Kamera rahmt weiter mit der Weltgrösse. Die Kameraleiste bleibt einzeilig: auf Touchscreens unter
  420 px und auf allen Bildschirmen unter 360 px mit engeren Abständen (unter 360 px auch näher am Rand).
- **Diagramme und 2D-Ansichten:** Der Tagesverlauf zeigt bei Sonnenauf- und -untergang nur die Zeiten, wenn «Aufgang
  …» und «Untergang …» nicht mit mindestens 4 px Abstand zwischen die beiden Linien passen, und rückt die Legende nach
  links, damit lange Einträge im Bild bleiben (`chartLegendX`). Frontalansicht und Sonnenbahn lassen Beschriftungen
  weg oder weichen aus, die sich überdecken würden; in der Seitenansicht liegt die Beschriftung des kritischen Winkels
  über dem Sonnenstrahl. Die Monatstabelle zeichnet ihre Zeilenlinien auch unter der fixierten Monatsspalte.
- **Kennzahlen und Wirtschaftlichkeit bei 320 px:** Eine lange Einheit («kWh/kWp») rückt in die nächste Zeile
  statt über den Kartenrand; «Amortisationsdauer» trennt mit einem weichen Trennstrich.
- **Einstellungen:** Das Horizont-Diagramm ist unter 1100 px höchstens 360 px breit, unter 600 px mit 12 px
  Beschriftung, unter 375 px mit 14 px (bei 320 px auf dem Bildschirm etwa 10.6 px). Unter 480 px entfällt die
  Beschriftung «Sichtbare Ansichten» vor den Ansichtsschaltern (die Gruppe behält ihren Namen für Screenreader).

## Laden und Rechenlast

- **Vorläufige Jahreswerte:** `useAnnualResultsState()` (`hooks/useModel.ts`) liefert `'loading'` (das Wetter des
  eingestellten Standorts und Jahres ist noch nicht in den Ergebnissen, oder das Gelände steht seit weniger als
  `PROVISIONAL_DELAY_MS` = 1.5 s aus), `'provisional'` (nur der Geländehorizont fehlt noch) oder `'final'`.
  Vorläufig zeigen die Jahreskennzahlen ihre ohne Gelände gerechneten Werte gedämpft mit «vorläufig –
  Geländehorizont wird geladen», die Neigungskarte das Optimum gedämpft und ohne «Optimum … übernehmen». Die
  Heatmap braucht kein Wetter, aber das Gelände: Solange es aussteht (`useTerrainPending`), zeigt ihre Karte die
  Stunden gedämpft mit demselben Hinweis, und ihr CSV-Export wartet. Diagramme,
  Wirtschaftlichkeit, Monatstabelle, Export und die Optimum-Marke der Steuerleiste warten auf endgültige Eingaben
  (`useAnnualInputsPending`, `useResultsReady`). Ein schneller oder gecachter Geländehorizont geht so ohne
  vorläufigen Zwischenstand vom Platzhalter zum Ergebnis.
- **Neigungs-Sweep im Hintergrund:** 19 Jahressimulationen, immer in Scheiben von etwa 8 ms (`SWEEP_SLICE_MS`)
  zwischen den Frames, auch das erste Ergebnis eines Standorts (bis dahin `null`). Andere Änderungen an Gebäude,
  Panels, System und Horizont übernimmt er nach `SWEEP_SETTLE_MS` = 250 ms Ruhe, bis dahin gilt das vorige
  Ergebnis mit `updating: true`; die Neigung selbst rechnet ihn nie neu. `flushSweeps()` rechnet einen laufenden
  Sweep sofort fertig (vor dem Druck, in Tests).
- **Neigungsschritte:** Die Heatmap cacht die Sonnenstände je Standort und Jahr (`sunGrid`) und die Sonne im
  Fassadenrahmen je Fassade und Horizont (`heatmapSunCells`); ein Schritt rechnet nur die Verschattung
  (`shadeFractionFromAbove`, ohne Rechtecke je Modul). Der Himmelssichtfaktor nutzt Winkeltabellen je Rasterform,
  die Jahressimulation die gecachten Monate der Wetterschritte (je Reihe und Zeitzone), das Tagesprofil die
  Sonnenstände des Tages.
- **Ausserhalb des Bildschirms:** `useNearViewport()` (`hooks/`) meldet, ob die Karte höchstens eine
  Bildschirmhöhe vom sichtbaren Bereich entfernt ist (anfangs sofort gemessen, dann per `IntersectionObserver`).
  Heatmap und die Spalte der verschatteten Stunden in der Monatstabelle rechnen und zeichnen nur dann; sonst
  bleibt ihr letztes Ergebnis stehen (die Heatmap-Karte ist memoisiert und zeichnet nicht neu), etwa während oben
  auf dem Handy die Neigung gezogen wird. Die 3D-Ansicht rendert ausserhalb des Bildschirms (Karte plus 200 px)
  gar nicht (`frameloop` `'never'`); solange kein Pixel der Bühne sichtbar ist, behält die Szene zudem die zuletzt
  gezeigten Daten (`useKeptWhileHidden`, `SceneContent` memoisiert), Statusanzeige und Beschreibung bleiben
  aktuell. Der Schimmer der Platzhalter läuft über `transform` (ohne Neuzeichnen im Hauptthread).
- **Drucken und PNG-Export:** Der Druck zeigt die ganze Seite, also gilt `useNearViewport` währenddessen als nah.
  Sein `beforeprint`-Listener und der von `flushSweeps` werden beim Laden der Module registriert, also vor dem des
  Druckmodus (`export/print.ts`), der die Canvases erfasst, und rendern synchron (`flushSync`), weil der Browser
  den Druck gleich nach den `beforeprint`-Handlern aufnimmt. Die 3D-Szene übernimmt beim `CANVAS_RENDER_EVENT`
  (PNG-Export und Druck) synchron die aktuellen Daten und friert danach wieder ein (`detail.restore`). Steuerleiste
  und Zeitpunkt/Neigung fehlen im Druck.

## PWA und Deployment

- **Basis-Pfad:** `vite.config.ts` setzt `base` aus der Umgebungsvariable `BASE_PATH` (Standard `/`, normalisiert in
  `scripts/basePath.ts`). GitHub Pages dient die App als Projektseite unter `/solar-shadow-analyzer/` aus;
  `.github/workflows/pages.yml` übernimmt den Pfad aus `actions/configure-pages` (`base_path`:
  `/solar-shadow-analyzer`, mit eigener Domain leer, also `/`). Laufzeit-URLs hängen nicht vom Pfad ab: `index.html`
  verweist auf `/favicon.svg` usw., Vite setzt beim Build den Basis-Pfad davor (ebenso vor die URL des
  Gelände-Workers aus `new URL('./terrain.worker.ts', import.meta.url)`); das Manifest nutzt
  relative URLs (`start_url`, `scope`, Icons ohne Pfad), nur `id` ist der Basis-Pfad selbst (eine relative `id`
  löst der Browser gegen den Origin auf, nicht gegen `start_url`; `./` wäre `https://cyclodex.github.io/`). Die
  `id` ist die Identität der installierten App und darf sich nach der Veröffentlichung nicht mehr ändern. Der
  Service Worker liegt unter `<base>sw.js` mit Scope `<base>`; Teilen-Link (`buildShareUrl` aus `location.href`),
  URL-Hash (`pathname` + `search`) und Druck (im Dokument) bleiben unter dem Pfad. Die App lädt keine eigenen
  Dateien per `fetch`.
- **Manifest** (vite-plugin-pwa, in `vite.config.ts`): Name, `short_name` «Verschattung», Deutsch,
  `display: standalone`, Theme- und Hintergrundfarbe = `--bg` des dunklen Themes (`#0b1120`). Icons 192 und 512 px
  (`any`) und 512 px `maskable` (deckend, Logo auf 60 % innerhalb der Safe Zone) sowie `apple-touch-icon` 180 px
  über `<link>`, alle erzeugt von `scripts/generate-icons.ts`.
- **iOS:** `apple-mobile-web-app-capable`, `-title`, `-status-bar-style: black-translucent`; mit `viewport-fit=cover`
  läuft die Seite bis an den Bildschirmrand. `global.css` definiert `--safe-top/-right/-bottom/-left` aus
  `env(safe-area-inset-*)`; Header, Seitenraster, Sticky-Sidebar, Skip-Link, Steuerleiste und die Hinweise halten
  diese Abstände ein. Unter der transparenten Statusleiste (immer weisse Symbole) liegt ein fixer Streifen in
  `--statusbar`, auch im hellen Theme.
- **Service Worker** (Workbox `generateSW`, nur im Produktions-Build; in Entwicklung und Tests aus):
  - Precache des ganzen Builds (`js, css, html, svg, png` + Manifest), auch des lazy geladenen 3D-Chunks (~960 kB)
    und des Gelände-Workers (~31 kB).
    Ein Asset über `maximumFileSizeToCacheInBytes` (Standard 2 MiB) bricht den Build ab, statt offline zu fehlen.
  - Navigationen fallen auf `index.html` zurück (`navigateFallback`), alte Precaches werden aufgeräumt
    (`cleanupOutdatedCaches`). Kein Runtime-Caching: Wetter- und Geländedaten cacht die App selbst im `localStorage`.
  - `registerType: 'prompt'`: Ein Update aktiviert sich nie selbst (es würde die Lazy-Chunks einer offenen Seite
    löschen). `PwaToast` registriert den Worker über `useRegisterSW` (`virtual:pwa-register/react`), meldet
    «Neue Version verfügbar» (Live-Region) mit «Neu laden» (`updateServiceWorker` → `SKIP_WAITING`, dann Reload;
    nach `RELOAD_FALLBACK_MS` lädt die Seite sicherheitshalber selbst neu, falls der alte Worker sie nicht
    kontrollierte) und «Später» (das Update übernimmt, wenn alle Fenster der App geschlossen sind oder ein anderes
    Fenster «Neu laden» wählt: vite-plugin-pwa lädt dann jedes Fenster neu, das den Hinweis gezeigt hat, damit
    keines ohne die Lazy-Chunks seiner Version weiterläuft). Nach dem ersten Besuch kurz «Offline verfügbar».
    Update-Prüfung stündlich und beim Zurückkehren in den Vordergrund nach mindestens einer Stunde
    (`scheduleUpdateChecks`).
- **Veraltete Chunks:** Ohne kontrollierenden Service Worker (gesperrt, privates Fenster, Daten vom Browser
  gelöscht) fordert eine vor einem Deployment geladene Seite beim Einblenden der 3D-Ansicht Chunks an, die es nicht
  mehr gibt. Vite meldet das als `vite:preloadError`; `initStaleChunkReload()` (`pwa/staleChunks.ts`, vor dem
  ersten Render) lädt die Seite dann einmal neu: nicht offline und nicht erneut innerhalb von 60 s (Zeitpunkt im
  sessionStorage unter `ssa.chunkReload`). Bis dahin, oder wenn das Neuladen nicht hilft, ersetzt eine
  Fehlergrenze (`SceneErrorBoundary` in `App.tsx`) nur die 3D-Ansicht durch einen Hinweis mit «Neu laden».
- **Installieren:** `initInstallPrompt()` (vor dem ersten Render) hält `beforeinstallprompt` fest (ohne Chromes
  Mini-Infoleiste) und merkt sich `appinstalled`. `InstallButton` im Header: mit Event öffnet es den Installdialog
  (`prompt()`; solange er offen ist, bleibt der Knopf mit `aria-disabled` stehen, danach ist das Event verbraucht;
  nach einer Installation bleibt der Knopf weg, auch wenn der Browser das Event erneut sendet; verschwindet der Knopf
  mit dem Fokus, geht dieser an das vorherige Bedienelement im Header), auf iOS/iPadOS (User-Agent, iPadOS über Touchpunkte) ein Popover
  mit den Schritten «Teilen → Zu Home-Bildschirm hinzufügen → Als Web-App öffnen → Hinzufügen» (Beschriftungen
  wie in Apples deutscher iPhone-Anleitung für iOS 26/27; `usePopover`-Helfer, Escape und Klick ausserhalb
  schliessen). Ausgeblendet als installierte App (`display-mode: standalone`, `navigator.standalone`) und in
  Browsern ohne Installationsweg (z. B. Firefox, Safari auf dem Mac).
- **Deployment:** `.github/workflows/pages.yml` startet per `workflow_run`, wenn die CI abgeschlossen ist, und baut
  nur nach einem Erfolg für einen Push auf `main` dieses Repositorys (nicht für Pull Requests, etwa aus einem Fork mit
  einem Branch namens `main`), und zwar genau den geprüften Commit (`workflow_run.head_sha`). Manuell
  (`workflow_dispatch`) nur von `main`, dann ohne CI. Build-Job (`contents: read`, `pages: read`): Checkout ohne
  gespeicherte Zugangsdaten, zuerst `configure-pages` (bricht ohne eingerichtete Pages vor Installation und Build
  ab, liefert `base_path`), Node aus `.nvmrc`, `npm ci`, Build mit `BASE_PATH`, `upload-pages-artifact` mit `dist`.
  Deploy-Job (`deploy-pages`, Environment `github-pages`) als einziger mit `pages: write` und `id-token: write`.
  Concurrency-Gruppe `pages` ohne Abbruch laufender Deployments. Voraussetzung: Settings → Pages → Source «GitHub
  Actions».

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
  - `virtual:pwa-register/react` zeigt per Alias auf `src/test/pwaRegister.ts` (kein Service Worker, keine
    Hinweise); `PwaToast.test.tsx` mockt das Modul mit eigenem Zustand.
  - `resetStores()` aus `src/test/utils.ts` setzt den App-State zurück.
  - `getContext` liefert `null`, deshalb zeigt die 3D-Ansicht ihren Hinweis ohne WebGL und die Heatmap zeichnet nicht.
    `SceneStage.test.tsx` mockt `./webgl`, um die DOM-Teile der 3D-Ansicht zu testen.
  - `matchMedia` trifft nie zu (einspaltiges Layout ohne Steuerleiste, kein grober Zeiger); `App.test.tsx` stubbt
    es für das Handy-Layout (`BOTTOM_BAR_LAYOUT`). `IntersectionObserver` meldet nichts, `useNearViewport` und die
    3D-Bühne gelten also als sichtbar.
  - jsdom kennt keinen `Worker`: Der Geländehorizont rechnet dort im Hauptthread. `terrainClient.test.ts` ersetzt
    `Worker` durch einen Stellvertreter im selben Prozess mit dem echten Nachrichten-Handler.
  - Touch-Gesten mit `pointerType: 'touch'` (Slider, CompassDial, HorizonSparkline, Tagesverlauf, Heatmap,
    Neigungsvergleich): Bildlauf (`pointercancel`), Tipp, seitliches Ziehen und der Knopf im Tooltip des
    Neigungsvergleichs.
- **E2E** (`npm run e2e`, Playwright gegen den `vite preview`-Build, Chromium + SwiftShader, Open-Meteo und Kacheln
  blockiert, Port über `E2E_PORT`): App lädt mit Jahresertrag; kein horizontales Scrollen bei 360 px, auch mit
  iPhone-User-Agent und geöffneter Anleitung des Knopfs «Installieren» (bleibt im Bild); 3D-Canvas zeichnet Inhalt
  (mehr als 20 Farben, kein Screenshot-Vergleich); Kamera-Preset «Aus Sonnenrichtung» bleibt nach einem Klick
  erhalten, folgt der Uhrzeit und weicht nachts der Übersicht; Teilen-Link stellt die Konfiguration wieder her;
  Sprachumschaltung DE → EN. `mobile.spec.ts`: Auf einem iPhone 14 (Touch, in Chromium) schliesst die Steuerleiste am
  unteren Bildschirmrand ab, −/+ ändern die Uhrzeit um 15 min (auch im Zeitregler der Seite), «Springe zu» →
  «Einstellungen» scrollt dorthin und setzt den Fokus, ohne Hash in der URL, kein horizontales Scrollen; «Springe zu»
  → «Ansichten (3D)» zeigt die Kameraknöpfe (einzeilig) über der Leiste; auf einem iPhone SE (320 px) bleibt die
  Kameraleiste einzeilig; bei 1440 px keine Steuerleiste. `pwa.spec.ts`: Manifest gültig und unter dem Basis-Pfad,
  `id` wie Chromiums `Page.getAppId`, Icons ladbar (Grösse, `maskable`/`apple-touch-icon` deckend); Service Worker
  registriert sich, kontrolliert die Seite nach einem Reload und hat den 3D-Chunk im Precache; offline
  (`context.setOffline`) lädt die App mit Clear-Sky-Ergebnissen und 3D-Ansicht, ohne Konsolenfehler; eine neue Version
  (derselbe Worker als `sw.js?next` registriert, weil Playwright die Update-Anfrage für `sw.js` nicht umleitet) wartet
  mit «Neue Version verfügbar» und übernimmt erst nach «Neu laden» (schlägt mit `registerType: 'autoUpdate'` fehl).
  Nur dort laufen Service Worker; die übrigen Specs blockieren sie (`serviceWorkers: 'block'`), damit `page.route()`
  jede Anfrage sieht. Mit `BASE_PATH` laufen Build, `vite preview` und `baseURL` unter dem Pfad (die Specs navigieren
  relativ mit `page.goto('./')`).
- **CI** (`.github/workflows/ci.yml`, Node aus `.nvmrc`): Lint, `format:check`, Typecheck, Tests und Build; danach
  E2E mit dem von Playwright installierten Chromium, als Matrix unter `/` und unter `/solar-shadow-analyzer/`
  (`BASE_PATH`, Ergebnisse bei Fehlern als `playwright-results-<Index>`). Checkouts ohne gespeicherte Zugangsdaten
  (`persist-credentials: false`). Ein Erfolg für einen Push auf `main` löst das Deployment aus.
