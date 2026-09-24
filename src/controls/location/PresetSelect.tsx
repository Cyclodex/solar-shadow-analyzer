import { useId, useMemo } from 'react';
import { LOCALES, useLang } from '../../i18n';
import type { Lang } from '../../model/types';
import { LOCATION_PRESETS, type LocationPreset } from '../../model/presets';
import styles from './PresetSelect.module.css';

export interface PresetSelectProps {
  label: string;
  /** Id of the preset at the current coordinates, '' if none. */
  value: string;
  /** Shown (disabled) when the current location matches no preset. */
  placeholder: string;
  onSelect: (preset: LocationPreset) => void;
}

interface Group {
  country: string;
  label: string;
  presets: LocationPreset[];
}

/** Presets grouped by country in list order; country names from Intl.DisplayNames (code as fallback). */
function groupPresets(lang: Lang): Group[] {
  let names: Intl.DisplayNames | null;
  try {
    names = new Intl.DisplayNames([LOCALES[lang]], { type: 'region' });
  } catch {
    names = null;
  }
  const groups = new Map<string, Group>();
  for (const p of LOCATION_PRESETS) {
    let g = groups.get(p.country);
    if (!g) {
      g = { country: p.country, label: names?.of(p.country) ?? p.country, presets: [] };
      groups.set(p.country, g);
    }
    g.presets.push(p);
  }
  return [...groups.values()];
}

/** Native select of the location presets, grouped by country (<optgroup>). */
export function PresetSelect({ label, value, placeholder, onSelect }: PresetSelectProps) {
  const lang = useLang();
  const id = useId();
  const groups = useMemo(() => groupPresets(lang), [lang]);
  const known = LOCATION_PRESETS.some((p) => p.id === value);

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={known ? value : ''}
        onChange={(e) => {
          const preset = LOCATION_PRESETS.find((p) => p.id === e.target.value);
          if (preset) onSelect(preset);
        }}
      >
        {!known && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {groups.map((g) => (
          <optgroup key={g.country} label={g.label}>
            {g.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
