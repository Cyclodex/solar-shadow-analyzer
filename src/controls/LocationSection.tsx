import { NumberField } from '../components/NumberField';
import { Section } from '../components/Section';
import { SelectField } from '../components/SelectField';
import { TextField } from '../components/TextField';
import { useFormat, useMessages, type Messages } from '../i18n';
import { LIMITS } from '../model/defaults';
import { LOCATION_PRESETS, findLocationPreset, presetToLocation } from '../model/presets';
import { isValidTimeZone } from '../model/time';
import { useConfigSection, usePatch } from '../state/configStore';
import { useDataStore } from '../state/dataStore';

const de = {
  title: 'Standort',
  preset: 'Ort wählen',
  custom: 'Eigener Standort',
  name: 'Bezeichnung',
  latitude: 'Breitengrad',
  latitudeHint: 'Nord positiv, Süd negativ',
  longitude: 'Längengrad',
  longitudeHint: 'Ost positiv, West negativ',
  elevation: 'Höhe über Meer',
  demElevation: (m: string) => `Geländemodell am Standort: ${m}`,
  timezone: 'Zeitzone',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Location',
    preset: 'Choose place',
    custom: 'Custom location',
    name: 'Name',
    latitude: 'Latitude',
    latitudeHint: 'north positive, south negative',
    longitude: 'Longitude',
    longitudeHint: 'east positive, west negative',
    elevation: 'Elevation',
    demElevation: (m) => `Terrain model at the site: ${m}`,
    timezone: 'Time zone',
  },
};

/** IANA time zones known to the browser (evaluated once). */
const SUPPORTED_ZONES: readonly string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
})();

/** Time zone options (the current one always included). */
function timeZones(current: string): readonly string[] {
  return SUPPORTED_ZONES.includes(current) ? SUPPORTED_ZONES : [current, ...SUPPORTED_ZONES];
}

/** Site: presets, name, coordinates, elevation, time zone. (Basic version.) */
export function LocationSection() {
  const t = useMessages(messages);
  const f = useFormat();
  const location = useConfigSection('location');
  const patch = usePatch();
  const siteElevation = useDataStore((s) => s.terrain.siteElevation);
  const L = LIMITS.location;
  const preset = findLocationPreset(location);

  return (
    <Section id="location" title={t.title} summary={location.name}>
      <SelectField
        label={t.preset}
        value={preset?.id ?? ''}
        placeholder={t.custom}
        options={LOCATION_PRESETS.map((p) => ({ value: p.id, label: `${p.name} (${p.country})` }))}
        onChange={(id) => {
          const p = LOCATION_PRESETS.find((x) => x.id === id);
          if (p) patch('location', presetToLocation(p));
        }}
      />
      <TextField
        label={t.name}
        value={location.name}
        maxLength={80}
        onCommit={(name) => patch('location', { name })}
      />
      <NumberField
        label={t.latitude}
        value={location.latitude}
        onChange={(v) => patch('location', { latitude: v })}
        limit={L.latitude}
        unit="°"
        digits={4}
        hint={t.latitudeHint}
      />
      <NumberField
        label={t.longitude}
        value={location.longitude}
        onChange={(v) => patch('location', { longitude: v })}
        limit={L.longitude}
        unit="°"
        digits={4}
        hint={t.longitudeHint}
      />
      <NumberField
        label={t.elevation}
        value={location.elevation}
        onChange={(v) => patch('location', { elevation: v })}
        limit={L.elevation}
        unit="m"
        slider={false}
        hint={siteElevation !== null ? t.demElevation(f.unit(siteElevation, 'm')) : undefined}
      />
      <SelectField
        label={t.timezone}
        value={location.timezone}
        options={timeZones(location.timezone).map((z) => ({ value: z, label: z }))}
        onChange={(timezone) => {
          if (isValidTimeZone(timezone)) patch('location', { timezone });
        }}
      />
    </Section>
  );
}
