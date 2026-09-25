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
- @mapbox/vector-tile 3 + pbf 5 (BSD-3-Clause, ≈ 4.6 kB gzip): Dekodierung der swisstopo-Vektorkacheln (Gebäude) in
  `model/buildingSources.ts`
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
    polygon.ts             Ebene Polygone: Fläche/Orientierung, Punkt-in-Polygon, Abstand, Vereinfachung, Clipping,
                           Höfe als Schlüssellochring (bridgeHoles)
    enu.ts                 WGS84 ⇄ lokale Meter Ost/Nord (Radien M/N), ENU ⇄ Fassadenrahmen (facadeTransform)
    lv95.ts                WGS84 ⇄ LV95 (swisstopo-Näherungsformeln), Meridiankonvergenz, lokaler LV95-Rahmen
    fetchRetry.ts          fetch mit gestutztem exponentiellem Backoff und Jitter, typisierte Fehler (NetError)
    buildingSources.ts     Gebäude aus den swisstopo-Vektorkacheln (MVT), Zusammenfügen an Kachelkanten, ENU
    surroundings.ts        Rechenregeln der Umgebung (prismBuildings, dsmMaskPolygons, eigenes Gebäude)
    dsmHorizon.ts          Laserscan-Horizont: Beobachter- und Standortschlüssel, Auswahl je Stockwerk
    buildingHorizon.ts     Prismen-Horizont der Umgebungsgebäude je Stockwerk
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
    location/              PlaceSearch (Adressen und Orte), AddressBuilding + addressBuildingText (Gebäuderegister),
                           addressSession (gewählte Adresse), PresetSelect, MyLocationButton, CompassDial,
                           TimeZoneField, timeZones
    horizon/               TerrainStatus, SurfaceModelControls (Laserscan), BuildingList (Umgebungsgebäude),
                           ObstacleList/ObstacleItem, ManualHorizon (inkl. PVGIS-Dateiimport), HorizonSparkline,
                           horizonData
    siteplan/              SitePlan (Lageplan: Fassade und Balkon bestätigen; SitePlanPanel/SitePlanMap lazy),
                           sitePlanModel, holdInView (hält den Lageplan ohne Scroll-Verankerung)
  views/                   2D-Ansichten: FrontalView, ProfileView (Seite), SunPathView, PanelShadowView
    svg/                   Reine Layout-Module ohne React (frontalLayout, profileLayout, sunPathLayout,
                           panelShadowLayout, geometry2d, legend, constants) + SvgFigure, Legend, ViewNotice,
                           primitives, messages, svg.module.css
    scene3d/               3D-Ansicht (three.js/R3F), lazy: index.ts → Scene3D → SceneView; SceneStage, SceneContent,
                           Building, PanelRows, Ground, Surroundings, Buildings3D, SkyAndLights, SunMarker,
                           CameraRig, Label, SceneErrorBoundary, useSceneData, useKeptWhileHidden (Szene ausserhalb
                           des Bildschirms eingefroren); coords.ts, sceneLayout, palette, shadeMaterial
                           (Modellschatten-Overlay), textures, webgl, messages, captureRender (Bild für PNG-Export
                           und Druck sofort und in höherer Auflösung rendern)
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
  hooks/                   useModel (memoisierte Modell-Hooks) + cache.ts, useTerrain/useWeather (je Loader +
                           Leser), useSurfaceModel (Leser) + surfaceModelLoader (Laserscan-Lader, lazy),
                           useBuildingImport (lazy) + Import-Worker, useAnimation, useMediaQuery (Layouts aus app/layout.ts,
                           pointer: coarse), useNearViewport (Karten weit unter dem Bildschirm rechnen nicht,
                           ausser im Druck)
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
scripts/validate-buildings.ts  Gebäude-Import aus den swisstopo-Vektorkacheln live prüfen (Kramgasse 49, Bern)
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
2. Direktstrahlung blockiert, wenn `s_n ≤ 0` oder Sonnenhöhe < Horizont des Stockwerks (Gelände ∪ manuell ∪ Hindernisse
   ∪ Umgebungsgebäude ∪ Laserscan, siehe [Umgebung](#umgebung-adresse-laserscan-gebäude)).
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
- `useUiStore` (persistiert unter `ssa.ui`): Sprache, Theme, sichtbare Ansichten, offene Abschnitte, analysiertes Stockwerk;
  nicht persistiert der ausstehende Umgebungs-Import nach einer Adresswahl (`requestSurroundingsImport`,
  `consumeSurroundingsImport`, siehe [Umgebung](#umgebung-adresse-laserscan-gebäude)).
- `useDataStore` (nicht persistiert): Gelände-Horizont, Wetterreihe und Laserscan-Horizonte (`surface`) inkl.
  Ladezustand/Fehler; geschrieben von den Loadern in `hooks/useTerrain.ts`, `hooks/useWeather.ts` und
  `hooks/surfaceModelLoader.ts` (einmal in `<DataLoader/>` gemountet, der Laserscan-Lader erst, sobald er in der
  Sitzung eingeschaltet ist).
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

## Umgebung: Adresse, Laserscan, Gebäude

Stand: umgesetzt (PLAN.md). Fundament, Adresssuche (A), Laserscan-Horizont (B) und Gebäude (C) entstanden parallel
(siehe [Zuständigkeiten](#zuständigkeiten-der-parallelen-arbeit)) und sind zusammengeführt
([Integration](#integration-adresse-laserscan-und-gebäude-zusammen)). Nur Schweiz und Liechtenstein; ausserhalb bleibt
alles wie bisher (Ortssuche Open-Meteo, Hindernisse als Quader, Terrarium-Gelände). Messungen und Quellen: Recherche
vom 25.09.2026.

### Konventionen (verbindlich)

- **Standort:** `config.location` ist der Punkt _auf_ der Fassadenlinie in der Mitte der Panelreihen, der Ursprung
  des Fassadenrahmens (u = 0, n = 0). Nach der Bestätigung von Fassade und Balkon im Lageplan wird er auf diesen
  Punkt gesetzt. Koordinaten werden auf 1e-6° gerundet (höchstens 0.07 m; vorher 1e-4°, bis 6.8 m daneben);
  Ortsvorlagen und GeoNames-Treffer bleiben bei 1e-4° (`presets.ts`).
- **Gebäude sind in der Welt verankert:** Grundrisse in m Ost/Nord (ENU, geographisch Nord) relativ zum Anker
  `horizon.buildingImport` (lat/lon), mit den WGS84-Krümmungsradien M und N am Anker (`enu.ts`, eine Kugel läge
  0.29 % daneben). In den Fassadenrahmen erst beim Rechnen: `facadeTransform(anchor, location, facadeAzimuth)`.
  Vektorkacheln (Web Mercator) → lat/lon → ENU; dafür ist kein LV95 nötig.
- **Fassadenrahmen** wie in [Koordinatensysteme](#koordinatensysteme): `enuToFacade`/`facadeToEnu`
  (u = −e·cos γ + n·sin γ, n = e·sin γ + n·cos γ), getestet gegen `sunInFacade` und `obstacleHorizon`.
- **Laserscan in LV95** (EPSG:2056, `lv95.ts`): swisstopo-Näherungsformeln (Dezember 2016,
  [PDF](https://www.swisstopo.admin.ch/dam/en/sd-web/KLRCX9XIdXDu/ch1903wgs84-EN.pdf)), gegen REFRAME höchstens
  0.35 m an 10 Punkten; die Umkehrung wird mit Newton-Schritten auf die Vorwärtsformel verfeinert (die publizierte
  Umkehrformel liegt bei Genf bis ~2 m daneben). Im LV95-Gitter gemessene Azimute um die Meridiankonvergenz
  korrigieren (`gridToTrueAzimuth`; Genf +0.947°, Bümpliz +0.035°, St. Gallen −1.416°, Chur −1.530°, wie REFRAME).
  Modell und Config kennen nur geographische Azimute. `lv95LocalFrame(origin)`: affine Beziehung ENU ⇄ LV95 um
  einen Ursprung (≤ 1 cm bis 300 m, ≤ 3 cm bis 500 m) für den Strahlengang im Raster.
- **Höhen nie mischen:** Laserscan-Höhen sind absolut (LHN95); der Boden am Beobachter kommt aus swissALTI3D oder
  dem Höhendienst am Standort; Horizontwinkel = atan2(z_dsm − (Boden + Beobachterhöhe), d). Terrarium behält seine
  eigene Bodenhöhe. Sie liegt am Standortpixel örtlich über LHN95 (Höhendienst): Breitenrainstrasse 10 564.1 gegen
  558.9 m (+5.2 m), Kramgasse 49 547.3 gegen 537.0 m (+10.3 m), während Hügel 0.5–0.6 km nördlich der Kramgasse zum
  DTM passen. Der Beobachter des Geländehorizonts steht dort also rund 10 m zu hoch: Gegen ein DTM-Profil
  (`profile.json`, Erdkrümmung mit k = 0.13, 4 m über Boden) liegt der Geländehorizont der Kramgasse bei 340°, 0° und
  20° mit 1.14° / 1.36° / 1.49° um 0.8–1.2° unter 2.29° / 2.16° / 2.67° (Merkmale 0.51–0.62 km entfernt). Im
  kombinierten Horizont fällt das dort weg (der Laserscan liegt in diesen Richtungen für alle Stockwerke bei
  mindestens 19.8°); in dicht bebauten Orten mit offener Sicht aus dem obersten Geschoss kann der Geländehorizont
  für Merkmale in 0.5–1 km so etwa 1° zu tief liegen. Der Boden des Geländehorizonts wird nicht auf den Höhendienst
  gesetzt: Ob die Terrarium-Pixel im Nahbereich (100–300 m) ebenso erhöht sind, ist nicht gemessen; wären sie es,
  erzeugte ein tieferer Beobachter dort einen falschen Horizont. Horizonte werden je Azimut per Maximum kombiniert.

### Config-Vertrag

`HorizonConfig` bekommt drei Felder (Typen in `types.ts`):

- `buildings: Building[]`: `{ id, name, footprint, base, height, source: 'swisstopo' | 'manual', removed?, edited? }`.
  `footprint` = Aussenring in m Ost/Nord des Ankers (0.1-m-Raster, ±2000 m, mindestens 3 Ecken, gegen den
  Uhrzeigersinn, offen); `base` = Unterkante über dem Boden am Standort (importiert: 0), `height` = Höhe über `base`.
  `removed`: importiertes Gebäude gelöscht (bleibt gespeichert, damit es im Laserscan maskiert wird); `edited`:
  Höhe/Basis geändert (Laserscan maskiert, Prisma zählt). `name` darf leer sein (die UI zeigt eine Nummer).
- `buildingImport: { latitude, longitude, radius, date } | null`: Anker aller Grundrisse (1e-6°), Radius des Imports
  (0 = nur Anker manueller Gebäude), Datum `YYYY-MM-DD`.
- `surfaceModel: { enabled, trees, radius }`: Laserscan-Horizont ein, Bäume berücksichtigen, Radius (m).

Standardwerte: `[]`, `null`, `{ enabled: false, trees: true, radius: 300 }`. Die Felder sind **additiv**: fehlend =
keine Gebäude, kein Anker, Laserscan aus. `Config.version`, `SHARE_VERSION` und `SHARE_BASES` bleiben unverändert (ein
paralleler Zweig erhöht sie); die Werte für «fehlend» stehen eingefroren in `SHARE_ADDED_FIELDS` (share.ts), der Typ
`ShareBase` erlaubt Basen ohne die Felder. `LIMITS` (am Ende angehängt): `neighbour` (height 0.5–300 m, base −50…100 m,
coord ±2000 m, je 0.1 m), `surfaceModel.radius` 150–500 m (Schritt 50), `buildingImport.radius` 0–1000 m (10).

`sanitizeConfig`: höchstens `MAX_BUILDINGS` = 150 Gebäude, `MAX_BUILDING_VERTICES` = 64 Ecken je Gebäude (längere
Grundrisse vereinfacht, Visvalingam-Whyatt in O(n log n), nur Ecken entfernt; dabei benachbart gewordene gleiche
Ecken, etwa die Brücke eines weggefallenen Hofs, fallen ebenfalls weg, sodass ein zweiter Durchlauf nichts ändert),
`MAX_TOTAL_BUILDING_VERTICES` = 2000 Ecken insgesamt (spätere Gebäude fallen weg, ohne noch vereinfacht zu werden),
Ringe mit mehr als `MAX_RAW_RING_VERTICES` = 1024 Rohecken ungeprüft verworfen (echte Teile: höchstens 127 Ecken
als Schlüssellochring im 500-m-Umkreis von sechs Stadtorten); Ecken auf 0.1 m gerundet und geklemmt, doppelte Ecken und der Schlusspunkt entfernt,
Ringe gegen den Uhrzeigersinn (umgedreht ab der zweiten Ecke), Fläche unter `MIN_BUILDING_AREA` = 0.5 m² verworfen,
eindeutige ids (`b<k>`), `removed`/`edited` nur bei `source: 'swisstopo'` und nur als `true`. Gebäude ohne Anker
erhalten den Standort als Anker (Radius 0). Gespeicherte Configs (localStorage) ohne die Felder bekommen die
Standardwerte beim Laden (keine neue Speicherversion).

**Teilen-Link:** Er enthält immer den genauen Standort (1e-6°, Bezeichnung = Adresse) und die gespeicherten Gebäude.
Kurzschlüssel im Abschnitt `h`: `g` = Gebäude, `k` = Anker `{a, o, r, d}`, `s` = Laserscan (nur abweichende Felder
`{e, t, r}`, z. B. `{"e":true}`). Ein Gebäude ist `[Höhe, Basis, e0, n0, Δe1, Δn1, …]` in ganzen Dezimetern (jede
weitere Ecke als Differenz zur vorigen); mit Namen, einer id ausser `b<Index + 1>`, `source: 'manual'` oder einer
Markierung `{g: […], i?, n?, m?: 1, r?: 1, e?: 1}`. Fehlende Felder bedeuten «keine/aus»: Links von vor dem Feature
bleiben gültig (Test mit einem Link, der mit main 030c38d erzeugt wurde). Länge: 78 Gebäude mit 612 Ecken ≈ 7'160
Zeichen (11.4 je Ecke; echte Teile der Kramgasse 11.6), `MAX_ENCODED_LENGTH` 200'000 bleibt.

### Rechenregeln (verbindlich)

- `dsmActive` = `surfaceModel.enabled` und die Laserscan-Horizonte sind für `surfaceSiteKey(config)` geladen
  (`'ready'`): `useDsmActive(config)` in `hooks/useSurfaceModel.ts`. `surfaceSiteKey` fasst alles ausser den
  Beobachtern: Standort, Fassadenazimut, Balkontiefe, Reihenbreite, Bäume, Radius und die maskierten Grundrisse.
- **Horizont je Stockwerk (und Neigung)** = Maximum je Azimut aus Gelände (falls ein) ∪ eigenen Punkten ∪ Hindernissen
  ∪ Prismen ∪ Laserscan (falls dsmActive): `floorHorizonsWithTerrain(config, terrain, surroundings)`
  (`hooks/useTerrain.ts`); `useHorizons`, Jahresrechnung, Heatmap und Neigungs-Sweep geben die `SurroundingsSource`
  (`useSurroundingsSource`) mit. Mit Gebäuden oder Laserscan rechnet der Sweep jede Neigung mit eigenen Horizonten.
- **Prismen:** `prismBuildings(buildings, dsmActive)`: mit dsmActive nur `source: 'manual'` oder `edited`, sonst
  alle; entfernte nie (`buildingHorizon.ts prismFloorHorizons`). Vom eigenen Gebäude (`ownBuildingIds`) zählt nur
  der Teil vor der Balkonzone, n > Balkontiefe + 0.5 m (`ownPrismPieces`, dieselbe Zone wie beim Laserscan unten:
  ein Flügel desselben Teils vor der Fassade schattet), und nur solange der Standort auf seiner Wand liegt (höchstens
  0.5 m neben dem Umriss) und die Fassade nach aussen zeigt (der Punkt 1 m davor liegt ausserhalb). Sonst, etwa mit
  dem Adresspunkt im Gebäude vor «Übernehmen» im Lageplan, zählt das eigene Gebäude gar nicht.
- **Masken des Laserscans** (Worker): Zellen in Grundrissen mit `removed || edited` (`dsmMaskPolygons`) → Boden (DTM).
  Mit `trees === false` wird jede Zelle ausserhalb der Vereinigung _aller_ swisstopo-Gebäudegrundrisse im Radius (der
  Worker lädt die Kacheln vollständig, nicht nur die gespeicherten Gebäude) zu Boden.
- **Eigenes Gebäude im Laserscan** (`OWN_BUILDING_EXCLUSION`, `ownExclusionZone`, `isOwnBuildingCell`): Zellen mit
  n < 0.5 m (hinter der Fassadenebene) und die eigene Balkonzone 0 ≤ n ≤ Balkontiefe + 0.5 m innerhalb der Ausdehnung
  des eigenen Gebäudes entlang der Fassade zählen nicht; massgebend ist die Mitte der Zelle, die ein Strahl liest
  (nicht der Punkt auf dem Strahl). Die Ausdehnung kommt aus dem eigenen Grundriss (Teil der
  Vektorkacheln, der den Punkt 0.5 m hinter dem Fassadenursprung enthält), sonst ± (Reihenbreite / 2 + 2 m).
  Annahme: Das darüberliegende Stockwerk wirkt über die Verschattung durch dessen Panelreihe, nicht über
  Balkonplatten; Balkone der Nachbarn ausserhalb dieser Ausdehnung sind echte Hindernisse. Bei den Prismen ist jeder
  gespeicherte Grundriss, der diesen Punkt enthält, das eigene Gebäude (`ownBuildingIds`); andere Teile (Flügel,
  Anbauten vor der Fassade) schatten.
- **Beobachter** für Laserscan und Prismen = Mitte der Panelreihe jedes Stockwerks (u = 0, n = center.n, z = center.z
  über Boden), abhängig von der Neigung. Laserscan-Horizonte liegen je Beobachter unter `surfaceObserverKey(center)`
  (n und z auf 1 cm) in `dataStore.surface.horizons`; fehlt ein Schlüssel (eine neue Neigung wird noch gerechnet),
  nimmt `dsmFloorHorizons` den nächsten Beobachter.
- **Laden:** Solange der Laserscan lädt, gelten die Prismen aller Gebäude und die Jahreswerte sind vorläufig
  (`useSurfacePending` in `useTerrainPending`); nach einem Fehler oder ausserhalb der Abdeckung (keine STAC-Items:
  Status `'unavailable'`, Hinweis «nur in der Schweiz und Liechtenstein verfügbar») ebenfalls die Prismen.
- **Standort im eigenen Gebäude:** Liegt der Standort in einem Gebäude des Imports, das der Laserscan enthält (nicht
  entfernt, nicht bearbeitet), oder auf dessen Umriss mit der Fassade nach innen
  (`buildingHorizon.ts locationInsideOwnBuilding`), oder ist er noch der gewählte Adresspunkt (`addressPointStore`,
  was auch aus dem Gebäude-Import wurde: gescheitert, abgebrochen, beim Neuladen unterbrochen), wartet der Laserscan
  (Status `'waiting'`, kein Download, keine Rechnung): Sein Horizont wäre das Gebäude selbst. Es gelten die Prismen
  ohne das eigene Gebäude; die Jahreswerte sind vorläufig mit «Standort noch nicht im Lageplan bestätigt» und «Zum
  Lageplan» bzw., ohne Gebäude, «Gebäude laden» / «Erneut versuchen» (`PlacementPrompt.tsx`). Ein Download wartet
  ausserdem, solange ein Gebäude-Import angefragt ist oder läuft (dessen Gebäude entscheiden das). Siehe
  [Integration](#integration-adresse-laserscan-und-gebäude-zusammen).
- **Offene Annahmen:** Bäume gelten ganzjährig als undurchsichtig (Befliegungen meist ohne Laub, Bern März 2023);
  Prismen mit flachem Dach überschätzen Schrägdächer (RMS 5.7–10.2° gegen den Laserscan an einem Ort); importierte
  Gebäude stehen auf dem Boden des Standorts (Basis 0); ob die Grundrisse Dachüberstände enthalten, ist offen.
  `Building` speichert nur einen Ring: Höfe als Schlüssellochring speichern (`polygon.ts bridgeHoles`), sonst gilt
  ein Beobachter im Hof als «im Gebäude» und das Gebäude fehlt im Horizont.

### Datenquellen, Lizenz und Anfragen

- **Adresssuche:** `api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=address&sr=2056`; LV95
  aus `geom_st_box2d` (mm) → `lv95ToWgs84`; `<b>` aus dem Label entfernen; `attrs.x/y` sind vertauscht (x = Nord);
  exakter Treffer = Strasse + `attrs.num` gegen den eingegebenen Text, `weight > 1000` = unscharf; featureId
  `<EGID>_<EDID>`. Gebäudeangaben: `…/ech/MapServer/ch.bfs.gebaeude_wohnungs_register/<featureId>` (Geschosse
  `gastw`, Baujahr `gbauj`, `garea`, `egid`; in Liechtenstein 404 → ausblenden). Höhe:
  `…/rest/services/height?easting=…&northing=…&sr=2056`.
- **Gebäude:** Basiskarte-Vektorkacheln `vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/{z}/{x}/{y}.pbf`
  (`buildingSources.ts`): z14, Layer `building` mit `class`, `render_height`, `render_min_height` (ganze Meter,
  mindestens 5 m, `render_min_height` überall 0), ohne Feature-ids, Polygone mit 16 Einheiten Puffer (≈ 6.5 m) über
  die Kachel hinaus beschnitten. Jedes Teil wird auf seine Kachel beschnitten und Stücke gleicher Höhe und Klasse
  werden über Kachelkanten wieder zusammengefügt (Kramgasse 49, vier Kacheln: ohne das 179 getrennte Paare, danach 0;
  im 300-m-Umkreis 1'545 → 1'513 Teile). `class: 'underground'` wird übersprungen. Ausserhalb CH/FL enthalten die
  Kacheln keine Gebäude, ausserhalb der Grenzen des Kachelsatzes (`tiles.json` bounds `[3.57, 44.18, 13.66, 48.88]`,
  z. B. Paris, Wien) antwortet der Server mit 404: beides ist «keine Daten», kein Fehler (`covered: false`, Hinweis
  «nur in der Schweiz und Liechtenstein verfügbar»). **Grenzorte:** Die Kacheln enthalten nur die Gebäude auf der
  Seite von CH/FL; `coverage` (0–1) ist der Anteil des Umkreises in CH/FL, berechnet aus dem Länderpolygon
  `administrative_unit` (admin_level 2, `iso_a2: 'not_CH_LI'`) derselben Kacheln (300 m: Kreuzlingen 0.41,
  Genf-Moillesulaz 0.77, Chiasso 0.78, Bern 1). B und C zeigen bei `coverage < 1` den Hinweis «Gebäude ausserhalb
  der Schweiz und Liechtensteins fehlen» (Gebäudeliste, Laserscan-Status). Die Maske `trees === false` darf Zellen
  ausserhalb CH/FL (`DecodedTile.outside`) nicht zu Boden machen, sonst verschwinden dort Gebäude, die der
  Laserscan hat. 300 m um die Kramgasse: 4 Kacheln, 694 kB, 1.2 s, Dekodieren ≈ 55 ms,
  Zusammensetzen ≈ 30 ms (Node). `npm run validate:buildings` prüft live.
- **Laserscan:** STAC v1 `data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swisssurface3d-raster/items?bbox=…`
  (neuestes Jahr je Kachel), COG float32 LZW (Prädiktor 1), 512 × 512 Kacheln, NoData −9999, 0.5 m; volle Auflösung
  nötig (Übersichten glätten Kanten, RMS 1.3–3.8°). Range → 206, aber `Content-Range` ist per CORS nicht lesbar. Die
  Cache API nimmt keine 206-Antworten: die fertigen Horizonte cachen (storageCache), nicht die Bytes. Boden:
  swissALTI3D (`ch.swisstopo.swissalti3d`) oder der Höhendienst. Eigener LZW-Leser statt geotiff (216 ms gegen
  1.4–2.0 s für dasselbe Fenster, 0 Abweichungen).
- **Lizenz:** freie Geodaten von swisstopo, auch kommerziell; Quellenangabe «© swisstopo» ist Pflicht (Footer;
  Druckbericht mit den Gebäuden). Die Attribution der Vektorkacheln kommt aus `tiles.json`.
- **Anfragen:** FSDI-Nutzungsbedingungen: «API Rest Services (general) | \*.geo.admin.ch | 21 Mio requests / year | 40
  requests / minute». Suche frühestens 300 ms nach der letzten Eingabe, mit Cache. Alle Anfragen über
  `fetchRetry.ts`: gestutzter exponentieller Backoff mit Jitter, wie geo.admin.ch es verlangt (1 s, 2 s, 4 s …
  höchstens 8 s, plus 0–1 s), nur Netzwerkfehler, Zeitüberschreitungen, 408, 429 und 5xx. Jeder Versuch hat eine
  Frist (`attemptTimeoutMs`, Standard 15 s, Kacheln 10 s), danach wird er abgebrochen und wiederholt; nach
  `deadlineMs` (Standard 20 s, Kacheln 15 s) beginnt kein neuer Versuch mehr (höchstens also diese Zeit plus ein
  Versuch). Antworten mit Inhalt
  (Kacheln, COG-Bereiche des Laserscans, JSON) über `fetchBytesWithRetry` bzw. `fetchReadWithRetry` lesen: nur dann
  liegt das Lesen des Körpers in der Wiederholung und in der Frist (eine abbrechende Mobilverbindung mitten im
  Download ist ein Netzwerkfehler und wird wiederholt). `fetchWithRetry` kehrt schon nach den Kopfzeilen zurück.
  Der Abbruch durch den Aufrufer (`AbortSignal`) ergibt immer `'aborted'`, nie ein Ergebnis. Netzwerkcode wirft
  nie bis zur UI (typisierte Fehler), nimmt `AbortSignal` und ein `fetchImpl` für Tests. Ohne Nutzeraktion gibt es
  keine Anfrage ausser dem Import der Umgebung nach der Wahl einer Adresse.
- **Ablauf nach einer Adresswahl:** Die Adresssuche setzt Standort (Label, 1e-6°, Zeitzone Europe/Zurich bzw.
  Europe/Vaduz, Höhe vom Höhendienst) und ruft `useUiStore.requestSurroundingsImport(lat, lon)`; der Gebäude-Import
  holt die Anfrage mit `consumeSurroundingsImport()` ab (einmal je Anfrage), importiert die Gebäude im Radius
  `surfaceModel.radius`, schaltet den Laserscan ein und öffnet den Lageplan. Der Laserscan lädt erst nach
  «Übernehmen» im Lageplan (vorher liegt der Standort im eigenen Gebäude, siehe Rechenregeln und
  [Integration](#integration-adresse-laserscan-und-gebäude-zusammen)).

### Zuständigkeiten der parallelen Arbeit

Jede Datei hat genau eine Zuständigkeit; neue Dateien gehören ihrem Feature. Das Fundament ändert sich nur nach
Absprache (additiv, ohne bestehende Signaturen zu brechen).

- **Fundament** (eingefroren): `model/types.ts`, `defaults.ts`, `share.ts` (+ Test), `polygon.ts`, `enu.ts`,
  `lv95.ts`, `fetchRetry.ts`, `buildingSources.ts`, `surroundings.ts`; `state/dataStore.ts`, `uiStore.ts`,
  `configStore.ts`; `hooks/useTerrain.ts`, `hooks/useModel.ts`; `app/DataLoader.tsx`, `app/Footer.tsx`;
  `controls/HorizonSection.tsx`, `controls/BuildingSection.tsx`, `controls/horizon/HorizonSparkline.tsx`;
  `test/utils.ts`; `package.json`; README «Datenquellen und Datenschutz»; dieser Abschnitt bis hier.
- **A, Adresssuche und GWR:** `controls/LocationSection.tsx` (+ Test; Breiten- und Längengrad mit 6
  Nachkommastellen), `controls/location/*` (Adresssuche statt PlaceSearch, Gruppen «Adressen»/«Orte»,
  Gebäudeangaben), neu `model/geocode.ts` (+ Test), `e2e/address.spec.ts`.
- **B, Laserscan:** `hooks/useSurfaceModel.ts` (Loader; Semantik der Leser), `model/dsmHorizon.ts`, neu
  `model/dsm.ts` und `model/cog.ts`, `workers/*`, `controls/horizon/SurfaceModelControls.tsx`,
  `controls/horizon/TerrainStatus.tsx`, die Hinweise «vorläufig» (`app/KpiBar.tsx`, `controls/TiltControl.tsx`,
  `charts/ShadeHeatmap.tsx`), `scripts/validate-dsm.ts` (dazu die Zeile `validate:dsm` in `package.json`),
  `e2e/surface.spec.ts`.
- **C, Gebäude, Lageplan, 3D:** `model/buildingHorizon.ts` (`prismFloorHorizons`), neu `model/buildings.ts`
  (Kantensweep, Ausdünnen, Fassadenkanten, Brandmauern), `controls/horizon/BuildingList.tsx`, `controls/siteplan/*`,
  `views/scene3d/*` (`Buildings3D.tsx`, `SceneContent.tsx`, `useSceneData.ts`, `SceneStage.tsx`, `sceneLayout.ts`,
  `Surroundings.tsx`), `export/PrintReport.tsx`, `e2e/buildings.spec.ts`.

Jedes Feature ergänzt diesen Abschnitt nur in seinem eigenen Unterabschnitt (neue `###`-Überschrift am Ende), PLAN.md
nur in seiner eigenen Zeile. Die E2E-Specs blockieren `geo.admin.ch` bereits (`page.route`); eigene Specs mocken die
Antworten.

### A: Adresssuche und Gebäudeangaben (umgesetzt)

- **`model/geocode.ts`:** `searchSwissAddresses` (SearchServer, `origins=address`, `sr=2056`, 8 Treffer, höchstens
  10 Wörter, sonst HTTP 400), `fetchBuildingInfo` (GWR-Feature, 404 → `null`), `fetchGroundHeight` (Höhendienst,
  0.1 m), `findNearestAddress` (identify auf `ch.swisstopo.amtliches-gebaeudeadressverzeichnis`, CH und FL,
  Toleranzkreis 50 m bei 1 m je Pixel, Punkt auf 0.1 m). Alle geben ein `GeoResult` zurück (`error.kind`: `aborted`,
  `network`, `http`, `timeout`, `invalid`), nehmen `signal`, `fetchImpl` und `limiter` und werfen nie.
  Wiederholungen über `fetchReadWithRetry` (Suche 2 mit Frist 10 s, sonst 3 mit 15 s). Höchstens 30 api3-Anfragen je
  Minute aus diesem Modul (gleitendes Fenster `API3_BUDGET`, Platz für die anderen Nutzer von geo.admin.ch unter den
  40/min der FSDI); jeder Versuch belegt einen Platz, eine Wiederholung nach ihrer Wartezeit und der Fristprüfung
  von fetchRetry (über dessen `sleep`; die Zeitgrenze des Versuchs beginnt erst mit dem Platz). Ergebnisse je
  Suchtext, Feature und Punkt gecacht (je 50).
- **Treffer lesen:** Label ohne `<b>` als «Strasse Nummer, PLZ Ort» (Eingänge ohne Nummer, «#», ohne Nummer); die
  Hausnummer kommt aus dem Label, weil `attrs.num` Buchstaben und Punkt verliert («12a» → 12, «5.1» → 51). LV95 aus
  `geom_st_box2d` (mm) → `lv95ToWgs84` → 1e-6° (Kramgasse 49: ≤ 0.1 m neben REFRAME). `featureId` = `<EGID>_<EDID>`.
  `match`: `exact` (Strasse und Hausnummer stehen im Suchtext; verglichen klein, Umlaute als ae/oe/ue wie im
  `detail`, ohne Akzente), `partial`, `fuzzy` (weight > 1000; nur behalten, wenn die Hausnummer eingetippt wurde
  und die Strasse wie eingetippte Wörter geschrieben ist: aufeinanderfolgende Wörter ohne Ziffer, ohne Leerzeichen,
  höchstens eine Änderung je 5 Buchstaben der Strasse, mindestens 1, vertauschte Nachbarbuchstaben zählen einfach).
  SearchServer beantwortet jede Eingabe mit Hausnummer mit unscharfen Schweizer Treffern dieser Nummer; so bleibt
  «Kramgase 49 Bern» → Kramgasse 49 und «Rte de Lausanne 10 Morges» → Rue de Lausanne 10, während «Stephansplatz 1
  Wien», «Via Roma 1 Milano» (Via Milano 1 Chiasso, Via Rime 1 Mendrisio) und «Rue de Rivoli 10 Paris» keine Adressen
  geben (ausserhalb von CH/FL wie bisher). Abkürzungen («Bahnhofstr. 1») sind normale Treffer. Reihenfolge exakt,
  teilweise, unscharf. **Liechtenstein:** Das `detail` endet in FL ohne Kanton («… 9490 vaduz 7001 vaduz ch»); massgebend ist
  die Gemeindenummer 7001–7011 vor «ch» (alle 11 Gemeinden am 25.09.2026 geprüft), ersatzweise die PLZ 9485–9498 →
  `Europe/Vaduz`, sonst `Europe/Zurich`. Das GWR hat für FL keine Einträge (404).
- **GWR-Codes** (Merkmalskatalog 4.2): GASTW Geschosse (mit Erdgeschoss; Dach- und Untergeschosse nur bewohnt oder
  beheizt; ohne Keller), GBAUJ Baujahr, GBAUP Bauperiode (8011 «vor 1919» … 8023 «ab 2016»; angezeigt, wenn das
  Baujahr fehlt, etwa Kramgasse 49), GAREA Grundfläche, GKAT Kategorie (1010 … 1080).
- **Suche (`location/PlaceSearch.tsx`):** Adressen und Orte parallel, je Quelle eine Anfrage 300 ms nach der letzten
  Eingabe, eine neue Eingabe bricht beide ab. Eine Combobox mit den Gruppen «Adressen» (swisstopo) und «Orte»
  (Open-Meteo, 6 Treffer); mit einer Ziffer im Suchtext (Hausnummer) stehen die Adressen oben, sonst die Orte.
  Ergebnisse erscheinen je Quelle; die aktive Option hängt an ihrem Schlüssel, später eintreffende Treffer
  verschieben sie nicht. Ist nur die Adresssuche nicht erreichbar, steht das in einer eigenen Zeile, die Orte
  bleiben. Eine Ortswahl verhält sich wie bisher.
- **Adresswahl (`location/addressSession.ts`, `applyAddress`):** Standort = Label, 1e-6°, Zeitzone (Höhe vorerst
  unverändert); `surfaceModel.enabled = true` (Bäume und Radius bleiben); `requestSurroundingsImport(lat, lon)`; danach
  im Hintergrund Höhe (→ `location.elevation`, auf 1 m; bei einem Fehler bleibt die alte) und GWR. Die GWR-Angaben
  leben nur in der Sitzung (`useAddressSession`, keine Config-Felder: nach dem Neuladen bräuchte es sonst eine
  Anfrage ohne Nutzeraktion) und stehen im Block «Gebäude an der Adresse», solange `location.name` das Label ist und
  der Standort höchstens 500 m (`LIMITS.surfaceModel.radius.max`, der Lageplan verschiebt ihn auf die Fassade des
  eigenen Gebäudes) vom Eingang liegt.
- **«Mein Standort»** bietet danach «Nächste Adresse übernehmen» an, solange der Standort die Geräteposition ist;
  erst dieser Klick sendet die Koordinaten an geo.admin.ch. Die nächste Adresse im Umkreis von 50 m wird wie eine
  Suchwahl übernommen (Meldung mit Abstand), der Fokus geht danach an «Mein Standort». Ersetzt ein anderer Standort
  die Geräteposition, während die Adresse gesucht wird (Suche, Vorlage, Teilen-Link, Koordinaten), wird die Anfrage
  abgebrochen und eine späte Antwort verworfen (geprüft am Config-Standort, nicht an der Prop).
- Breiten- und Längengrad mit 6 Nachkommastellen.
- **Tests:** `geocode.test.ts` auf aufgezeichneten Antworten (`model/geocode.fixtures.json`, 25.09.2026),
  `LocationSection.test.tsx`, `e2e/address.spec.ts` (nur Tastatur, die Entprellung auf der Playwright-Uhr statt
  abhängig vom Tipptempo; Handy 390 × 844 mit 16-px-Feld, 44-px-Optionen, ausländischer Adresse ohne Schweizer
  Doppelgänger und «Nächste Adresse übernehmen»; beide Basis-Pfade). `requestSurroundingsImport` prüft der Komponententest am Store,
  E2E den eingeschalteten Laserscan im Teilen-Hash (ohne Gebäude-Import ist der Aufruf im Browser nicht sichtbar).
- Gemessen in der Sandbox hinter einem Proxy (nicht repräsentativ für die Schweiz): SearchServer bis 7 s, GWR und
  Höhe 3–5 s; die Ergebnisse erscheinen deshalb je Quelle, sobald sie da sind.

### B: Laserscan-Horizont (umgesetzt)

- **Dateien:** `model/cog.ts` (COG-Leser), `model/dsm.ts` (STAC, Mosaik, Boden, Masken, Strahlengang, Speicher des
  Workers), `model/dsmEstimate.ts` (was die Seite braucht: Ausdehnung, Algorithmusversion, Datenschlüssel,
  Schätzung der Datenmenge; von `dsm.ts` wieder exportiert), `workers/*` (Auftrag `dsm`),
  `hooks/useSurfaceModel.ts` (Leser; Loader und Ergebnis-Cache seit der Integration in
  `hooks/surfaceModelLoader.ts`, eigener Chunk), `controls/horizon/SurfaceModelControls.tsx`,
  `controls/horizon/provisional.ts` (Text der Hinweise «vorläufig» in KpiBar, TiltControl und ShadeHeatmap),
  `test/cogFixture.ts` (synthetische COGs, STAC, Höhendienst und Vektorkacheln für Tests und E2E),
  `scripts/validate-dsm.ts`, `e2e/surface.spec.ts`.
- **COG-Leser:** klassisches TIFF, float32, LZW oder unkomprimiert, Prädiktor 1, gekachelt, nur IFD0 (volle
  Auflösung). Eine Kopfzeilen-Anfrage `bytes=0-16383` (IFD0 endet bei Byte 1'148, im 2-m-DTM bei 1'564), die bei
  Bedarf wächst; dann nur die Kacheln des Fensters, Kacheln im Abstand von höchstens 1 kB (GDAL: 8 Byte) bis
  640 kB zu einer Anfrage zusammengefasst, 4 Anfragen gleichzeitig, je Versuch 30 s, Wiederholung bis 60 s
  (`fetchByteRange` über `fetchReadWithRetry`; ein 200 statt 206 mit grossem Körper wird ohne Lesen abgelehnt).
  `Content-Range` wird nie gelesen. Der LZW-Dekoder liefert auf 12 Mio. Zellen dreier swisstopo-Dateien (2 × DSM,
  1 × DTM 0.5 m) dieselben Werte wie geotiff.js (0 Abweichungen), 13 ms je 512er-Kachel (Node).
- **Auftrag im Worker** (`computeDsmJob`, wirft nie): Ausserhalb der Ausdehnung der Collection keine Anfrage,
  `'unavailable'`. Sonst STAC v1 `items?bbox=…&limit=100` mit allen Folgeseiten (`rel: next`), je km-Kachel das
  neueste Jahr; Fenster = Radius + 8 m (Beobachter liegen höchstens 5.25 m vor dem Standort) als LV95-Gitter auf dem
  0.5-m-Raster der Dateien, Mosaik über bis zu 4 Dateien (NoData → NaN). Boden am Standort vom Höhendienst,
  gleichzeitig mit STAC angefragt; schlägt er fehl, bilinear aus swissALTI3D 2 m. Abdeckung = Anteil der Zellen des
  Kreises mit Daten (`dataStore.surface.coverage`). Im Speicher des Workers bleiben die Kopfzeilen (32), die
  komprimierten Kacheln (bis 24 MB: kleine Standortverschiebungen und abgebrochene Downloads laden nur Fehlendes),
  die letzten Mosaike (3), der maskierte Raster (mit den Teilen der Vektorkacheln) und die Vektorkacheln, der Boden
  am Standort (auch der aus dem Geländemodell); neue Beobachter und neue Masken rechnen ohne Download. Der
  Eigenbereich (`dsmExclusionZone`: Balkontiefe, Reihenbreite, eigener Grundriss, sonst der Teil der Vektorkacheln)
  entsteht je Auftrag, nie im Speicher: Der Schlüssel des maskierten Rasters enthält ihn nicht (vor dem Review
  rechnete ein zweiter Auftrag mit anderer Balkontiefe mit der alten Zone, ein Anbau vor der Fassade fehlte dann
  im Horizont; `dsm.test.ts` vergleicht aufeinanderfolgende Aufträge mit frischen; `DSM_ALGORITHM_VERSION` 2
  verwirft so entstandene Cache-Einträge). `memoryOnly`: Der Auftrag rechnet nur aus dem Speicher; bräuchte er
  eine Anfrage, endet er sofort mit `'miss'` (keine Anfrage). Der Fortschritt zählt die Kacheln im Speicher als
  geladen, ein abgebrochener Download läuft beim nächsten dort weiter. Zwischen den Beobachtergruppen gibt der
  Worker die Ereignisschleife frei (andere Aufträge kommen dran).
- **Masken:** Gemessen an Breitenrain und Kramgasse (je 150 m, Gebäude ab 8 m): Zellen 0–0.5 m ausserhalb der
  Grundrisse der Vektorkacheln liegen zu 69–70 % mehr als 2.5 m über Boden, 0.5–1 m ausserhalb zu 36–39 %,
  1–1.5 m zu 28 %, 2–3 m (Hintergrund: Bäume, andere Objekte) zu 22 %: Die Grundrisse lassen einen Dachrand von etwa
  1 m aus. Entfernte und geänderte Gebäude maskieren deshalb bis 1 m über ihren Grundriss hinaus
  (`DSM_REMOVE_BUFFER_M`, schneidet bei angebauten Nachbarn 1 m ab); ohne Bäume bleiben Zellen bis 1 m um die
  Grundrisse erhalten (`DSM_KEEP_BUFFER_M`, Höfe ohne Rand zählen als Boden). Ohne Bäume lädt der Worker alle
  Vektorkacheln des Radius selbst; Zellen in `outside` (ausserhalb CH/FL) behalten den Scan. Boden der maskierten
  Zellen: swissALTI3D 2 m bilinear (≈ 48 kB je 256-m-Kachel, im Mittel 9 % der Scan-Daten), parallel zum Scan geladen.
  Ohne Grundriss des eigenen Gebäudes in der Config bestimmt der Teil der Vektorkacheln die Ausdehnung, falls sie
  geladen sind (Bäume aus), sonst ± (Reihenbreite / 2 + 2 m); dann zählen Traufen des eigenen Hauses jenseits davon
  entlang der Fassade als Hindernis.
- **Strahlengang:** je Beobachtergruppe (gleiches n, Höhen der Stockwerke) 2'880 Strahlen (0.125°) bis zum Radius
  durch jede Zelle, die sie kreuzen (Amanatides–Woo), jede im Abstand, in dem der Strahl sie betritt (der steilste
  Blick auf die Zelle entlang des Strahls; mindestens `DSM_NEAR_M` = 0.25 m); Richtungen in ENU, über
  `lv95LocalFrame` ins Raster. Zellen, deren Mitte im eigenen Bereich liegt (n < 0.5 m, Balkonzone), zählen nicht
  (`isOwnBuildingCell`). Jeder Azimut der Ausgabe (0.5°) nimmt das Maximum der 5 Strahlen über ± 0.25°; Werte unter
  0° werden 0 (Himmelssichtfaktor zählt negative Werte ohnehin als 0). **Bis Version 2** ging jeder Strahl in
  0.25-m-Schritten und las die nächste Zelle; der eigene Bereich wurde am Probenpunkt geprüft. Die Schritte
  übersprangen Zellen, die ein Strahl nahe am Beobachter nur anschneidet (einzelne Pfähle, lichte Kronen), sodass der
  Horizont tiefer Stockwerke zu tief und der Ertrag zu hoch lag; und Strahlen fast parallel zur Fassade (86–88°
  neben der Normalen) lasen knapp ausserhalb der Balkonzone Zellen der eigenen Traufe, deren Mitte darin liegt
  (Breitenrain 1. OG: 60.4° statt 53.8°). Gemessen auf dem Raster der Breitenrainstrasse 10 (Fassade 154°, 4
  Stockwerke, Wetter 2025): Jahresertrag 2'922.8 → 2'886.1 kWh (1. OG 407.9 → 391.3 kWh, −4.1 %); ein Marsch in
  1-cm-Schritten mit derselben Regel ergibt 2'887.5 kWh. Kramgasse 49: 880.2 → 877.0 kWh (1-cm-Marsch 877.1).
  `DSM_ALGORITHM_VERSION` 3 verwirft ältere Cache-Einträge. Tests (`dsm.test.ts`): gegen Brute Force (Pfähle,
  Baumkronen, Blöcke bis 150 m) nie über dem Maximum, das ein Strahl durch irgendeinen Teil der Zellen sehen könnte
  (nächster Punkt jeder Zelle), und an 0 von 720 Azimuten mehr als 0.5° unter dem Maximum über die Zellmitten des
  Azimuts; ein Strahl je Azimut liegt dort an 9 Azimuten darunter (bis 15.9°); RMS zur oberen Grenze 0.26° (ein
  Strahl: 2.68°). Einzelne Pfähle 1.5–12 m vor dem Beobachter: an allen 720 Azimuten zwischen einem Marsch in
  2-mm-Schritten und 0.05° darüber. Balkonplatten in jeder Zelle der Balkonzone: 0° an allen Azimuten (Version 2:
  85.2°).
- **Loader** (`useSurfaceModelLoader`): Standort, Fassade, Balkon, Reihenbreite, Bäume, Radius, Masken und eigener
  Grundriss ergeben den Auftrag (`surfacePlan`, `jobKey`); was geladen werden muss, nur Standort, Radius, Bäume und
  ob es Masken gibt (`dataKey`, `dsmDataKey`). Rechnen und Laden sind getrennt: Ein neuer Auftrag wartet 800 ms
  und zeigt `'loading'`, neue Beobachter desselben Standorts (Neigung, Stockwerke) warten 250 ms, die übrigen
  Horizonte bleiben aktiv (`dsmFloorHorizons` nimmt den nächsten Beobachter). Gerechnet wird aus dem Ergebnis-Cache
  oder mit `memoryOnly` im Worker. Erst ein `'miss'` (neuer Standort, oder der Speicher des Workers ist nach einem
  Reload leer) startet den Download des `dataKey`: nach `terrainDownloadGate`, mit Fortschritt und MB, als
  `'loading'` oder, solange die Horizonte des Standorts gezeigt werden, als Nachladen (`useSurfaceRefresh`:
  «Laserscan wird nachgeladen …», die Jahreswerte gelten als vorläufig, solange einem aktuellen Beobachter der
  eigene Horizont fehlt). Nur ein anderer `dataKey` oder das Ausschalten bricht den Download ab; Neigung, Stockwerke,
  Fassade, Balkon, Reihenbreite oder Masken rechnen danach aus dem Speicher (vor dem Review brach jede
  Neigungsänderung die laufenden Bereiche ab, im Browser 4 × `net::ERR_ABORTED` und dieselben Bereiche erneut; und
  nach einem Reload lud eine Neigung um 1° die 5 MB ohne Anzeige). Ein fehlgeschlagenes Nachladen wird gemeldet
  (mit «Erneut versuchen»), die Horizonte bleiben; bis dahin rechnen neue Beobachter mit dem nächsten. Nach
  `'ready'` folgen die Neigungen des Sweeps (0–90° in 5°-Schritten) in einem Auftrag aus dem Speicher (fehlt er,
  ebenfalls Nachladen); dauert das länger als 1.5 s, zeigt die Neigungskarte das Optimum als vorläufig
  (`useSurfaceSweepPending`). `useSurfacePending` ist auch wahr, solange frisch angekommene Horizonte die
  verzögerten Jahreswerte noch nicht erreicht haben (wie beim Gelände), damit kein Bild mit dem Prismen-Ersatz als
  endgültig gilt. Nach einem Fehler oder ausserhalb CH/FL lädt erst «Erneut versuchen» bzw. ein neuer Standort.
  Ergebnis-Cache `ssa.surface.v1:*`: je Auftrag ein Eintrag (Datenstand, Bytes, Abdeckung; Horizonte in 0.01° als
  Uint16, die Nullhälfte hinter der Fassade weggelassen, ≈ 1 kB je Beobachter), 3 Standorte; ein Standort
  ausserhalb CH/FL wird ebenfalls gemerkt. Ein Eintrag behält von den früher gespeicherten Beobachtern nur die des
  Plans (aktuelle Neigung und Sweep) und die `SURFACE_CACHE_EXTRA_OBSERVERS` = 16 jüngsten übrigen: Stockwerkhöhe,
  Stockwerke oder Panellänge ändern die Beobachter, nicht den Auftrag, und jede Änderung fügte vorher ihre
  Beobachter für immer hinzu (Review: nach 30 Änderungen mit 8 Stockwerken 4.8 Mio. Zeichen, bis das Kontingent
  des localStorage voll war und danach auch `ssa.config` nicht mehr gespeichert wurde). Ein Lesen frischt den
  Zeitstempel eines Eintrags nur einmal je Sitzung auf (vorher schrieb jedes Lesen den ganzen Eintrag neu).
- **Fundament, additiv:** `dataStore.surface.coverage` (0–1, null solange unbekannt).
- **Validierung** (`npm run validate:dsm`, 25.09.2026, Version 3): Breitenrainstrasse 10, Beobachter 1 m vor der
  Fassade (Normale 153.4° im LV95-Gitter), 8 m / 14 m über Boden: 32.73° / 18.03° auf der Normalen (Prototyp
  32.54° / 17.97°, von Hand 32.68° / 17.97°; Version 2: 32.52° / 17.92°), 2 m: 52.23° (Prototyp 52.1°). Ohne Bäume
  2 m: 43.90° (Version 2: 43.66°; Strassenbäume weg; das Haus gegenüber, 18.65 m entfernt, 19.88 m hoch, gibt von
  Hand 43.8°), 8/14 m unverändert; mit den beiden Teilen gegenüber als entfernt (Version 2): 14.39° / 7.15°.
- **Gemessen:** Node (Proxy der Sandbox): 4 Dateien, 9 Kacheln, 15 Anfragen (STAC, Höhe, 4 Kopfzeilen, 9 Bereiche),
  5.01 MB, 2.0–5.2 s, davon Dekodieren 180–204 ms und Strahlen 51–63 ms je Gruppe mit 2–3 Höhen (Version 3: 32–49
  ms, `validate:dsm`; auf dem Raster der Breitenrainstrasse 13–25 ms mit 2–4 Höhen gegen 18–27 ms); ohne Bäume
  zusätzlich 0.85 MB in 12 Anfragen, Masken 156–196 ms. Chromium (Dev-Server, Worker, derselbe Proxy, 4 Stockwerke):
  15 Anfragen, 5.01 MB, bereit nach 41–50 s, dominiert vom Proxy (≈ 1 Mbit/s je Verbindung, STAC 4.8 s,
  einzelne Anfragen mit `net::ERR_TOO_MANY_RETRIES`, von den Wiederholungen aufgefangen); die 76 Beobachter des
  Sweeps folgten 1.0–1.1 s danach. Der Worker-Chunk wächst von ~31 kB auf 76 kB (Vektorkacheln, COG, DSM). Nach
  dem Review (Chromium, Telefon- und Desktop-Ansicht, Breitenrainstrasse 10, 4 Stockwerke): eine Neigungsänderung
  während des Downloads bricht nichts ab (9 Bereiche, 9 verschiedene; Wiederholungen nur nach
  `ERR_TOO_MANY_RETRIES` des Proxys); nach einem Reload 0 Anfragen, eine neue Neigung (42°) lädt sichtbar nach
  (16–20 Anfragen, 33–45 s bis «Laserscan geladen»). Haupt-Chunk: Die Pipeline (`dsm.ts`, `cog.ts`,
  Vektorkacheln, pbf) liegt nur noch im Worker und für den Ersatz ohne Worker in einem nachgeladenen Chunk (42 kB);
  Einstieg mit den beiden vorgeladenen gemeinsamen Chunks 638 kB (gzip 216 kB), vor dem Review 674 kB (227 kB),
  Fundament 616 kB (207 kB).
- **Offen:** Safari/iOS und Firefox ungeprüft (CORS mit Range); ob die 40 Anfragen/Minute auch für
  `data.geo.admin.ch` gelten, ist unbekannt (ein Standort: 15 Anfragen, ohne Bäume 27).

### C, Gebäude: Prismen-Horizont, Import und Liste (Teil 1)

- **Prismen-Horizont** (`model/buildings.ts` `prismHorizonTangents`, exakter Kantensweep): Jede Grundrisskante deckt
  vom Beobachter aus ein Azimutintervall; für jeden Horizontschritt darin ist der Abstand t des Strahls zur Kante
  exakt, und ein flaches Dach ist an der nächsten Kreuzung am höchsten (tan = (Dach − z) / t). Alle Höhen einer
  Beobachterposition in einem Durchgang, beliebige Umlaufrichtung, Höfe als Schlüssellochring ohne Sonderfall;
  Prismen, die den Beobachter enthalten, zählen nicht (wie bei `obstacleHorizon`). Gegen `obstacleHorizon` auf 1'000
  Quadern (5 Fassaden, 6 Höhen) höchstens 1.4e-14°, gegen einen Strahltest je Azimut auf konkaven Sternpolygonen
  unter 1e-9°, gegen einen Marsch in 1-cm-Schritten (U-Form, Hof) höchstens ein Schritt (Tests). Ein Prisma mit Basis
  über dem Beobachter zählt bis zum Boden (ein Horizontprofil hat keine Lücken).
- **`prismFloorHorizons`** (`buildingHorizon.ts`): Regeln von `prismBuildings`/`ownBuildingIds` (das eigene Gebäude
  nur vor der Balkonzone, siehe Teil 3), Beobachter = Panelmitte jedes Stockwerks (Stockwerke gleicher Position in
  einem Sweep); die Prismen im Fassadenrahmen bleiben für die letzte Kombination aus Gebäudeliste, Anker, Standort,
  Fassade, Balkontiefe und dsmActive gemerkt (der Neigungs-Sweep ändert nur die Beobachter); `null`, wenn nichts über
  eine Panelmitte ragt. Gemessen (Node 22, Xeon 2.1 GHz, je 120 importierte Gebäude, 940–1'024 Ecken, 8 Stockwerke):
  0.5–0.9 ms je Aufruf, alle 19 Neigungen 6.5–11 ms.
- **Import** (`hooks/useBuildingImport.ts`, Zustand `state/buildingImportStore.ts`, nicht persistiert): nach einer
  Adresswahl (`useBuildingImportLoader`, in `<DataLoader/>` gemountet: die einzige Änderung am Fundament, weil
  «Horizont & Umgebung» seinen Inhalt nur offen rendert) oder mit «Gebäude laden» um den Standort:
  `fetchSwisstopoBuildings(Punkt, surfaceModel.radius)` im Worker (Teil 3) mit Fortschritt (Kacheln, dann Auswahl),
  Abbrechen, Fehler mit «Erneut versuchen»; ausserhalb CH/FL `unavailable` (Config unverändert), bei `coverage < 1`
  der Hinweis «Gebäude ausserhalb der Schweiz und Liechtensteins fehlen». Eigenes Gebäude: der Teil, der den Punkt 0.5
  m hinter dem Fassadenursprung enthält (nur «Gebäude laden»), sonst der den Adresspunkt enthält, sonst der nächste
  bis 25 m. Gespeichert werden Anker (Importpunkt, 1e-6°), Radius und das lokale Datum; importierte Gebäude werden
  ersetzt, von Hand erfasste bleiben (auf den neuen Anker umgerechnet; über 2 km davon entfernt fallen sie weg,
  gemeldet), ids `b<Index + 1>` (kompakte Form im Teilen-Link; importierte zuerst, dann die von Hand erfassten). Eine
  Adresswahl schaltet den Laserscan ein und setzt `sitePlanRequest` (Teil 2 öffnet damit den Lageplan,
  `consumeSitePlanRequest`), auch wenn der Import scheitert oder auf «Neu laden» / «Behalten» wartet. Tragen
  importierte Gebäude Änderungen (entfernt, bearbeitet), fragt «Neu laden» zuerst (`pendingConfirm`); nach einer
  Adresswahl nur, wenn die Adresse im Radius des bisherigen Imports liegt, weiter weg gehören die Änderungen zu einem
  anderen Ort. Ein neuer Import bricht einen laufenden ab.
- **Ausdünnen** (`model/buildingImport.ts` `horizonScores`, `planImport`): Beim Import sind Fassade und Balkon noch
  nicht bestätigt. Die Beobachter stehen deshalb an jeder wählbaren Fassade des eigenen Gebäudes (höchstens 3 m
  auseinander, von Ende zu Ende) und an der eingestellten Fassade, in den Höhen der eingestellten Stockwerke und ab
  0.5 m alle 3 m bis zur Dachhöhe (das oberste Geschoss sieht am weitesten), je in beiden Panelmitten-Abständen (0°
  und 90° Neigung). Je Horizontschritt vor der Fassade wird das höchste Prisma gemerkt (argmax); Punktzahl eines
  Gebäudes = höchster Winkel, den es so setzt. Behalten wird in dieser Reihenfolge, bis 120 Gebäude und 1'600 Ecken
  (Reserve von 30 Gebäuden und 400 Ecken für Eingaben von Hand; `sanitizeConfig` würde spätere Gebäude sonst
  stillschweigend abschneiden): das eigene Gebäude, angrenzende Teile (≤ 0.5 m, damit der Lageplan Brandmauern
  erkennt), die Horizontsetzer nach Punktzahl (ein weggelassenes Gebäude verändert den Horizont höchstens um seine
  Punktzahl; die Anzahl und dieser Wert werden gemeldet), dann die übrigen Teile im 60-m-Umkreis nach Abstand
  (Lageplan und 3D-Ansicht; 60 m wie der Schattenausschnitt der 3D-Szene). An den Beobachtern bleibt der Horizont
  gleich (Test); gemessen dazwischen (alle 1 m entlang aller Fassaden, 8 Stockwerke, drei Panelabstände, 300 m):
  Breitenrainstrasse 10 höchstens 0.26°, Kramgasse 49 0.00° bis 80° neben der Fassadennormale und 2.05° bei
  streifendem Blick (84°, 0.6 m hoch). Ergebnis im Browser: Kramgasse 1'513 Teile → 120 (85 setzen den Horizont),
  Breitenrain 536 → 119 (107); Auswahl 50–130 ms (Node), im Browser in Schritten zwischen den Frames. Teilen-Link
  damit 9'400–11'300 Zeichen.
- **Fassadenkanten** (`facadeEdges`): Aussennormale als geographischer Azimut, Länge, Anteil an anderen Teilen
  (Proben 0.5 m vor der Kante); Brandmauer ab der Hälfte (auch zu Teilen des eigenen Gebäudes), die Brücken eines
  Schlüssellochrings sind innen, wählbar ab 2 m; Hofkanten schauen in den Hof. Für Teil 2 ausserdem `edgePoint`,
  `projectOntoEdge`, `footprintToFacade`, `rectFootprint` (Rechteck im Fassadenrahmen → ENU, 0.1 m; `null` über 2 km
  vom Anker),
  `reanchorFootprint`, `buildingBearing`, `manualAnchor` und `controls/siteplan/buildingData.ts` (Namen
  «Gebäude k» aus der id, `useSiteGeometry`).
- **Liste** (`controls/horizon/BuildingList.tsx` mit `BuildingItem`, `BuildingImportStatus`, `AddBuildingForm`):
  Zusammenfassung (Anzahl, davon von Hand, Quelle swisstopo, Stand, entfernte), «im Laserscan enthalten» bei
  dsmActive, aufklappbare Liste (eigenes Gebäude zuerst, dann nach Abstand vom Balkon; 20, dann «Alle anzeigen») mit
  Name, Höhe und Basis (ändern → `edited`), Abstand und Richtung (unter 0.5 m «angrenzend»), Entfernen (importiert →
  `removed`, bleibt mit «wiederherstellen» an seinem Platz und behält den Fokus; von Hand → gelöscht, Fokus auf
  «Gebäude hinzufügen»), Rechteck von Hand (Abstand, Versatz, Breite, Tiefe, Drehung, Höhe, Basis; ohne Anker wird der
  Standort zum Anker mit Radius 0, ebenso ohne gespeicherte Gebäude, wenn der alte Anker zu weit weg ist; sonst
  erklärt eine Meldung, warum nichts hinzukam), leerer Zustand mit Hinweis auf die Adresssuche. Die Eingabe von Hand
  erhält den Fokus als Gruppe (auf Handys keine Bildschirmtastatur), ist kein `<form>` (Enter übernimmt nur das Feld).
  Alle Knöpfe `--touch`.
- **Tests**: `buildings.test.ts`, `buildingHorizon.test.ts` (Modell), `useBuildingImport.test.tsx` (Import mit
  gemocktem `fetchSwisstopoBuildings`, auch StrictMode), `BuildingList.test.tsx`, `e2e/buildings.spec.ts`
  (synthetische Vektorkacheln per `page.route`: laden, entfernen, nach dem Neuladen gespeichert, Rückfrage beim
  Neu laden, iPhone ohne waagrechtes Scrollen und mit 44-px-Zielen).

### C, Gebäude: Lageplan, 3D-Ansicht und Druck (Teil 2)

- **Lageplan** (`controls/siteplan/SitePlan.tsx` lädt `SitePlanPanel.tsx`, Zeichnung `SitePlanMap.tsx`, Geometrie
  `sitePlanModel.ts`): im Abschnitt «Gebäude» unter dem Fassadenazimut, sobald Gebäude mit Anker gespeichert sind;
  aufklappbar, zugeklappt eine Zeile zum Stand («Balkon an der Fassade 180° S …» oder «noch nicht auf einer Fassade»).
  SVG-Draufsicht in echten Pixeln (`useElementWidth`, Höhe 78 % der Breite, 240–440 px), Norden oben, Nordpfeil,
  Massstab (1, 2 oder 5 · 10^k m, höchstens 30 % der Breite). Grundrisse in einer Weltgruppe (Striche
  `non-scaling-stroke`), Marken in Pixeln: eigenes Gebäude (Akzent), Nachbarn, bearbeitete (Warnfarbe), von Hand
  erfasste (Ok-Farbe, gestrichelt), entfernte (nur gestrichelter Umriss), wählbare Fassaden (blau), Brandmauern
  (gepunktet), Balkon als Punkt auf der Fassadenlinie mit Pfeil der Aussennormale und der Panelreihe (Reihenbreite, um
  die Balkontiefe vor der Wand), die Adresse als Raute mit «Adresse», wenn der Anker der Punkt einer Adresswahl ist
  (dieser Sitzung oder gespeichert in `addressPointStore`, auch nach dem Neuladen; der Mittelpunkt von «Gebäude
  laden» wird nicht markiert, vorher hiess er «Importpunkt»; die Beschriftung steht links der Raute, wo sie unter die
  Zoom-Knöpfe oder über den Rand liefe), der bisherige Standort gestrichelt, auf Wunsch die Sonnenrichtung zur gewählten Zeit
  (`useSun`, nur Strahl und Beschriftung folgen der Zeit). Legende unter dem Plan.
- **Eigenes Gebäude im Plan** (`sitePlanOwnBuilding`, nie ein entferntes): das mit «Das ist mein Gebäude» oder
  «Eigenes Gebäude» gewählte, sonst der Teil, der den Punkt 0.5 m hinter dem Fassadenursprung enthält (wie
  `ownBuildingIds`), sonst das eigene Gebäude des Imports (`summary.ownId`), sonst der Teil mit dem Standort, sonst
  der nächste bis 25 m; gewählt und geraten werden nur importierte Gebäude (Teil 3). Fassaden =
  `facadeEdges` gegen die übrigen nicht entfernten Gebäude (ein entferntes Nachbarhaus macht die Brandmauer frei).
- **Fassade und Balkon** sind ein Entwurf, bis «Übernehmen» `location` (Balkonpunkt auf der Fassadenlinie, 1e-6°;
  Name, Zeitzone und Höhe bleiben) und `facadeAzimuth` (Aussennormale, ganze Grad, 360 → 0) schreibt: ein neuer
  Standort lädt Wetter, Gelände und Laserscan neu, das soll nicht bei jedem Zwischenschritt geschehen. «Verwerfen»;
  ein neuer Import verwirft den Entwurf (er gehört zu einer Gebäudeliste). Setzen: Tipp oder Klick auf eine wählbare
  Kante (die nächste innerhalb 22 px bei Touch, 12 px mit der Maus) setzt Fassade und Balkon an diese Stelle, der
  Balkon lässt sich entlang der Kante ziehen; Tastatur und Screenreader: Auswahl «Fassade mit dem Balkon» (Azimut,
  Richtung, Länge) und «Position entlang der Fassade» (m ab der linken Ecke von aussen gesehen, 0.1 m). Der Balkon
  bleibt mindestens 0.5 m von den Enden und an spitzen Ecken weiter (`probeAlongRange`, Teil 3), damit der
  Prüfpunkt hinter dem Ursprung im eigenen Grundriss liegt und Plan, Prismen
  und Laserscan dasselbe eigene Gebäude finden (Test). Ein Standort gilt als gesetzt, wenn er höchstens 0.25 m neben
  einer wählbaren Kante liegt und der Azimut höchstens 0.5° von ihrer Normale abweicht; nach dem Runden ist das immer
  erfüllt (Test: Abweichung unter 0.07 m). Sonst schlägt der Plan die Kante mit dem Azimut am nächsten beim
  eingestellten vor (5°-Stufen, dann die nähere, dann die längere), den Balkon auf der Projektion des Standorts
  (ausserhalb der mittleren 90 %: die Mitte). Eine Brandmauer antippen erklärt, warum sie nicht wählbar ist; liegt der
  Tipp mehr als 6 px neben ihr in einem anderen Gebäude, wählt er dieses (die Nachbarn eines schmalen Reihenhauses
  lagen sonst im 22-px-Bereich seiner Brandmauern).
- **Öffnen nach einem Import:** `requestSitePlan('address')` öffnet auch den Abschnitt «Gebäude»; der Lageplan holt
  die Anfrage beim Einhängen ab (`sitePlanOpen`, `sitePlanGuide` in `buildingImportStore`, nicht gespeichert), zeigt
  die Anleitung und springt ohne Animation an seinen Anfang (eine weiche Bewegung endete auf dem Handy rund 250 px zu
  früh, weil Ergebnisse darüber noch wachsen; nach dem Sprung hält die Scroll-Verankerung des Browsers ihn fest,
  ohne sie `holdInView`, siehe [Integration](#integration-adresse-laserscan-und-gebäude-zusammen)). Der Fokus geht
  an die Anleitung (`tabIndex={-1}`, Screenreader lesen sie), wenn er in der Suche, auf einem Knopf «Zum Lageplan»
  (Elemente mit `data-site-plan-source`) oder nirgends war; sonst meldet eine Live-Region «Lageplan geöffnet …» (wer
  gerade woanders tippt, verliert nichts). Nach «Gebäude laden» öffnet er sich nur, wenn der Standort noch auf keiner
  Fassade liegt, und erst wenn der Abschnitt aufgeht.
- **Touch, Maus, Tastatur:** `touch-action: pan-y`: senkrechtes Wischen scrollt die Seite; ein Tipp handelt erst mit
  dem `click`; seitwärts mehr als 8 px verschiebt den Plan; zwei Finger zoomen und verschieben. Der Balkon hat ein
  HTML-Ziel von 44 px (`data-handle-touch`), dessen `touch-action` der Fassade folgt: `pan-y` für eine Fassade, die
  auf dem Bildschirm eher waagrecht liegt, `pan-x` für eine eher senkrechte. So bleibt der Seite nur das Wischen quer
  zur Fassade, und mehr als 8 px entlang der Fassade ziehen den Balkon (vorher nur seitwärts: an einer senkrechten
  Fassade scrollte die Seite; gemessen am Handy mit echten Touch-Ereignissen, 62° ONO: 10.6 → 20.6 m, 0 px Bildlauf). Das Mausrad scrollt die Seite und zeigt den Hinweis «Zum Zoomen Strg (Mac: ⌘) …», Strg/⌘ + Rad (auch
  das Trackpad-Pinch) zoomt am Zeiger. Knöpfe Vergrössern, Verkleinern, Zentrieren (44 px auf Touch). Der Plan ist
  eine fokussierbare Gruppe mit Textbeschreibung: Pfeile verschieben, Plus/Minus zoomen, 0 zentriert. Breite der
  Ansicht 8–1500 m, anfangs 2.2 × das eigene Gebäude, mindestens 50 m.
- **Nachbar antippen:** Karte mit Name, Markierungen, Höhe, Basis, Abstand und Richtung vom Standort (wie die Liste:
  «11 m entfernt, W»; vorher vom gezeigten Balkon, vor «Übernehmen» also anders als in der Liste); «In der Liste
  bearbeiten» (`requestBuildingFocus`: öffnet «Horizont & Umgebung», die Liste an dieser Stelle, klappt das Gebäude
  auf und setzt den Fokus darauf; auch wenn der Abschnitt zu war und die Liste erst mit ihm einhängt, vorher galt die
  beim Einhängen wartende Anfrage als erledigt), «Das ist mein Gebäude», «Schliessen». Legende und Liste sagen
  «Umgebungsgebäude»; deren Umriss hat im hellen Design 4.1:1 gegen den Boden (vorher 2.9:1), im dunklen 4.6:1.
- **3D** (`views/scene3d/Buildings3D.tsx`, Geometrie `buildingsGeometry.ts`): alle nicht entfernten Gebäude ausser
  dem eigenen (`ownBuildingIds`) bis 1 km vom Fassadenursprung (keine eines anderen Orts, Teil 3) als Prismen relativ
  zum Fassadenursprung (Weltursprung der Szene), unabhängig vom
  Laserscan (Darstellung). Ein zusammengeführtes Dreiecksnetz mit flachen Normalen und Farbe je Ecke (swisstopo wie
  die Hindernisse, bearbeitete zur Warnfarbe, von Hand erfasste zur Ok-Farbe getönt, wie im Lageplan), Dächer per
  Earcut (`ShapeUtils`, konkave Grundrisse und Schlüssellochringe), Unterseite nur bei Basis über dem Boden, Umriss
  mit senkrechten Kanten nur ab 20° Knick. Wirft und empfängt Schatten; die Schattenkamera bekommt alle Dächer als
  Tiefe und passt sich zusätzlich an die Gebäude im Quadrat ±60 m an (darauf beschnitten; 60 m wie bei den
  Hindernissen). Zwei Index-Puffer über dieselben Ecken teilen das Netz in deckend und durchscheinend (0.22):
  Prismen, die eine der Panelreihen verdecken (Strecken Kamera → Enden und Mitte jeder Reihe gegen die Wände, nur
  nach einer Kamerabewegung ab 5 cm), werden durchscheinend, ausser in «Aus Sonnenrichtung»; ihr Schatten bleibt.
  Legendeneintrag «Umgebungsgebäude» (Ebene ein/aus). Gemessen (Node 22, Xeon 2.1 GHz, die 120 nächsten echten Teile,
  909–960 Ecken): Netz 2.9–3.5 ms, Sichttest 0.03–0.05 ms je Kamerabewegung.
- **Eigenes Gebäude in 3D:** Liegt der Standort auf der Wand des eigenen Grundrisses (höchstens 0.3 m und 3° daneben),
  ersetzt dieser Grundriss den schematischen Quader (`ownBody`: um den Ursprung auf die Fassadenlinie gedreht und
  geschoben, mindestens so hoch wie der Quader; Fenster über den ebenen Teil der Fassade um den Ursprung, im Raster
  der Balkontüren), sodass angrenzende Nachbarn anstossen statt hineinzuragen. Sonst (noch nicht bestätigt) bleibt der
  Quader. Rahmung, Kameravorlagen und Schattenpassung bleiben beim schematischen Gebäude. `ownBodyParts` teilt den
  Grundriss an der Fassadenlinie (`clipRingAbove` bei n = 0.05 m): Der Teil dahinter ist immer deckend, Flügel davor
  (die Fassade in der Innenecke eines L) werden wie die Nachbarn durchscheinend, solange sie eine Panelreihe vor der
  Kamera verdecken (`OwnWing` in `Building.tsx`, derselbe Sichttest, nicht in «Aus Sonnenrichtung»; ihr Schatten
  bleibt). Vorher zeigte die Standardkamera an der Breitenrainstrasse 10, Fassade 244° WSW, nur die Wand dieses
  Flügels (Review: 4 Farben im auf 64 × 48 verkleinerten Bild, nach dem Neuladen 2); jetzt 56 und 54 (Desktop), 73
  und 77 (Handy), die Panelreihen sind zu sehen. Ausserhalb des Bildschirms
  friert die Szene wie bisher ein (`useKeptWhileHidden`, die Prismen gehören zu `SceneData`).
- **Druckbericht** (`export/PrintReport.tsx`): Koordinaten mit 6 Nachkommastellen; mit importierten Gebäuden des Orts
  «Lage am Gebäude» (Balkon auf der Fassade …, im Lageplan gesetzt, Koordinaten auf 0.000001° (höchstens 0.07 m) /
  nicht im Lageplan bestätigt); Gruppe «Umgebung»: Umgebungsgebäude (Anzahl ohne entfernte; von Hand, bearbeitet,
  entfernt), Gebäude-Import (Stand, Umkreis), Laserscan (ein mit Bäumen oder nur Gebäude, Umkreis / aus), Datenquellen
  «© swisstopo». Angaben der Adresssuche (A) und des Laserscan-Status (B) ergänzt die Integration. Der Teilen-Link
  steht bis `PRINT_LINK_MAX` = 500 Zeichen ganz im Druck, länger (gespeicherte Gebäude: Breitenrain 11'244 Zeichen)
  nur mit den ersten 120 Zeichen und «…» und dem Hinweis, ihn in der App über «Teilen» zu kopieren (vorher füllte
  er über zwei A4-Seiten; PDF der Breitenrain jetzt 8 statt 10 Seiten).
- **Tests:** `sitePlanModel.test.ts` (eigenes Gebäude, Platzierung und Runden, Vorschlag, Raster, Ansicht),
  `SitePlan.test.tsx` (Öffnen nach dem Import, Tastatur, Klick, Brandmauer, Nachbar, «Das ist mein Gebäude», Touch:
  Bildlauf, seitliches Ziehen, zwei Finger, Maus-Verschieben, Zoom-Knöpfe, Strg + Rad, Englisch),
  `buildingsGeometry.test.ts` (Prismen, Einrasten auf die Fassade, Netz: Normalen, Umlaufsinn, Fläche konkaver Dächer;
  Sichttest, Schattenpunkte), `BuildingList.test.tsx` (Anfrage aus dem Plan), `PrintReport.test.tsx`,
  `e2e/buildings.spec.ts`: Import (mit der Adresssuche, sobald es sie gibt, sonst «Gebäude laden») → Lageplan mit
  Anleitung → Klick auf die Ostwand, Südwand per Auswahl und Regler → «Übernehmen» → Teilen-Link mit Standort und
  Azimut 180° → Liste → die Ebene «Umgebungsgebäude» ändert mehr als 2000 Pixel des 3D-Bilds; iPhone: Fassade
  antippen, 16-px-Auswahl, 44-px-Knöpfe, kein waagrechtes Scrollen. Beide Basis-Pfade.

### C, Gebäude: Durchsicht (Teil 3)

Befunde der Durchsicht von Teil 2, jeweils mit Test.

- **Gebäude eines anderen Orts:** Liegt der Standort über `OTHER_SITE_DISTANCE` = 2 km vom Anker (Koordinatenfelder,
  Ortsvorlage, Ortssuche oder ein gescheiterter Import, ohne neuen Import), sagen Liste und Lageplan, dass die
  gespeicherten Gebäude zu einem anderen Ort gehören (mit Abstand), der Lageplan zeigt statt der Karte «Gebäude um den
  Standort laden» (wartet eine Rückfrage, öffnet sich «Horizont & Umgebung»), der Druckbericht lässt «Lage am Gebäude»
  weg. Die 3D-Ansicht zeichnet dann keine Gebäude und sonst nur solche bis `SCENE_BUILDING_RANGE` = 1 km (Rechteck um
  den Grundriss): Ein Gebäude in Bern mit dem Standort in Zürich rückte das Licht als Schattenwerfer 95 km weg, die
  Panelreihen fielen aus dem Tiefenbereich der Schattenkamera (3000 m) und es gab keinen Schatten mehr (Test mit
  `fitShadowCamera`: ein Werfer 5 km zur Sonne hin lässt die Panelreihe hinter der fernen Ebene). Im Horizont zählen
  die Gebäude weiter (sie stehen in der Welt; ein 50 m hohes aus 95 km: 0.03°). Von Hand hinzufügen über 2 km vom
  Anker: `rectFootprint` gibt `null` statt eines auf ±2000 m geklemmten, zu einer Ecke zusammengefallenen Rings, die
  Eingabe meldet den Grund; ohne gespeicherte Gebäude wird der Standort zum Anker.
- **Eigenes Gebäude in den Prismen:** Statt es ganz wegzulassen, zählt vom eigenen Teil (`ownBuildingIds`) der Teil
  vor der Balkonzone, n > Balkontiefe + 0.5 m (`ownPrismPieces`, dieselbe Regel wie `isOwnBuildingCell` im Laserscan:
  die Zone reicht über den ganzen eigenen Grundriss entlang der Fassade). Ein Flügel desselben Teils vor der Fassade
  (Vektorkacheln liefern ein L gleicher Höhe als einen Teil) schattet so wie ein eigener Teil (Test: L als ein Teil =
  der Flügel ab der Balkonzone als Quader auf 1e-9°, 49.5° bei 45°, 57.3° bei 70°, wie zwei Teile). `clipRingAbove`
  schneidet an der Linie und liefert getrennte Stücke (Kreuzungen entlang der Linie gepaart), damit keine Wand über
  eine Lücke entsteht; Schlüssellochringe bleiben gültig (Tests: U, Hof, Brücke, 60 zufällige Sternpolygone gegen
  Fläche und 12'000 Punktproben). Nur solange der Standort höchstens 0.5 m neben dem Umriss liegt (im Lageplan
  gesetzt): Der Adresspunkt im Gebäude legte sonst die ganze Front in den Horizont; bis dahin zählt es wie bisher
  nicht. Die 3D-Ansicht zeichnet den ganzen eigenen Grundriss, jetzt im Einklang mit dem Modell. Die Rechenregeln
  oben beschreiben das so (bei der Integration nachgeführt, dazu die Fassade, die ins Gebäude zeigt).
- **Eigenes Gebäude per Tastatur:** Auswahl «Eigenes Gebäude» im Lageplan (`ownBuildingChoices`): importierte, nicht
  entfernte Teile bis 25 m vom Standort oder angrenzend an das eigene, nach Abstand, höchstens 20 (das eigene immer),
  beschriftet «Gebäude k · 12 m NO» bzw. «am Standort»; die Wahl ist ein Entwurf wie «Das ist mein Gebäude», die
  automatische Wahl setzt ihn zurück. Die Fassaden des gewählten Teils erscheinen in «Fassade mit dem Balkon».
- **Von Hand erfasste Gebäude** sind nie das geratene oder gewählte eigene Gebäude (der Standardquader steht 20 m vor
  der Fassade: er wurde als «nächstes bis 25 m» zum eigenen, «Übernehmen» hätte den Standort 30 m versetzt); nur wenn
  der Prüfpunkt darin liegt, wie bei `ownBuildingIds`. Nur von Hand erfasste Gebäude: neutraler Hinweis statt der
  Aufforderung, den Balkon zu setzen, kein «Übernehmen», keine «Lage am Gebäude» im Druck.
- **Spitze Ecken:** `ownFacadeEdges` gibt jeder wählbaren Kante den Bereich (`probeAlongRange`), in dem der Prüfpunkt
  0.5 m hinter dem Balkon mit 0.1 m Abstand zum Umriss im eigenen Grundriss liegt (Runden auf 1e-6° ≤ 0.07 m): von
  den 0.5 m aus in 0.1-m-Schritten verkleinert, bei 21.8° 1.6 m statt 0.5 m (vorher fand `ownBuildingIds` dort
  nichts); ohne gültige Stelle die Mitte.
- **Rückfrage nach einer Adresswahl:** Wartet der Import auf «Neu laden» / «Behalten», ist der Laserscan schon ein
  (wie bei einem Fehler); «Behalten» lässt ihn an.
- **Teilen-Link:** importierte Gebäude zuerst, die von Hand erfassten danach; Löschen eines von Hand erfassten
  verschiebt keine importierte id mehr (2 von Hand und 100 importierte, das erste von Hand gelöscht: vorher 6'046 →
  8'112 Zeichen, jetzt → 5'987).
- **Import im Worker** (`hooks/buildingImportClient.ts`, `buildingImport.worker.ts`, Handler
  `buildingImportWorkerHandler.ts`; Job `model/buildingImportJob.ts`, Ausdünnen `model/buildingImport.ts`): Kacheln
  laden und dekodieren, Teile zusammensetzen, Kandidaten, eigenes Gebäude, Ausdünnen und Obergrenzen laufen in einem
  eigenen Modul-Worker (Abbrechen per Nachricht, alle 30 ms eine Pause für sie); der Hauptthread rechnet nur noch die
  von Hand erfassten Gebäude um, kürzt die Liste, falls während des Ladens welche dazukamen, und schreibt die Config.
  Ohne Worker (jsdom, alte Browser, ein Worker, der nicht startet) oder mit eingespeister Quelle (Tests) läuft der Job
  hier, sein Modul wird erst dann geladen. `page.route` erfasst auch die Anfragen des Workers (E2E, und beim Test mit
  echten Daten). Gemessen (Chromium, Produktions-Build, Kramgasse 49, 4-fach gedrosselte CPU, vom Klick bis zum
  Ergebnis, je drei Läufe): lange Aufgaben vorher 5–6 mit zusammen 876–970 ms (im Profil rund 750 ms Dekodieren,
  Zusammensetzen und Auswahl), jetzt 2 mit 458–533 ms: das Neurechnen nach den neuen Horizonten (Jahresrechnung,
  Prismen, 3D-Netz, WebGL-Programme), Import-Code kommt im Profil nicht mehr vor.
- **Laden:** Die Gebäudeliste (`BuildingList.tsx` lädt `BuildingListPanel.tsx` beim ersten Öffnen von «Horizont &
  Umgebung») und der Lageplan (sobald Gebäude gespeichert sind) sind eigene Chunks, ebenso der Job; die Quellenangabe
  kommt aus `buildings.ts` (`SWISSTOPO_CREDIT`, gleich `SWISSTOPO_ATTRIBUTION`, Test), damit `buildingSources.ts`
  nicht im Haupt-Chunk landet. Anfangs geladenes JavaScript (Haupt-Chunk und seine statischen Chunks): Fundament
  b8504c9 616.0 kB (206.7 kB gzip), Teil 2 702.5 kB (236.9 kB), jetzt 641.5 kB (218.6 kB); CSS 75.8 / 87.1 / 75.8 kB.
  Precache 1'863 KiB (Teil 2: 1'814 KiB; der Job liegt im Worker und als Chunk für den Ausweichweg).
- **Tests:** `buildings.test.ts` (`clipRingAbove`, `rectFootprint` null, `SWISSTOPO_CREDIT`),
  `buildingHorizon.test.ts` (L-Flügel, Adresspunkt im Gebäude), `buildingImportJob.test.ts`,
  `buildingImportClient.test.ts` (Worker mit dem echten Handler: Fortschritt, Abbrechen, Ausweichen),
  `sitePlanModel.test.ts` (nur importierte, Auswahl, spitze Ecke, Splitter), `SitePlan.test.tsx` (Tastatur, nur von
  Hand, anderer Ort, Laden des Chunks), `BuildingList.test.tsx` (anderer Ort, Anker verlegt),
  `buildingsGeometry.test.ts` (Reichweite, Schattenkamera, anderer Ort), `PrintReport.test.tsx`,
  `useBuildingImport.test.tsx` (Reihenfolge und Link-Länge, Laserscan bei «Behalten»); `e2e/buildings.spec.ts`:
  «Eigenes Gebäude», anderer Ort (Hinweise, keine Gebäude in 3D, Meldung beim Hinzufügen).

### Integration: Adresse, Laserscan und Gebäude zusammen

Zusammengeführt auf `claude/project-overhaul-improvements-esrgrp` (A 05243fd, B 5110c44, C 50f33c1), geprüft mit
echten Daten (Kramgasse 49 und Breitenrainstrasse 10, Bern; Chromium, Desktop 1280 × 900 und Handy 390 × 844, hinter
dem Proxy der Sandbox mit etwa 1 Mbit/s je Verbindung): Suche → Adresse → Gebäude-Import → Lageplan → Fassade und
Balkon → Laserscan → Horizont-Diagramm → Jahreswerte → 3D → Druckbericht → Teilen-Link in einem neuen Browser
(Standort auf 1e-6°, Fassade, 119/120 Gebäude, Anker und Laserscan-Einstellungen gleich).

- **Reihenfolge nach einer Adresswahl:** Standort = Adresspunkt, Laserscan ein, Import angefragt (gleichzeitig);
  Gebäudeangaben und Höhe (A); nach 7–15 s die Gebäude (Kramgasse 120 von 1'513 Teilen, Breitenrain 119 von 536)
  und der Lageplan; Wetter und Gelände des Adresspunkts. **Vorher** lud der Laserscan nach dem Wetter für den
  Adresspunkt, der im eigenen Gebäude liegt: Mit 30 s im Lageplan war er vor «Übernehmen» fertig (Breitenrain,
  5.00 MB), sein Horizont war das eigene Gebäude (88.7° über die ganze Breite im Horizont-Diagramm) und die
  Jahreswerte galten als endgültig. Doppelt geladen wurde nicht: Nach «Übernehmen» (Standort 16 m weiter) kamen
  die Kacheln aus dem Speicher des Workers (0 B Laserscan, nur STAC 9 kB und die Höhe); bei schnellem «Übernehmen»
  (5 s, Kramgasse) 0.59 MB vorher und 4.30 MB nachher, zusammen so viel wie ein Laden (4.89 MB). **Jetzt** wartet der
  Laserscan, solange der Standort im eigenen Gebäude liegt (Rechenregeln: `locationInsideOwnBuilding`, Status
  `'waiting'`, Hinweis in den Laserscan-Einstellungen), und ein Download wartet, solange ein Gebäude-Import
  angefragt ist oder läuft (`buildingImportSettled` in `surfaceModelLoader.ts`, nach `terrainDownloadGate`: sind
  Wetter und Gelände schneller da als die Gebäude, begänne er sonst für den Adresspunkt). Gemessen: 0 Anfragen an `data.geo.admin.ch` vor «Übernehmen» (30 s
  bzw. 5 s im Lageplan), danach ein Laden (Breitenrain 15 Anfragen an die Dateien, 5.00 MB; Kramgasse 11, 4.89 MB),
  fertig 25–47 s nach «Übernehmen». Das Gelände lädt für den Adresspunkt und bleibt danach gültig (Breitenrain nach 30 s:
  0 B neu; bei schnellem «Übernehmen» werden abgebrochene Kacheln neu geholt).
- **Horizont-Diagramm:** vor dem Laserscan «Gelände» und «Gebäude» (Prismen aller Gebäude; vom eigenen nur der Teil
  vor der Balkonzone, vor «Übernehmen» nichts), danach
  «Gelände» und «Laserscan»; importierte Gebäude stecken dann im Laserscan (Rechenregeln), «Gebäude» erscheint nur
  für bearbeitete und von Hand erfasste: mit einem Gebäude von Hand Kramgasse 3.2° / 44.7° / 25.4°, Breitenrain
  3.5° / 60.4° / 25.4° (Gelände / Laserscan / Gebäude, Höchstwerte vor der Fassade vom 1. OG, Laserscan Version 2).
  Die 60.4° der Breitenrain kamen aus Zellen der eigenen Traufe bei streifendem Blick (Version 3, siehe B
  «Strahlengang»: 53.8° bei 183°, im Browser auf Desktop und Handy gemessen; Kramgasse 44.9°).
- **Lageplan nach dem Sprung** (E2E «site plan on an iPhone», unter `BASE_PATH` 1 von 16 bis 3 von 24 Läufen rot):
  Der Tipp auf die Nordkante traf den Rand des Lageplans. Ursache: Die Karte «Neigungsvergleich» (weiter oben)
  zeigte für den neuen Standort 60–240 ms ihren Platzhalter (548 → 317 → 548 px); die Scroll-Verankerung von
  Chromium folgte dem Schrumpfen (−231 px), dem Wachsen nicht, und der Lageplan stand 0.3–0.5 s nach dem Sprung
  232 px tiefer. `TiltSweepChart` hält jetzt die Höhe der Karte (`min-height` vor dem Zeichnen), bis das Ergebnis des
  neuen Standorts da ist; danach blieb die Kante in 8 von 8 Läufen 4 s lang bei 291–292 px (die Warnungen und
  Hinweise «vorläufig» darüber, +104, +67, +104 px, fängt die Verankerung ab) und der Test lief 40 von 40 Mal durch.
  Browser ohne Scroll-Verankerung (`CSS.supports('overflow-anchor', 'auto')` falsch) halten den Lageplan mit
  `siteplan/holdInView.ts` bis zur ersten Eingabe (Rad, Berührung, Zeiger, Taste), einem fremden Bildlauf oder
  10 s.
- **E2E «site plan: facade and balcony …»:** Seit A gemergt ist, geht der Test über die Adresse (Standort = Adresspunkt
  statt Standardstandort); das Haus gegenüber lag 26 m davon, die Auswahl «Eigenes Gebäude» zeigt Teile bis 25 m. Die
  25-m-Regel und die Abstände (vom Standort, vor «Übernehmen» also vom Adresspunkt) stimmen; der synthetische
  Adresspunkt liegt jetzt 2 m statt 6 m hinter der Südwand (ein Eingang), das Haus gegenüber 22 m entfernt. Der Test
  prüft ausserdem: keine Anfrage an `data.geo.admin.ch` vor «Übernehmen», danach STAC.
- **Druckbericht:** Standort mit «Gebäude an der Adresse» (EGID, Geschosse, Baujahr oder Bauperiode, Grundfläche;
  nur solange der Standort die gewählte Adresse ist, `useAddressBuildingSummary`), Umgebung mit «Laserscan-Stand»
  (geladen mit Datenstand und Abdeckung unter 100 %, wird geladen, wartet auf den Lageplan, Fehler oder nicht
  verfügbar, jeweils womit gerechnet wurde). Quellenangabe einmal «© swisstopo» (Zeile «Datenquellen»), auch wenn
  nur die Adresse von swisstopo stammt; der Footer nennt swisstopo in einer Zeile seiner Quellenliste.
- **Laden:** Adresssuche (`geocode.ts` mit `fetchRetry.ts`, über `geocodeLazy.ts` bei der ersten Suche, Adresswahl
  oder «Nächste Adresse übernehmen»), Laserscan-Einstellungen (mit «Horizont & Umgebung»), Laserscan-Lader
  (`hooks/surfaceModelLoader.ts`, sobald der Laserscan in der Sitzung ein ist; er bleibt danach eingehängt und setzt
  den Zustand beim Ausschalten zurück) und Gebäude-Import (`useBuildingImport.ts`, mit der ersten Anfrage der
  Adresssuche; bis dahin bleibt sie in `uiStore`) sind eigene Chunks. Anfangs geladenes JavaScript (Einstieg und
  `modulepreload`, je Datei gzip -9): main 030c38d 606.4 kB (201.2 kB gzip), Merge 50f33c1 684.1 kB (231.4 kB,
  +15.0 %), jetzt 655.4 kB (222.9 kB, +10.8 %; als eine Datei gepackt 219.7 kB, +9.2 %: die gemeinsamen Module
  liegen jetzt in 10 statt 1 Datei). CSS 75.7 / 79.0 / 77.8 kB. Precache 1'700 / 1'970 / 1'981 KiB.

### Integration: Durchsicht

Befunde der Durchsicht nach der Integration (Rechnung, Bedienung, Robustheit), jeweils mit Test; geprüft mit echten
Daten (Breitenrainstrasse 10, Desktop 1280 × 900 und Handy 390 × 844).

- **Laserscan, Strahlengang und eigener Bereich:** siehe B «Strahlengang» (Version 3: Zelldurchgänge statt
  0.25-m-Schritte, der eigene Bereich an der gelesenen Zelle).
- **Adresspunkt ohne Gebäude:** Scheiterte der Import nach einer Adresswahl (Netz, «Abbrechen», Neuladen oder
  Schliessen während des Imports), galt der Adresspunkt nicht als «im Gebäude» (`locationInsideOwnBuilding` braucht
  gespeicherte Gebäude): Der Laserscan lud 5 MB für den Adresspunkt, sein Horizont war das eigene Gebäude (88.7°) und
  die Jahreswerte galten als endgültig. Jetzt merkt `state/addressPointStore.ts` den Punkt (localStorage
  `ssa.addressPoint`, nicht in Config und Teilen-Link), solange der Standort genau dieser Punkt ist; jeder andere
  Standort (Lageplan, Koordinaten, Suche, Vorlage, Teilen-Link) löscht ihn. Solange wartet der Laserscan
  (`surfacePlan.waiting`). War der Import beim Neuladen noch nicht fertig (`importPending`), fragt `<DataLoader/>` ihn
  erneut an (`resumeAddressImport`); nach einem Fehler oder «Abbrechen» nicht (erst «Erneut versuchen» bzw. «Gebäude
  laden»). Gemessen (Vektorkacheln im Browser abgebrochen): nach dem Import-Fehler Laserscan `'waiting'`, 0 Anfragen an
  den Laserscan, auch nach dem Neuladen; «Erneut versuchen» mit freigegebenen Kacheln lädt 119 Gebäude und öffnet
  den Lageplan. Neuladen 1.5 s nach der Wahl: der Import läuft nach dem Neuladen wieder, danach Lageplan, 0 Anfragen
  an den Laserscan. Grenze: Ein Teilen-Link aus diesem Zustand enthält den Punkt nicht (der Empfänger rechnet am
  Adresspunkt, falls auch sein Import scheitert).
- **Wo der Nutzer ist** (`controls/location/PlacementPrompt.tsx`, `placementNeed.ts`): unter der Suche der Import
  («Gebäude der Umgebung werden geladen … Danach öffnet sich der Lageplan …», höflich angesagt), danach «Standort noch
  nicht bestätigt …» mit «Zum Lageplan», oder der Fehler (`role="alert"`, «Erneut versuchen», Hinweis auf die
  Koordinaten); dieselbe Aktion im Laserscan-Status und neben den Jahreswerten, die solange vorläufig sind
  («vorläufig – Standort noch nicht im Lageplan bestätigt», gedämpft wie beim Gelände). Vorher standen Fortschritt
  und Fehler nur im geschlossenen «Horizont & Umgebung» (nicht im DOM), und die Jahreswerte vor «Übernehmen» (Review:
  Kramgasse 82 kWh, Amortisation 126 Jahre) sahen endgültig aus. Öffnet sich der Lageplan nach der Wahl, geht der
  Fokus an seine Anleitung (siehe C Teil 2; vorher blieb er in der weggescrollten Suche). Eine Wahl per Touch nimmt
  der Suche den Fokus (die Bildschirmtastatur bliebe sonst über dem Lageplan offen).
- **Einstieg:** Der Standort in der Kopfzeile ist ein Knopf («47.100° N, 7.450° O: Adresse oder Ort suchen»; der Name beginnt mit dem sichtbaren Text), der «Standort»
  öffnet und die Suche fokussiert (`app/openLocationSearch.ts`); auf dem Handy lag die Suche (Review) bei y = 6'999 px in einem
  zugeklappten Abschnitt.
- **Veraltetes Import-Ergebnis:** Wartete eine Adresswahl in der Nähe bearbeiteter Gebäude auf «Neu laden» /
  «Behalten», lief ein Import einer früheren Wahl weiter und ersetzte bei seinem Ende Gebäude und Anker durch die
  eines anderen Orts (Review im Browser: Anker 1'215 m vom Standort, 0 bearbeitete). Jetzt bricht diese Rückfrage
  einen laufenden Import ab (Test).
- **Fokus nach «Erneut versuchen» und «Abbrechen»:** Laserscan-Status und Gebäude-Import sind fokussierbare Gruppen
  (`tabIndex={-1}`), die den Fokus übernehmen, wenn ihr Knopf mit seinem Block verschwindet (vorher `<body>`).
- **Texte:** ein Begriff «Gebäude mit flachem Dach» (statt «Körper» / «Prismen»); das eigene Gebäude «als Hindernis
  zählen nur Teile vor dem Balkon»; «Die bisherigen bleiben» nur, wenn Gebäude gespeichert sind.
- **Laserscan-Cache:** begrenzt (siehe B «Loader», `SURFACE_CACHE_EXTRA_OBSERVERS`).
- **Geländehorizont:** Terrarium-Boden am Standort gemessen und dokumentiert (Konventionen), nicht geändert.
- **Tests:** `dsm.test.ts` (Zellmitte im eigenen Bereich, 2-mm-Marsch, Brute Force), `useSurfaceModel.test.tsx`
  (Adresspunkt ohne Gebäude, Grenze des Cache-Eintrags, Lesen ohne Schreiben), `addressPointStore.test.ts`,
  `useBuildingImport.test.tsx` (veraltetes Ergebnis), `BuildingList.test.tsx` (Anfrage beim Einhängen, Fokus nach
  «Erneut versuchen»), `SitePlan.test.tsx` (Fokus nach dem Sprung, senkrechte Fassade per Touch, Brandmauer und
  Nachbar), `sceneLayout.test.ts` (L-Flügel verdeckt die Panels vor der Standardkamera), `SurfaceModelControls`,
  `KpiBar`, `LocationSection`, `Header`, `PrintReport` (Link); `e2e/buildings.spec.ts`: eigenes Gebäude als L mit
  der Fassade in der Innenecke, Standardkamera (Farben im auf 64 × 64 verkleinerten Bild: 326 mit durchscheinendem
  Flügel, 77 mit deckendem; Schwelle 200).
- **Laden:** Anfangs geladenes JavaScript (Einstieg und `modulepreload`, je Datei mit Pythons gzip 9 gemessen)
  663.0 kB (225.3 kB gzip) gegen 655.4 kB (222.4 kB) davor: Adresspunkt und Hinweise liegen im Einstieg und ziehen
  den Zustand des Gebäude-Imports, den Spinner und die Symbole aus nachgeladenen Chunks nach.

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
- **Lageplan** (`SitePlanMap`): seitwärts verschieben, zwei Finger zoomen; der Balkon lässt der Seite nur das Wischen
  quer zu seiner Fassade (siehe [C, Teil 2](#c-gebäude-lageplan-3d-ansicht-und-druck-teil-2)).
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
  vorläufigen Zwischenstand vom Platzhalter zum Ergebnis. Wartet der Laserscan auf den Standort (Adresspunkt im
  Gebäude, Status `'waiting'`), sind die Jahreskennzahlen ebenfalls vorläufig, mit «Standort noch nicht im Lageplan
  bestätigt» und der Aktion dazu (siehe [Integration: Durchsicht](#integration-durchsicht)).
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
- **Umgebung (Adresse, Laserscan, Gebäude):** Die Adresssuche lädt `geocode.ts` bei der ersten Suche, der
  Gebäude-Import (Hook, Worker, Job) und der Laserscan-Lader laden erst, wenn sie gebraucht werden, Liste,
  Lageplan und Laserscan-Einstellungen mit ihrem Abschnitt; Rechnungen und Downloads laufen in Web Workern (Zahlen:
  [Integration](#integration-adresse-laserscan-und-gebäude-zusammen)).
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
  - Precache des ganzen Builds (`js, css, html, svg, png` + Manifest), auch des lazy geladenen 3D-Chunks (~970 kB),
    des Gelände-Workers (~76 kB, mit dem Laserscan), des Import-Workers (~36 kB) und der Chunks der Umgebung.
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
  jede Anfrage sieht. `address.spec.ts`, `surface.spec.ts` und `buildings.spec.ts` beantworten geo.admin.ch mit
  aufgezeichneten bzw. synthetischen Antworten (Adresssuche, Laserscan-COGs, Vektorkacheln); siehe die Abschnitte A,
  B und C unter [Umgebung](#umgebung-adresse-laserscan-gebäude). Mit `BASE_PATH` laufen Build, `vite preview` und `baseURL` unter dem Pfad (die Specs navigieren
  relativ mit `page.goto('./')`).
- **CI** (`.github/workflows/ci.yml`, Node aus `.nvmrc`): Lint, `format:check`, Typecheck, Tests und Build; danach
  E2E mit dem von Playwright installierten Chromium, als Matrix unter `/` und unter `/solar-shadow-analyzer/`
  (`BASE_PATH`, Ergebnisse bei Fehlern als `playwright-results-<Index>`). Checkouts ohne gespeicherte Zugangsdaten
  (`persist-credentials: false`). Ein Erfolg für einen Push auf `main` löst das Deployment aus.
