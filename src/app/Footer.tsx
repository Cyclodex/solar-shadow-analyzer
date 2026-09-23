import { useMessages, type Messages } from '../i18n';
import styles from './Footer.module.css';

interface Source {
  name: string;
  href: string;
  text: string;
}

const de = {
  heading: 'Modell, Annahmen & Datenquellen',
  assumptionsTitle: 'Annahmen',
  assumptions: [
    'Sonnenstand nach dem NOAA-Verfahren (inkl. Refraktion), Uhrzeit als lokale Zeit der Standort-Zeitzone inkl. Sommerzeit.',
    'Verschattung nur durch die Panelreihe des direkt darüberliegenden Stockwerks (exakte 3D-Geometrie); die Fassade blockiert Sonne von hinten.',
    'Horizont aus Gelände (optional), eigenen Horizontpunkten und Hindernissen; darunter keine Direktstrahlung.',
    'Diffusstrahlung isotrop mit Himmelssichtfaktor je Stockwerk, Bodenreflexion über die Albedo, Modultemperatur nach NOCT, Einfallswinkelverluste nach ASHRAE.',
    'Teilverschattung wahlweise flächenanteilig oder mit Bypass-Teilsträngen; Systemverluste und Wechselrichter-Grenze je Stockwerk.',
    'Ohne Wetterdaten: synthetisches Jahr mit klarem Himmel – ein theoretisches Maximum.',
  ],
  sourcesTitle: 'Datenquellen',
  sources: [
    {
      name: 'NOAA Solar Calculator',
      href: 'https://gml.noaa.gov/grad/solcalc/',
      text: 'Algorithmus für Sonnenstand, Sonnenauf- und -untergang.',
    },
    {
      name: 'Open-Meteo Historical Weather API',
      href: 'https://open-meteo.com/',
      text: 'Stündliche Einstrahlung und Temperatur (Reanalyse, u. a. ERA5 von Copernicus/ECMWF). Weather data by Open-Meteo.com, Lizenz CC BY 4.0.',
    },
    {
      name: 'Terrain Tiles (AWS Open Data, Mapzen/Tilezen)',
      href: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
      text: 'Höhenmodell für den Geländehorizont; Quellen u. a. SRTM, GMTED2010, ETOPO1, EU-DEM (produced using Copernicus data and information funded by the European Union), 3DEP/NED – vollständige Quellenliste unter dem Link.',
    },
  ] satisfies Source[],
  disclaimer:
    'Modellrechnung ohne Gewähr. Die Ergebnisse ersetzen keine Fachplanung; reale Erträge hängen zusätzlich von Wetter, Verschmutzung, Modulstreuung und Installation ab.',
};

const messages: Messages<typeof de> = {
  de,
  en: {
    heading: 'Model, assumptions & data sources',
    assumptionsTitle: 'Assumptions',
    assumptions: [
      'Sun position after the NOAA method (incl. refraction); clock time is the local time of the site’s time zone incl. daylight saving time.',
      'Shading only by the panel row of the floor directly above (exact 3D geometry); the facade blocks sun from behind.',
      'Horizon from terrain (optional), custom horizon points and obstacles; no direct irradiance below it.',
      'Isotropic diffuse irradiance with a sky view factor per floor, ground reflection via albedo, module temperature after NOCT, incidence angle losses after ASHRAE.',
      'Partial shading either proportional to the shaded area or with bypass substrings; system losses and inverter limit per floor.',
      'Without weather data: synthetic clear-sky year – a theoretical maximum.',
    ],
    sourcesTitle: 'Data sources',
    sources: [
      {
        name: 'NOAA Solar Calculator',
        href: 'https://gml.noaa.gov/grad/solcalc/',
        text: 'Algorithm for sun position, sunrise and sunset.',
      },
      {
        name: 'Open-Meteo Historical Weather API',
        href: 'https://open-meteo.com/',
        text: 'Hourly irradiance and temperature (reanalysis incl. ERA5 by Copernicus/ECMWF). Weather data by Open-Meteo.com, licence CC BY 4.0.',
      },
      {
        name: 'Terrain Tiles (AWS Open Data, Mapzen/Tilezen)',
        href: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
        text: 'Elevation model for the terrain horizon; sources incl. SRTM, GMTED2010, ETOPO1, EU-DEM (produced using Copernicus data and information funded by the European Union), 3DEP/NED – full list behind the link.',
      },
    ],
    disclaimer:
      'Model calculation without warranty. The results do not replace professional planning; real yields also depend on weather, soiling, module tolerances and installation.',
  },
};

/** Model assumptions, data sources with attribution, disclaimer. */
export function Footer() {
  const t = useMessages(messages);
  return (
    <footer className={styles.footer}>
      <h2 className={styles.heading}>{t.heading}</h2>
      <div className={styles.columns}>
        <section>
          <h3 className={styles.subheading}>{t.assumptionsTitle}</h3>
          <ul className={styles.list}>
            {t.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className={styles.subheading}>{t.sourcesTitle}</h3>
          <ul className={styles.list}>
            {t.sources.map((s) => (
              <li key={s.name}>
                <a href={s.href} target="_blank" rel="noopener noreferrer">
                  {s.name}
                </a>
                : {s.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className={styles.disclaimer}>{t.disclaimer}</p>
    </footer>
  );
}
