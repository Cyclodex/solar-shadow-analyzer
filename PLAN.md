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
  360 px.
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

## Offen

- Übersetzungen Französisch und Italienisch (aus dem alten Punkt 4.4).
- SVG-Export der Ansichten und Diagramme (aus dem alten Punkt 4.3).
- Open-Graph-Tags `og:url` und `og:image` (eigenes Vorschaubild) für die feste Adresse auf GitHub Pages.

## Ideen

- **Zirkumsolares Diffusmodell** (Hay-Davies, eventuell Perez) statt des isotropen Himmels. Wichtig gerade für die
  Verschattung, weil der zirkumsolare Anteil wie Direktstrahlung vom oberen Panel abgeschattet wird.
- **Verschattung über mehrere Stockwerke durch Modullücken:** Heute schattet nur das direkt darüberliegende
  Stockwerk; durch Lücken zwischen Modulen könnten auch höhere Stockwerke beitragen (laut Abschätzung unter
  0.01 Prozentpunkten, bei grossen Lücken prüfen).
- **Web Worker für den Neigungsvergleich:** Der Sweep rechnet 19 Jahressimulationen (0–90° in 5°-Schritten) im
  Hauptthread; in einem Worker bliebe die Oberfläche auch auf langsamen Geräten flüssig.
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
