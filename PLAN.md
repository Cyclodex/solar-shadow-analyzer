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

### 2.1 Diagonale 3D-Verschattung (obere → untere Panels)

Das aktuelle Modell arbeitet **2D im Querschnitt** (Profilwinkel, senkrecht zur Fassade). Damit wird nur berechnet ob die Unterkante des oberen Panels die Sonne zum direkt darunter liegenden Panel blockiert.

Was fehlt: morgens/abends kommt die Sonne **seitlich**, und die oberen Panels werfen einen **diagonalen Schatten** auf die unteren — verschoben in Richtung der Sonnenseite:

```
Sonne morgens (von Osten/rechts):

  Obere Panels:   [  Panel 1  ][  Panel 2  ]
                        ↘ diagonaler Schatten
  Untere Panels:  [Schat][  Panel 1  ][  Panel 2  ]
                   ^^^^
                   im Schatten, obwohl vertikal
                   kein Panel direkt darüber
```

Horizontaler Schattenversatz:
```
versatz = vertikaler_abstand / tan(sonnenhöhe) × sin(azimut_diff_zur_fassade)
```

Umsetzung: vollständige 3D-Schattenberechnung statt 2D-Profilwinkel:
- Für jeden Punkt der unteren Panels prüfen ob die Sichtlinie zur Sonne durch ein oberes Panel blockiert wird
- Verschatteten Flächenanteil als % ausgeben (nicht nur ja/nein)
- In Frontalansicht als Schattenbereich visualisieren

> Hinweis: Die Balkondecke ist für aussen am Geländer hängende Panels nicht relevant, da die Panels ausserhalb des Überhangbereichs sind.

### 2.2 Nachbar-Verschattung (optional)

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

### 5.1 Jahres-Sonnenuhr (Heatmap)

- Alle 365 Tage × 24h als Heatmap
- X-Achse: Stunden, Y-Achse: Monate
- Farbe: Verschattungsstatus oder Profilwinkel
- Sofort sichtbar wann Schatten auftritt

### 5.2 Animierter Tageslauf

- Play-Button: Sonne wandert automatisch über den Tag
- Geschwindigkeit einstellbar
- Alle drei Ansichten synchron


## Phase 6 — 3D-Visualisierung

Die aufwändigste, aber visuell eindrücklichste Erweiterung. Sinnvoll erst nach Phase 2.1 (korrekte 3D-Schattenberechnung), da die 3D-Ansicht dann echte Schattenflächen darstellen kann.

### 6.1 3D-Modell (Three.js)

- Fassade, Balkone, Panels als 3D-Objekte
- Sonne als gerichtete Lichtquelle an der berechneten Position
- Echtzeit-Schatten via Three.js Shadow Maps
- Interaktiv drehbar und zoombar
- Schattenbereich auf unteren Panels klar sichtbar — auch diagonal

### 6.2 Was 3D besonders zeigt

- Den diagonalen Schatten (Phase 2.1) intuitiv verständlich machen
- Morgen/Abend-Situation direkt sichtbar: Schatten wandert über die Panels
- Gebäudegeometrie (Wände links/rechts) einbeziehbar

### 6.3 Technischer Aufwand

- Three.js oder React Three Fiber als Library
- Shadow Maps benötigen korrekte Lichtquellen-Position (aus getSolarPosition)
- Panel-Geometrie aus Config direkt übernehmen
- Performance: nur bei Interaktion neu rendern, nicht in Schleifen


## Technische Hinweise für Claude Code / Sonnet

### Kontext-Prompt

Wenn du die App mit einem anderen Modell weiterentwickelst, gib ihm diesen Kontext:

```
Du arbeitest an einer React-App (Vite) für die Verschattungsanalyse
von Balkon-Solarpanels. Die App berechnet Sonnenstände basierend auf
sphärischer Astronomie und visualisiert die Verschattung zwischen
übereinander liegenden Panels in drei SVG-Ansichten.

Aktuelle Datei: src/App.jsx (Monolith, ~900 Zeilen)
Stack: React 18, Vite 5, reines CSS-in-JS (inline styles)
Keine externen UI-Libraries, alle Visualisierungen sind SVG.
Alle Parameter sind in DEFAULT_CONFIG definiert und werden als `cfg`
an alle Komponenten und Pure Functions weitergegeben.
Panelneigung: config.panelTilt = Winkel von senkrecht (0=senkrecht),
intern wird 90-panelTilt als Winkel von horizontal verwendet.

Deine Aufgabe: [spezifische Aufgabe hier]
```

### Wichtig beim Refactoring

- Die Sonnenpositions-Berechnung (`getSolarPosition`) ist Performance-kritisch (wird in Schleifen aufgerufen)
- `useMemo` ist essentiell für die Jahresanalyse und Yield-Berechnungen
- Die SVG viewBox-Koordinaten sind in jedem View unterschiedlich — beim Refactoring aufpassen
- Die Frontalansicht hat eine nicht-triviale Skalierung (building scale vs. sun scale)
- `config.panelTilt` ist Winkel von senkrecht; `tilt = 90 - config.panelTilt` ist der interne Winkel von horizontal


## Priorisierung

| Prio | Task | Aufwand | Impact |
|---|---|---|---|
| ✅ | Phase 1.2: Config Panel | Mittel | Hoch — macht App universell nutzbar |
| ✅ | Two-column Widescreen-Layout | Klein | Hoch — Usability |
| ✅ | Jahres-Verschattung % | Klein | Hoch — wichtige Kennzahl |
| 🔴 | Phase 1.1: Code aufteilen | Mittel | Mittel — Wartbarkeit |
| 🔴 | Phase 2.1: Diagonale 3D-Verschattung | Gross | Hoch — aktuelles Modell unterschätzt Morgen/Abend-Schatten |
| 🟡 | Phase 3.1: kWh-Ertrag | Mittel | Hoch — die Frage die jeder hat |
| 🟡 | Phase 4.1: Responsive (Mobile) | Mittel | Mittel |
| 🟢 | Phase 5.1: Jahres-Heatmap | Klein | Mittel — schöne Visualisierung |
| 🟢 | Phase 3.2: PVGIS-API | Klein | Mittel — reale Daten |
| 🟢 | Phase 5.2: Animation | Klein | Nice-to-have |
| ⚪ | Phase 6: 3D-Visualisierung (Three.js) | Gross | Wow-Faktor — sinnvoll nach Phase 2.1 |
| ⚪ | Phase 2.2: Nachbar-Verschattung | Gross | Nische |
