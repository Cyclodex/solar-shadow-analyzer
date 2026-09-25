# Solar Shadow Analyzer — Roadmap

Stand: Version 2.0.0 (September 2026). Was die App kann, steht im [README](README.md); Modell, Konventionen und
Modulgrenzen stehen in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Dieser Plan ersetzt den Erweiterungsplan von
Version 1.2 (eine einzige `App.jsx`, 2D-Profilwinkel-Modell).

## Erledigt in Version 2.0

Die Phasen des alten Plans und ihre Umsetzung:

- **v1.2 Grundfunktionen** (Konfiguration, Widescreen-Layout, Jahres-Verschattung in %): weitergeführt als Sidebar mit
  Abschnitten, Verschattungsverlust in kWh und % sowie verschattete Stunden je Monat.
- **1.1 Code aufteilen:** TypeScript mit UI-freiem Modell (`src/model`), zustand-Stores (`src/state`), Ansichten,
  Diagrammen, Eingaben und Export in eigenen Ordnern; Tests mit Vitest und Playwright, CI auf GitHub Actions.
- **2.1 Diagonale 3D-Verschattung:** exakte 3D-Verschattung je Modul inkl. seitlichem Schatten am Morgen und Abend,
  wahlweise flächenanteilig oder mit Bypass-Teilsträngen; geprüft gegen Brute-Force-Ray-Casting.
- **2.2 Nachbar-Verschattung:** bis zu 20 Hindernisse als Quader, umgerechnet in einen Horizont je Stockwerk; dazu
  der Geländehorizont aus einem Höhenmodell und eigene Horizontpunkte.
- **3.1 kWh-Ertrag:** Jahressimulation mit stündlichen Open-Meteo-Wetterdaten (oder Clear-Sky-Jahr), Diffus- und
  Bodenstrahlung, Modultemperatur (NOCT), Einfallswinkelverlust, Systemverluste und Wechselrichter-Grenze.
- **3.2 PVGIS:** teilweise. Die Ergebnisse sind offline gegen PVGIS-ERA5 und PVGIS-SARAH3 validiert, der
  Geländehorizont mit `scripts/validate-terrain.ts` gegen PVGIS `printhorizon`, und eine PVGIS-Horizontdatei kann
  importiert werden. Ein direkter Abruf aus dem Browser ist nicht möglich, weil PVGIS keine CORS-Header sendet.
- **3.3 Wirtschaftlichkeit:** Ersparnis, Amortisation und Bilanz über die Betrachtungsdauer mit Degradation.
- **4.1 Responsive:** einspaltig unter 1100 px, Ergebnisse vor den Einstellungen, ohne horizontales Scrollen bei
  360 px; zur Bedienung auf dem Handy siehe unten.
- **4.2 Presets:** 24 Standorte, Ortssuche, Gerätestandort, 5 Modultypen; Einstellungen werden automatisch im
  Browser gespeichert.
- **4.3 Export:** Teilen-Link, Konfiguration als JSON, CSV-Tabellen, PNG je Ansicht und Diagramm und Druckbericht (auch als PDF).
- **4.4 Sprache:** Deutsch und Englisch.
- **5.1 Heatmap:** Jahres-Heatmap der Verschattung je Stockwerk.
- **5.2 Animation:** Tagesanimation mit einstellbarer Geschwindigkeit, alle Ansichten synchron.
- **6 3D-Visualisierung:** three.js-Ansicht mit Shadow Maps, exaktem Modellschatten als Overlay und Kamera-Presets.
- **Deployment:** GitHub Pages unter <https://cyclodex.github.io/solar-shadow-analyzer/>, nach erfolgreicher CI für
  jeden Push auf `main` (`.github/workflows/pages.yml`); Build unter einem Unterpfad über `BASE_PATH`.
- **PWA / offline:** installierbar auf Android, iOS/iPadOS und am Computer (Knopf «Installieren», auf iOS mit
  Anleitung); ein Service Worker speichert alle App-Dateien, nach dem ersten Besuch startet die App offline, zuletzt
  geladene Wetter- und Geländedaten bleiben im `localStorage`. Neue Versionen erst nach «Neu laden».
- **Bedienung auf dem Handy:** 30 Befunde aus Tests auf sechs Geräten (iPhone SE mit 320 px, iPhone 14, Pixel 7,
  Android mit 360 px, iPad mini, Handy quer mit 844 × 390 px; in Chromium emuliert), alle umgesetzt:
  - Steuerleiste am unteren Rand (Uhrzeit ±15 Minuten, Zeit- und Neigungsregler, Tagesanimation, «Springe zu»
    Ergebnisse, Ansichten, Zeitpunkt und Neigung, Analyse, Einstellungen); die 3D-Ansicht folgt direkt auf die
    kompakteren Kennzahlen; auf Tablets und Handys quer stehen Zeitpunkt und Neigung nebeneinander.
  - Touch: Regler, Fassadenkompass und Diagramme wirken erst bei einem Tipp oder seitlichem Ziehen, ein Bildlauf
    verstellt nichts; der Neigungsvergleich übernimmt eine Neigung nur über den Knopf im Tooltip; die Heatmap wählt
    auch beim Loslassen nach seitlichem Wischen.
  - 44-px-Bedienelemente und 16-px-Eingabefelder auf Touchscreens (kein Zoom in iOS Safari), Texttastatur mit Minus
    für Felder mit beiden Vorzeichen.
  - Lesbare Beschriftungen bis 320 px: Stockwerke und Stunden in 3D, 3D-Legende und Kameraleiste, Tagesverlauf,
    Frontal-, Seiten- und Sonnenbahnansicht, Horizont-Diagramm, Monatstabelle.
  - Laden und Rechenlast: vorläufige Jahreswerte, solange nur der Geländehorizont fehlt; Gelände-Download erst nach
    dem Wetter; Geländehorizont im Web Worker, alle Stockwerkhöhen in einem Durchgang; Neigungs-Sweep immer in
    kurzen Scheiben im Hintergrund; Heatmap und Monatstabelle rechnen nur in Bildschirmnähe, die 3D-Szene friert
    ausserhalb des Bildschirms ein; Druck und PNG-Export holen alles nach.

## In Arbeit

- **Umgebung: exakte Adresse, Laserscan-Horizont und Nachbargebäude** (Schweiz und Liechtenstein; Konzept und
  Zuständigkeiten: [ARCHITECTURE.md](docs/ARCHITECTURE.md#umgebung-adresse-laserscan-gebäude)):
  - Erledigt, Fundament: Config-Vertrag (`horizon.buildings`, `buildingImport`, `surfaceModel`, additiv ohne
    Versionswechsel), Koordinaten auf 1e-6°, Teilen-Links mit Gebäuden, WGS84 ⇄ LV95 und lokale Meter,
    Gebäude-Import aus den swisstopo-Vektorkacheln (zusammengefügt an Kachelkanten), Rechenregeln, Ladezustände und
    Platzhalter der Oberfläche.
  - Erledigt, Adresssuche (A): Adressen der Schweiz und Liechtensteins (swisstopo) und Orte in einer Suche,
    Gebäudeangaben aus dem GWR, Höhe vom Höhendienst, «Nächste Adresse übernehmen», Koordinaten auf 6 Stellen.
  - Offen: Adresssuche mit Gebäudeangaben (GWR) und Import der Umgebung nach der Wahl einer Adresse;
    Laserscan-Horizont (swissSURFACE3D) je Stockwerk und Neigung im Web Worker, Bäume wahlweise; Nachbargebäude als
    bearbeitbare Prismen, Lageplan zum Bestätigen von Fassade und Balkon, Gebäude in der 3D-Ansicht und im
    Druckbericht.

## Offen

- Übersetzungen Französisch und Italienisch (aus dem alten Punkt 4.4).
- SVG-Export der Ansichten und Diagramme (aus dem alten Punkt 4.3).
- Open-Graph-Tags `og:url` und `og:image` (eigenes Vorschaubild) für die feste Adresse auf GitHub Pages.
- Hilfetext des Fassadenkompasses für Touch: «Kompass ziehen oder anklicken» nennt weder Tippen noch seitliches
  Ziehen.

## Ideen

- **Zirkumsolares Diffusmodell** (Hay-Davies, eventuell Perez) statt des isotropen Himmels. Wichtig gerade für die
  Verschattung, weil der zirkumsolare Anteil wie Direktstrahlung vom oberen Panel abgeschattet wird.
- **Verschattung über mehrere Stockwerke durch Modullücken:** Heute schattet nur das direkt darüberliegende
  Stockwerk; durch Lücken zwischen Modulen könnten auch höhere Stockwerke beitragen (laut Abschätzung unter
  0.01 Prozentpunkten, bei grossen Lücken prüfen).
- **Web Worker für den Neigungsvergleich:** Der Sweep rechnet 19 Jahressimulationen (0–90° in 5°-Schritten) im
  Hauptthread, zwar in Scheiben von etwa 8 ms zwischen den Frames, aber mit derselben Rechenzeit. In einem Worker,
  wie schon der Geländehorizont, läge das erste Optimum auf langsamen Handys früher vor.
- **Momentanwerte beim Ziehen der Neigung:** Das Stockwerksmodell hinter der Leistung jetzt und dem Tagesverlauf
  (`createFloorModel` mit dem Himmelssichtfaktor, `useInstantPower`, `useDailyProfile`) wird bei jedem
  Neigungsschritt sofort neu gebaut. Mit zurückgestellten Eingaben (`useDeferredValue`) wie bei den
  Jahresergebnissen bliebe der Regler auf langsamen Handys flüssiger.
- **Horizont-Diagramm der Einstellungen mit gemessener Breite** (wie die 2D-Ansichten) statt des festen `viewBox`,
  der unter 1100 px auf 360 px begrenzt ist und auf Handys grössere Schrift bekommt.
- **Touch-Gesten in den E2E-Tests:** senkrechtes Wischen über Regler, Kompass und Tagesverlauf mit echten
  Touch-Ereignissen (CDP `Input.dispatchTouchEvent`) statt nur mit Zeigerereignissen in den Komponententests; dazu
  die 320-px-Breite (iPhone SE).
- **Gelände-Zoom in hohen Breiten:** Die Zoom-Bänder der Höhenkacheln (z12 / z10 / z9) sind auf 47° N abgestimmt.
  Weil Web-Mercator-Pixel polwärts kleiner werden, braucht derselbe Horizont mehr Kacheln (geplant: 16 bei 47.1° N,
  34 bei 65° N, 50 bei 70° N). Die Bänder sollten mit der Breite wandern.
- Mehrjahresmittel der Wetterdaten statt eines einzelnen Jahres.
- Teilschatten einzelner Module durch Hindernisse (Ray-Casting statt Horizont von der Panelmitte).
- Seitenwände und Nachbarbalkone als zusätzliche Schattenwerfer.
- Wirtschaftlichkeit mit Diskontierung, Preisentwicklung und Eigenverbrauch aus einem Lastprofil.

## Arbeitsweise

Konventionen und Modulgrenzen: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Vor Commits:
`npm run lint && npm run format:check && npm run typecheck && npm test`.
