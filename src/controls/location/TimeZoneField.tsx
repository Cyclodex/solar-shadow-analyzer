import { useId, useMemo, useState, type ChangeEvent } from 'react';
import { useSelectedUtc } from '../../hooks/useModel';
import { useFormat, useMessages, type Messages } from '../../i18n';
import { isValidTimeZone, tzOffsetMinutes } from '../../model/time';
import { useTimeStore } from '../../state/timeStore';
import { deviceTimeZone, timeZoneSuggestions } from './timeZones';
import styles from './TimeZoneField.module.css';

const de = {
  label: 'Zeitzone',
  invalid: 'Unbekannte Zeitzone. Bitte einen IANA-Namen wie «Europe/Zurich» eingeben.',
  offset: (date: string, offset: string) => `Am ${date}: ${offset}`,
  help: 'Alle Uhrzeiten gelten in dieser Zeitzone, inkl. Sommerzeit.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    label: 'Time zone',
    invalid: 'Unknown time zone. Please enter an IANA name such as “Europe/Zurich”.',
    offset: (date, offset) => `On ${date}: ${offset}`,
    help: 'All clock times are in this time zone, incl. daylight saving time.',
  },
};

export interface TimeZoneFieldProps {
  /** Current (valid) IANA time zone. */
  value: string;
  /** Receives a valid time zone name (checked with isValidTimeZone). */
  onCommit: (timeZone: string) => void;
}

/** True for a change that replaced the whole value at once (datalist pick / autofill), not a keystroke. */
function isPick(e: ChangeEvent<HTMLInputElement>): boolean {
  const native = e.nativeEvent;
  return !(native instanceof InputEvent) || native.inputType === 'insertReplacementText';
}

/**
 * Time zone as free text with a datalist of suggestions (common zones first, then every zone the browser
 * knows). The draft is validated with isValidTimeZone and committed on blur / Enter or when a suggestion
 * is picked; an invalid draft stays visible with an error. The hint shows the UTC offset at the selected date.
 */
export function TimeZoneField({ value, onCommit }: TimeZoneFieldProps) {
  const t = useMessages(messages);
  const f = useFormat();
  const id = useId();
  const listId = `${id}-zones`;
  const utcMs = useSelectedUtc();
  const date = useTimeStore((s) => s.date);
  const [draft, setDraft] = useState<string | null>(null);
  /** Set by a failed commit; typing clears it (intermediate drafts are never flagged). */
  const [rejected, setRejected] = useState(false);
  const suggestions = useMemo(() => timeZoneSuggestions(value, deviceTimeZone()), [value]);
  const invalid = rejected && draft !== null;

  const commit = (text: string): void => {
    const tz = text.trim();
    if (!isValidTimeZone(tz)) {
      setRejected(true); // keep the draft visible with its error
      return;
    }
    setDraft(null);
    setRejected(false);
    if (tz !== value) onCommit(tz);
  };

  const offset = f.utcOffset(tzOffsetMinutes(value, utcMs));
  const name = f.tzName(value, utcMs);
  // Zones without an abbreviation report "GMT+2" & co.: then the offset alone says it all.
  const offsetText = /^(GMT|UTC)/.test(name) || name === value ? offset : `${offset} (${name})`;
  const describedBy = [invalid ? `${id}-error` : null, `${id}-hint`].filter(Boolean).join(' ');

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {t.label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="text"
        list={listId}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={draft ?? value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          const next = e.target.value;
          if (isPick(e) && isValidTimeZone(next.trim())) {
            commit(next);
          } else {
            setDraft(next);
            setRejected(false);
          }
        }}
        onBlur={() => {
          if (draft !== null) commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft !== null) commit(draft);
          else if (e.key === 'Escape') {
            setDraft(null);
            setRejected(false);
          }
        }}
      />
      <datalist id={listId}>
        {suggestions.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      {invalid && (
        <p id={`${id}-error`} className={styles.error} role="status">
          {t.invalid}
        </p>
      )}
      <p id={`${id}-hint`} className={styles.hint}>
        {t.offset(f.date(date), offsetText)}. {t.help}
      </p>
    </div>
  );
}
