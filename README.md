# Solar Shadow Analyzer ☀️

Interaktive Verschattungsanalyse für Balkon-Solarpanels. Berechnet ob und wann übereinander liegende Panels sich gegenseitig verschatten, mit drei synchronisierten Ansichten und Ertragsvergleich.

## Features

- **Profilwinkel-Berechnung** — exakte Geometrie-basierte Verschattungsanalyse
- **3 Ansichten** — Frontal (Süden), Seitenansicht (Profil), Draufsicht (Kompass)
- **Interaktiver Neigungswinkel** — live sehen wie verschiedene Winkel die Verschattung beeinflussen
- **Sonnenstands-Berechnung** — basierend auf sphärischer Astronomie für beliebige Standorte
- **Ertragsvergleich** — relativer Ertrag pro Neigungswinkel und Monat

## Setup

```bash
# Repo klonen
git clone <your-repo-url>
cd solar-shadow-analyzer

# Dependencies installieren
npm install

# Dev-Server starten
npm run dev
```

Öffne http://localhost:5173

## Weiterentwicklung

Siehe [PLAN.md](./PLAN.md) für den detaillierten Erweiterungsplan.

### Mit Claude Code

```bash
# Claude Code installieren (falls noch nicht vorhanden)
npm install -g @anthropic-ai/claude-code

# Im Projektverzeichnis starten
cd solar-shadow-analyzer
claude

# Beispiel-Aufgaben:
# "Refactore App.jsx in separate Komponenten gemäss PLAN.md Phase 1.1"
# "Erstelle ein Config-Panel gemäss PLAN.md Phase 1.2"
# "Füge Balkondecken-Verschattung hinzu gemäss PLAN.md Phase 2.1"
```

## Technischer Hintergrund

### Sonnenposition
Berechnet via klassische sphärische Astronomie:
- Sonnendeklination aus Tag im Jahr
- Stundenwinkel aus Uhrzeit  
- Höhe und Azimut aus Breitengrad
- Genauigkeit: ~0.5-1°

### Verschattungsgeometrie
Der kritische Profilwinkel bestimmt, ab welchem scheinbaren Sonnenwinkel (projiziert auf die Fassadennormale) das obere Panel einen Schatten auf das untere wirft:

```
kritischer_winkel = arctan(vertikaler_abstand / horizontaler_versatz)
```

### Einschränkungen
- Flacher Horizont (keine Geländeabschattung)
- Keine Diffusstrahlung / Wolken
- Keine Temperatureffekte auf Panels
- Für reale Ertragsprognosen → PVGIS verwenden

## Aktuell konfigurierte Werte

| Parameter | Wert |
|---|---|
| Standort | Münchenbuchsee, 47.1°N |
| Fassade | 213° (SSW) |
| Balkonhöhe | 280 cm |
| Geländer | 100 cm |
| Panels | 2× 176.2 × 113.4 × 3 cm |

## Lizenz

MIT
