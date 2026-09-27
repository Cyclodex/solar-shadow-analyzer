import { Button } from '../components/Button';
import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { TextField } from '../components/TextField';
import { displayLocationName, useFormat, useMessages, type Messages } from '../i18n';
import { LIMITS } from '../model/defaults';
import { findLocationPreset, presetToLocation } from '../model/presets';
import { MAX_LOCATION_NAME_LENGTH, formatCoordinateName } from '../model/share';
import type { LocationConfig } from '../model/types';
import { useConfigSection, usePatch } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { AddressBuilding } from './location/AddressBuilding';
import { applyAddress } from './location/addressSession';
import { MyLocationButton } from './location/MyLocationButton';
import { AddressPlacementStatus } from './location/PlacementPrompt';
import { PlaceSearch } from './location/PlaceSearch';
import { PresetSelect } from './location/PresetSelect';
import { TimeZoneField } from './location/TimeZoneField';
import sections from './sections.module.css';
import styles from './LocationSection.module.css';

const de = {
  title: 'Standort',
  find: 'Ort finden',
  preset: 'Vorlage',
  custom: 'Eigener Standort',
  details: 'Koordinaten & Zeitzone',
  name: 'Bezeichnung',
  latitude: 'Breitengrad',
  latitudeHint: 'Nord positiv, Süd negativ',
  longitude: 'Längengrad',
  longitudeHint: 'Ost positiv, West negativ',
  elevation: 'Höhe über Meer',
  elevationHint: 'Zur Information; der Geländehorizont rechnet mit der Höhe aus dem Geländemodell.',
  demElevation: (m: string) => `Geländemodell: ${m}`,
  applyDem: 'Übernehmen',
  applyDemLabel: (m: string) => `Höhe ${m} aus dem Geländemodell übernehmen`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Location',
    find: 'Find a place',
    preset: 'Preset',
    custom: 'Custom location',
    details: 'Coordinates & time zone',
    name: 'Name',
    latitude: 'Latitude',
    latitudeHint: 'north positive, south negative',
    longitude: 'Longitude',
    longitudeHint: 'east positive, west negative',
    elevation: 'Elevation',
    elevationHint: 'For information; the terrain horizon uses the elevation of the terrain model.',
    demElevation: (m) => `Terrain model: ${m}`,
    applyDem: 'Apply',
    applyDemLabel: (m) => `Apply elevation ${m} from the terrain model`,
  },
};

/**
 * Site: search for building addresses (swisstopo, CH/FL) and places (Open-Meteo geocoding), device position (with
 * the nearest address), presets, the building at a picked address, name, coordinates (1e-6°), elevation (with the
 * terrain model's value as suggestion) and time zone.
 */
export function LocationSection() {
  const t = useMessages(messages);
  const f = useFormat();
  const location = useConfigSection('location');
  const patch = usePatch();
  const terrainStatus = useDataStore((s) => s.terrain.status);
  const siteElevation = useDataStore((s) => s.terrain.siteElevation);
  const L = LIMITS.location;
  const preset = findLocationPreset(location);
  const dem = terrainStatus === 'ready' && siteElevation !== null ? Math.round(siteElevation) : null;

  /** Coordinate edit: an automatic coordinate label follows the coordinates, a chosen name is kept. */
  const setCoordinate = (key: 'latitude' | 'longitude', v: number): void => {
    const next: Partial<LocationConfig> = { [key]: v };
    if (location.name === formatCoordinateName(location.latitude, location.longitude)) {
      const lat = key === 'latitude' ? v : location.latitude;
      const lon = key === 'longitude' ? v : location.longitude;
      next.name = formatCoordinateName(lat, lon);
    }
    patch('location', next);
  };
  /** Committing the displayed (localised) coordinate label keeps the automatic, language-neutral label. */
  const setName = (name: string): void => {
    const { latitude, longitude } = location;
    patch('location', {
      name: name === f.coords(latitude, longitude) ? formatCoordinateName(latitude, longitude) : name,
    });
  };
  const shownName = displayLocationName(location, f);

  return (
    <Section level={3} id="location" title={t.title} summary={shownName}>
      <div className={sections.group}>
        <h4 className={sections.subheading}>{t.find}</h4>
        <PlaceSearch onSelectPlace={(loc) => patch('location', loc)} onSelectAddress={applyAddress} />
        <AddressPlacementStatus />
        <MyLocationButton
          onLocate={(loc) => patch('location', loc)}
          onAddress={applyAddress}
          location={location}
        />
        <PresetSelect
          label={t.preset}
          value={preset?.id ?? ''}
          placeholder={t.custom}
          onSelect={(p) => patch('location', presetToLocation(p))}
        />
      </div>

      <AddressBuilding />

      <div className={sections.group}>
        <h4 className={sections.subheading}>{t.details}</h4>
        <TextField label={t.name} value={shownName} maxLength={MAX_LOCATION_NAME_LENGTH} onCommit={setName} />
        <NumberField
          label={t.latitude}
          value={location.latitude}
          onChange={(v) => setCoordinate('latitude', v)}
          limit={L.latitude}
          unit="°"
          digits={6}
          slider={false}
          hint={t.latitudeHint}
          // Coordinates keep 6 decimals (≤ 0.07 m, exact addresses) and a sign: "−122.419412".
          inputWidth="11.5ch"
        />
        <NumberField
          label={t.longitude}
          value={location.longitude}
          onChange={(v) => setCoordinate('longitude', v)}
          limit={L.longitude}
          unit="°"
          digits={6}
          slider={false}
          hint={t.longitudeHint}
          // Coordinates keep 6 decimals (≤ 0.07 m, exact addresses) and a sign: "−122.419412".
          inputWidth="11.5ch"
        />
        <div className={styles.elevation}>
          <NumberField
            label={t.elevation}
            value={location.elevation}
            onChange={(v) => patch('location', { elevation: v })}
            limit={L.elevation}
            unit="m"
            slider={false}
            hint={t.elevationHint}
          />
          {dem !== null && (
            <div className={styles.dem}>
              <span>{t.demElevation(f.unit(dem, 'm'))}</span>
              {dem !== location.elevation && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t.applyDemLabel(f.unit(dem, 'm'))}
                  onClick={() => patch('location', { elevation: dem })}
                >
                  {t.applyDem}
                </Button>
              )}
            </div>
          )}
        </div>
        <TimeZoneField value={location.timezone} onCommit={(timezone) => patch('location', { timezone })} />
      </div>
    </Section>
  );
}
