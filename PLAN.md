# Solar Shadow Analyzer — Erweiterungsplan

## Aktueller Stand (v1.2)

Voll funktionsfähige App mit:
- **Two-column Widescreen-Layout** — Steuerung links, Ausgaben rechts
- **3 interaktive SVG-Ansichten** (Frontal, Seite, Draufsicht) — dynamisch nach Config
- **Vollständiges Config-Panel** — alle Parameter per UI einstellbar (Standort, Balkon, Panels)
- **Sonnenstands-Berechnung** — sphärische Astronomie, beliebige Standorte
- **Profilwinkel-basierte Verschattungsanalyse** (Panel-zu-Panel)
- **Jahres-Verschattung %** — Anteil verschatteter Sonnenstunden übers Jahr
- **Neigungswinkel-Vergleich** mit relativem Ertrag und Schattenstunden
- **Monatsdiagramm** und Jahrestabelle
- **Panelneigung 0–90°** — 0° = senkrecht, Anzeige mit Grad-vom-Boden-Hinweis
- **Mehrere Stockwerke** — FrontalView rendert N Balkone dynamisch

### Konfigurierbare Parameter (implementiert)

| Parameter | Default | Einheit | Bereich |
|---|---|---|---|
| Breitengrad | 47.1 | ° | 0–90 |
| Längengrad | 7.45 | ° | -180–180 |
| Fassaden-Azimut | 202 | ° | 0–360 |
| Balkonhöhe (Decke-Decke) | 280 | cm | 200–400 |
| Geländerhöhe | 100 | cm | 60–150 |
| Panel-Länge | 113.4 | cm | 50–250 |
| Panel-Breite | 176.2 | cm | 50–250 |
| Anzahl Panels nebeneinander | 2 | Stk | 1–6 |
| Panel-Neigung | 45 | ° (von senkrecht) | 0–90 |
| Anzahl Stockwerke | 2 | Stk | 1–5 |

### Bekannte Einschränkungen

- Streiflicht-Schatten (Sonne fast parallel zur Fassade) werden mitgezählt, haben aber nur minimalen Praxiseinfluss
- Code ist noch ein Monolith (App.jsx ~900 Zeilen) — Code-Splitting noch ausstehend


## Phase 2 — Erweiterte Verschattungsanalyse

### 2.1 Balkondecken-Verschattung

Die Balkondecke (Platte des oberen Stockwerks) ist im Winter der Haupt-Schattenwerfer, nicht das obere Panel. Berechnung:

- Deckenplatte ragt X cm über die Fassade hinaus (= Balkontiefe)
- Vertikaler Abstand Decke → Panelkante
- Kritischer Profilwinkel für Decken-Verschattung
- In Seitenansicht visualisieren (schraffierter Schattenbereich)

### 2.2 Mehrere Stockwerke

- N Stockwerke mit Panels simulieren
- Jedes Stockwerk kann unterschiedliche Verschattung haben
- Oberstes Stockwerk: nur Decken-Verschattung
- Mittlere: Decke + Panel darüber
- Visualisierung in Frontalansicht

### 2.3 Nachbar-Verschattung (optional, komplex)

- Einfaches Modell: ein rechteckiges Hindernis in konfigurierbarem Abstand/Höhe/Azimut
- Zeigt wann das Hindernis die Sonne blockiert
- In Draufsicht visualisierbar


## Phase 3 — Ertragsberechnung & Wirtschaftlichkeit

### 3.1 kWh-Ertragsschätzung

- Panel-Leistung in Wp eingeben (z.B. 400Wp)
- Systemverluste konfigurierbar (Wechselrichter, Kabel, Temperatur: Standard ~14%)
- Monatlicher und jährlicher kWh-Ertrag basierend auf:
  - Unsere Einfallswinkel-Berechnung
  - Typische Sonnenstunden für den Breitengrad
  - Optional: Strahlungsdaten von PVGIS API

### 3.2 PVGIS-Integration (optional)

PVGIS bietet eine kostenlose API:
```
https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat=47.1&lon=7.45&peakpower=0.8&loss=14&angle=45&aspect=-33&outputformat=json
```

- Reale Strahlungsdaten für den Standort
- Horizontprofil (Geländeabschattung)
- Vergleich: unsere Berechnung vs. PVGIS

### 3.3 Wirtschaftlichkeitsrechner

- Strompreis (CHF/kWh)
- Eigenverbrauchsanteil (%)
- Einspeisevergütung (CHF/kWh)
- Anschaffungskosten
- → Amortisationszeit, jährliche Ersparnis


## Phase 4 — UX & Polish

### 4.1 Responsive Design

- Mobile-optimiert (aktuell nur Desktop-tauglich)
- Touch-friendly Sliders
- Ansichten stacken auf kleinen Screens

### 4.2 Preset-System

- Vordefinierte Standorte (Zürich, Bern, Basel, Wien, Berlin, München)
- Gängige Panel-Grössen als Dropdown
- "Mein Setup speichern" (localStorage)

### 4.3 Export

- PDF-Bericht generieren
- Screenshot/SVG-Export der Diagramme
- Config als JSON teilen (URL-Parameter)

### 4.4 Sprache

- i18n vorbereiten (DE/EN/FR/IT)
- Aktuell alles Deutsch, Strings extrahieren


## Phase 5 — Erweiterte Visualisierungen

### 5.1 Jahres-Sonnenuhr

- Alle 365 Tage × 24h als Heatmap
- X-Achse: Stunden, Y-Achse: Monate
- Farbe: Verschattungsstatus oder Profilwinkel
- Sofort sichtbar wann Schatten auftritt

### 5.2 3D-Ansicht (optional, Three.js)

- Einfaches 3D-Modell: Fassade + Balkone + Panels
- Sonne als Lichtquelle, Echtzeit-Schatten
- Interaktiv drehbar
- Hoher Wow-Faktor, aber aufwändig

### 5.3 Animierter Tageslauf

- Play-Button: Sonne wandert automatisch über den Tag
- Geschwindigkeit einstellbar
- Alle drei Ansichten synchron


## Technische Hinweise für Claude Code / Sonnet

### Kontext-Prompt

Wenn du die App mit einem anderen Modell weiterentwickelst, gib ihm diesen Kontext:

```
Du arbeitest an einer React-App (Vite) für die Verschattungsanalyse
von Balkon-Solarpanels. Die App berechnet Sonnenstände basierend auf
sphärischer Astronomie und visualisiert die Verschattung zwischen
übereinander liegenden Panels in drei SVG-Ansichten.

Aktuelle Datei: src/App.jsx (Monolith, ~700 Zeilen)
Stack: React 18, Vite 5, reines CSS-in-JS (inline styles)
Keine externen UI-Libraries, alle Visualisierungen sind SVG.

Deine Aufgabe: [spezifische Aufgabe hier]
```

### Wichtig beim Refactoring

- Die Sonnenpositions-Berechnung (`getSolarPosition`) ist Performance-kritisch (wird in Schleifen aufgerufen)
- `useMemo` ist essentiell für die Jahresanalyse und Yield-Berechnungen
- Die SVG viewBox-Koordinaten sind in jedem View unterschiedlich — beim Refactoring aufpassen
- Die Frontalansicht hat eine nicht-triviale Skalierung (building scale vs. sun scale)


## Priorisierung

| Prio | Task | Aufwand | Impact |
|---|---|---|---|
| ✅ | Phase 1.2: Config Panel | Mittel | Hoch — macht App universell nutzbar |
| ✅ | Two-column Widescreen-Layout | Klein | Hoch — Usability |
| ✅ | Jahres-Verschattung % | Klein | Hoch — wichtige Kennzahl |
| 🔴 | Phase 1.1: Code aufteilen | Mittel | Mittel — Wartbarkeit |
| 🟡 | Phase 2.1: Decken-Verschattung | Klein | Hoch — Winter-relevant |
| 🟡 | Phase 3.1: kWh-Ertrag | Mittel | Hoch — die Frage die jeder hat |
| 🟡 | Phase 4.1: Responsive (Mobile) | Mittel | Mittel |
| 🟢 | Phase 5.1: Jahres-Heatmap | Klein | Mittel — schöne Visualisierung |
| 🟢 | Phase 3.2: PVGIS-API | Klein | Mittel — reale Daten |
| 🟢 | Phase 5.3: Animation | Klein | Nice-to-have |
| ⚪ | Phase 5.2: 3D | Gross | Nice-to-have |
| ⚪ | Phase 2.3: Nachbar-Schatten | Gross | Nische |
