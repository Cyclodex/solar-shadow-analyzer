# Solar Shadow Analyzer

Interaktive Verschattungsanalyse für Balkon-Solarpanels. Berechnet ob und wann übereinander liegende Panels sich gegenseitig verschatten — mit konfigurierbaren Parametern, drei synchronisierten Ansichten, Jahresanalyse und Ertragsvergleich.

## Features

- **Vollständig konfigurierbar** — alle Parameter per UI einstellbar: Standort, Fassaden-Azimut, Balkonmasse, Panelgrösse, Stockwerke
- **Profilwinkel-Berechnung** — exakte geometriebasierte Verschattungsanalyse (Panel-zu-Panel)
- **3 synchronisierte Ansichten** — Frontal (von Süden), Seitenansicht (Profil), Draufsicht (Kompass)
- **Interaktive Steuerung** — Panelneigung (0–90°), Jahreszeit, Uhrzeit
- **Jahres-Verschattung %** — Anteil der verschatteten Sonnenstunden übers Jahr
- **Neigungsvergleich** — kritischer Winkel, relativer Ertrag und Schattenstunden für 10 Neigungen
- **Monatsvergleich** — Ertragspotential über das Jahr für verschiedene Neigungen
- **Sonnenstands-Berechnung** — sphärische Astronomie, für beliebige Standorte weltweit

## Setup

```bash
git clone https://github.com/Cyclodex/solar-shadow-analyzer.git
cd solar-shadow-analyzer/app
npm install
npm run dev
```

Öffne http://localhost:5173

## Bedienung

**Linke Spalte — Eingaben:**
- Panelneigung: 0° = senkrecht, 90° = liegend (Wert in Klammern = Grad vom Boden)
- Jahreszeit: Wintersonnenwende / Tagundnachtgleiche / Sommersonnenwende
- Uhrzeit: 5–21 Uhr
- Ansichten ein-/ausblenden
- Einstellungen: Standort, Balkon, Panels — mit Slider und Zahleneingabe, Reset-Button

**Rechte Spalte — Ausgaben:**
- Ergebnis-Box: kritischer Profilwinkel, Panelgeometrie, Jahres-Verschattung %
- Live-Karten: Sonnenhöhe, Azimut, Profilwinkel, Jahres-Verschattung
- SVG-Visualisierungen (alle dynamisch)
- Neigungswinkel-Vergleichstabelle
- Monatsertrag-Diagramm
- Jahrestabelle

## Standardwerte (anpassbar)

| Parameter | Wert |
|---|---|
| Standort | 47.1°N, 7.45°E |
| Fassaden-Azimut | 202° |
| Balkonhöhe | 280 cm |
| Geländerhöhe | 100 cm |
| Panel | 176.2 × 113.4 cm |
| Anzahl Panels | 2 nebeneinander |
| Stockwerke | 2 |
| Panelneigung | 45° (von senkrecht) |

## Technischer Hintergrund

### Sonnenposition
Klassische sphärische Astronomie:
- Sonnendeklination aus Tag im Jahr
- Stundenwinkel aus Uhrzeit
- Höhe und Azimut aus Breitengrad
- Genauigkeit: ~0.5–1°

### Verschattungsgeometrie
Der kritische Profilwinkel bestimmt, ab welchem Sonnenwinkel (projiziert auf die Fassadennormale) das obere Panel einen Schatten auf das untere wirft:

```
kritischer_winkel = arctan(vertikaler_abstand / horizontaler_versatz)
```

Die Panelneigung wird intern als Winkel von der Horizontalen verarbeitet (`intern = 90° − Anzeigewert`).

### Einschränkungen
- Flacher Horizont (keine Geländeabschattung)
- Keine Diffusstrahlung / Bewölkung
- Keine Temperatureffekte
- Für reale Ertragsprognosen → PVGIS verwenden

## Stack

React 18 · Vite 5 · reines CSS-in-JS · alle Visualisierungen SVG · keine externen UI-Libraries

## Weiterentwicklung

Siehe [PLAN.md](./PLAN.md) für den Erweiterungsplan (Phasen 2–5).

## Lizenz

MIT
