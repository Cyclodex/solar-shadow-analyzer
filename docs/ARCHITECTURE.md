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
- vite-plugin-pwa (Workbox): Web-App-Manifest und Service Worker, siehe [PWA und Deployment](#pwa-und-deployment)
- Styling: CSS-Variablen (`src/styles/global.css`) + CSS Modules pro Komponente (`*.module.css`), keine Inline-Style-Monolithen
- Alle 2D-Visualisierungen als SVG (Heatmap als `<canvas>`), keine Chart-Library

## Verzeichnisstruktur

```
src/
  main.tsx                 Einstieg: initUrlSync() und initInstallPrompt() vor dem ersten Render, dann <App/>
  App.tsx                  Layout: Header, Sidebar, KPI-Leiste, Ansichten, Analyse, Footer, PwaToast
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
    storageCache.ts        localStorage-LRU-Cache der Wetter- und Geländeergebnisse (fängt fehlendes, gesperrtes oder
                           volles localStorage ab)
    presets.ts             Standort- (24) und Modul-Presets (5), Ortssuche (Open-Meteo Geocoding)
    share.ts               Config ⇄ URL-Hash (Base64url) und JSON, Validierung (sanitizeConfig), Migration v1 → v2
  app/                     App-Shell: Header, WarningsBar, KpiBar, ViewToggles, ShareButton, ExportMenu, Footer,
                           DataLoader (startet die Loader), useDocumentSettings (<html> data-theme/lang, Titel,
                           theme-color)
  components/              Generische UI-Bausteine: Button, InfoTip, NumberField (+ numberInput.ts),
                           Placeholder, Section, Segmented, SelectField, Skeleton, Slider, Spinner, TextField,
                           Toggle, ViewCard, icons, cssVars, usePopover (Popover im Viewport halten, Schliessen bei
                           Klick ausserhalb)
    svg/                   SVG-Helfer für Diagramme und 2D-Ansichten: useElementWidth, useSvgId, paths, text
                           (Textbreiten, Fliesslayout), legend (gemeinsamer Legendenstil), HatchPattern
  controls/                Eingaben (Sidebar): Sidebar, TimeControls, TiltControl und je Einstellungsgruppe eine
                           *Section.tsx (Location, Building, Panel, System, Horizon, Weather, Economics);
                           sections.module.css (gemeinsames Layout der Abschnitte), icons (gemeinsame Icons der
                           Eingaben), loadError.ts + LoadErrorDetails (übersetzte Ursache eines Ladefehlers,
                           technische Meldung aufklappbar)
    location/              PlaceSearch, PresetSelect, MyLocationButton, CompassDial, TimeZoneField, timeZones
    horizon/               TerrainStatus, ObstacleList/ObstacleItem, ManualHorizon (inkl. PVGIS-Dateiimport),
                           HorizonSparkline, horizonData
  views/                   2D-Ansichten: FrontalView, ProfileView (Seite), SunPathView, PanelShadowView
    svg/                   Reine Layout-Module ohne React (frontalLayout, profileLayout, sunPathLayout,
                           panelShadowLayout, geometry2d, legend, constants) + SvgFigure, Legend, ViewNotice,
                           primitives, messages, svg.module.css
    scene3d/               3D-Ansicht (three.js/R3F), lazy: index.ts → Scene3D → SceneView; SceneStage, SceneContent,
                           Building, PanelRows, Ground, Surroundings, SkyAndLights, SunMarker, CameraRig, Label,
                           SceneErrorBoundary, useSceneData; coords.ts, sceneLayout, palette, shadeMaterial
                           (Modellschatten-Overlay), textures, webgl, messages, captureRender (Bild für PNG-Export
                           und Druck sofort und in höherer Auflösung rendern)
  charts/                  Analyse: DailyProfileChart, ShadeHeatmap (Canvas), MonthlyYieldChart, TiltSweepChart,
                           EconomicsCard, MonthlyTable
    lib/                   Chart-Bausteine ohne Library: scale, Axes, timeAxis, legend/ChartLegend, ChartTooltip,
                           ChartStats, DataTable (+ ColumnHeader), heatmap, monthlyTable, colors, canvasTheme,
                           floors, focus, sourceLabel, usePlotPointer, PlotSlider (Tastatur-/Zeiger-Ebene mit
                           Fadenkreuz), sliderKeys, shadingTotals (Verschattungsverlust für KPI, Monatsertrag und
                           Monatstabelle)
  export/                  png, csv (RFC 4180), resultsCsv (Monatsertrag, Neigungsvergleich, Heatmap), configFile
                           (JSON speichern/laden), clipboard, download, filenames, Druckbericht (print.ts, print.css,
                           PrintReport.tsx, PrintRoot.tsx), canvasRender (Canvas vor PNG-Export/Druck synchron neu
                           zeichnen)
  hooks/                   useModel (memoisierte Modell-Hooks) + cache.ts, useTerrain/useWeather (je Loader + Leser),
                           useAnimation, useMediaQuery (Layout-Umbruch bei 1100 px)
  state/                   configStore, timeStore, uiStore, dataStore, shareLinkStore (Hinweise zum Teilen-Link),
                           urlSync (#c=-Hash), storage (Persistenz der Stores, fängt localStorage-Fehler ab)
  pwa/                     install.ts (beforeinstallprompt/appinstalled → useInstallStore, promptInstall, isIos,
                           Standalone-Erkennung), InstallButton (Header), PwaToast (Service-Worker-Registrierung,
                           Hinweise «Neue Version verfügbar» / «Offline verfügbar»), updates.ts (stündliche
                           Update-Prüfung, reloadPage)
  i18n/                    index.ts (useLang, useMessages, useFormat, floorLabel, compassPoint …), common.ts
  styles/                  global.css: Design-Tokens (CSS-Variablen) für Dark/Light, globale Styles; tokens.ts:
                           Token-Zugriff aus TypeScript (Stockwerksfarben, useThemeKey, cssVar, parseCssColor)
  test/                    utils.ts: resetStores(), TEST_DATE; svg.ts: Helfer für die Tests der SVG-Ansichten;
                           pwaRegister.ts: Ersatz für virtual:pwa-register/react in den UI-Tests

public/                    favicon.svg und die daraus erzeugten App-Icons (pwa-192x192, pwa-512x512,
                           pwa-maskable-512x512, apple-touch-icon)
e2e/                       Playwright-Specs (smoke.spec.ts, features.spec.ts, pwa.spec.ts)
scripts/validate-terrain.ts  Gelände-Horizont gegen PVGIS printhorizon prüfen (braucht Netzwerk)
scripts/validate-yield.ts    Jahresertrag gegen PVGIS seriescalc/PVcalc prüfen (braucht Netzwerk)
scripts/generate-icons.ts    App-Icons aus public/favicon.svg rendern (Playwright-Chromium, `npm run icons`)
scripts/basePath.ts          BASE_PATH → Vite-`base` (für vite.config.ts und playwright.config.ts)
.github/workflows/ci.yml     CI: Lint, Format, Typecheck, Tests, Build; danach E2E
.github/workflows/pages.yml  Deployment auf GitHub Pages (Push auf main, manuell)
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

## i18n

Jede Komponente definiert ihre Texte lokal:

```ts
const messages = { de: { title: 'Heatmap' }, en: { title: 'Heatmap' } };
const t = useMessages(messages);
```

Gemeinsame Texte liegen in `i18n/common.ts`. Zahlen/Daten werden über `useFormat()` (Intl, Locale `de-CH`/`en-GB`) formatiert.

## PWA und Deployment

- **Basis-Pfad:** `vite.config.ts` setzt `base` aus der Umgebungsvariable `BASE_PATH` (Standard `/`, normalisiert in
  `scripts/basePath.ts`). GitHub Pages dient die App als Projektseite unter `/solar-shadow-analyzer/` aus
  (`.github/workflows/pages.yml` baut mit `BASE_PATH=/solar-shadow-analyzer/`). Laufzeit-URLs hängen nicht vom Pfad ab:
  `index.html` verweist auf `/favicon.svg` usw., Vite setzt beim Build den Basis-Pfad davor; das Manifest nutzt
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
  `env(safe-area-inset-*)`; Header, Seitenraster, Sticky-Sidebar, Skip-Link und die Hinweise halten diese Abstände
  ein. Unter der transparenten Statusleiste (immer weisse Symbole) liegt ein fixer Streifen in `--statusbar`, auch im
  hellen Theme.
- **Service Worker** (Workbox `generateSW`, nur im Produktions-Build; in Entwicklung und Tests aus):
  - Precache des ganzen Builds (`js, css, html, svg, png` + Manifest), auch des lazy geladenen 3D-Chunks (~960 kB).
    Ein Asset über `maximumFileSizeToCacheInBytes` (Standard 2 MiB) bricht den Build ab, statt offline zu fehlen.
  - Navigationen fallen auf `index.html` zurück (`navigateFallback`), alte Precaches werden aufgeräumt
    (`cleanupOutdatedCaches`). Kein Runtime-Caching: Wetter- und Geländedaten cacht die App selbst im `localStorage`.
  - `registerType: 'prompt'`: Ein Update aktiviert sich nie selbst (es würde die Lazy-Chunks einer offenen Seite
    löschen). `PwaToast` registriert den Worker über `useRegisterSW` (`virtual:pwa-register/react`), meldet
    «Neue Version verfügbar» (Live-Region) mit «Neu laden» (`updateServiceWorker` → `SKIP_WAITING`, dann Reload;
    nach `RELOAD_FALLBACK_MS` lädt die Seite sicherheitshalber selbst neu, falls der alte Worker sie nicht
    kontrollierte) und «Später» (das Update übernimmt, wenn alle Fenster der App geschlossen sind). Nach dem ersten
    Besuch kurz «Offline verfügbar». Update-Prüfung stündlich und beim Zurückkehren in den Vordergrund nach
    mindestens einer Stunde (`scheduleUpdateChecks`).
- **Veraltete Chunks:** Ohne kontrollierenden Service Worker (gesperrt, privates Fenster, Daten vom Browser
  gelöscht) fordert eine vor einem Deployment geladene Seite beim Einblenden der 3D-Ansicht Chunks an, die es nicht
  mehr gibt. Vite meldet das als `vite:preloadError`; `initStaleChunkReload()` (`pwa/staleChunks.ts`, vor dem
  ersten Render) lädt die Seite dann einmal neu: nicht offline und nicht erneut innerhalb von 60 s (Zeitpunkt im
  sessionStorage unter `ssa.chunkReload`). Bis dahin, oder wenn das Neuladen nicht hilft, ersetzt eine
  Fehlergrenze (`SceneErrorBoundary` in `App.tsx`) nur die 3D-Ansicht durch einen Hinweis mit «Neu laden».
- **Installieren:** `initInstallPrompt()` (vor dem ersten Render) hält `beforeinstallprompt` fest (ohne Chromes
  Mini-Infoleiste) und merkt sich `appinstalled`. `InstallButton` im Header: mit Event öffnet es den Installdialog
  (`prompt()`, das Event ist danach verbraucht), auf iOS/iPadOS (User-Agent, iPadOS über Touchpunkte) ein Popover
  mit den Schritten «Teilen → Zum Home-Bildschirm → Hinzufügen» (`usePopover`-Helfer, Escape und Klick ausserhalb
  schliessen). Ausgeblendet als installierte App (`display-mode: standalone`, `navigator.standalone`) und in
  Browsern ohne Installationsweg (z. B. Firefox, Safari auf dem Mac).
- **Deployment:** `.github/workflows/pages.yml` (Push auf `main` und manuell): Build-Job (Node aus `.nvmrc`,
  `npm ci`, Build mit `BASE_PATH`, `configure-pages`, `upload-pages-artifact` mit `dist`) und Deploy-Job
  (`deploy-pages`, Environment `github-pages`); Concurrency-Gruppe `pages` ohne Abbruch laufender Deployments.
  Voraussetzung: Settings → Pages → Source «GitHub Actions».

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
- **E2E** (`npm run e2e`, Playwright gegen den `vite preview`-Build, Chromium + SwiftShader, Open-Meteo und Kacheln
  blockiert, Port über `E2E_PORT`): App lädt mit Jahresertrag; kein horizontales Scrollen bei 360 px; 3D-Canvas zeichnet
  Inhalt (mehr als 20 Farben, kein Screenshot-Vergleich); Kamera-Preset «Aus Sonnenrichtung» bleibt nach einem Klick
  erhalten, folgt der Uhrzeit und weicht nachts der Übersicht; Teilen-Link stellt die Konfiguration wieder her;
  Sprachumschaltung DE → EN. `pwa.spec.ts`: Manifest gültig und unter dem Basis-Pfad, Icons ladbar (Grösse,
  `maskable`/`apple-touch-icon` deckend); Service Worker registriert sich, kontrolliert die Seite nach einem Reload
  und hat den 3D-Chunk im Precache; offline (`context.setOffline`) lädt die App mit Clear-Sky-Ergebnissen und
  3D-Ansicht, ohne Konsolenfehler. Nur dort laufen Service Worker; die übrigen Specs blockieren sie
  (`serviceWorkers: 'block'`), damit `page.route()` jede Anfrage sieht. Mit `BASE_PATH` laufen Build, `vite preview`
  und `baseURL` unter dem Pfad (die Specs navigieren relativ mit `page.goto('./')`).
- **CI** (`.github/workflows/ci.yml`, Node aus `.nvmrc`): Lint, `format:check`, Typecheck, Tests und Build; danach
  E2E mit dem von Playwright installierten Chromium.
