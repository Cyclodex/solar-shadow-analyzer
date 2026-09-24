import { useId } from 'react';
import { Button } from '../components/Button';
import { PauseIcon, PlayIcon } from '../components/icons';
import { Segmented } from '../components/Segmented';
import { Slider, type SliderMark } from '../components/Slider';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { tzOffsetMinutes, utcToLocal } from '../model/time';
import { useAnimation } from '../hooks/useAnimation';
import { useSelectedUtc, useSunTimes } from '../hooks/useModel';
import { useConfigSection } from '../state/configStore';
import { SPEED_OPTIONS, todayAtSite, useTimeStore, type Speed } from '../state/timeStore';
import styles from './TimeControls.module.css';

const de = {
  heading: 'Zeitpunkt',
  date: 'Datum',
  quickDates: 'Schnellauswahl Datum',
  quick: {
    dec: 'Dezember-Sonnenwende',
    mar: 'März-Tagundnachtgleiche',
    jun: 'Juni-Sonnenwende',
    sep: 'September-Tagundnachtgleiche',
  },
  today: 'Heute',
  now: 'Jetzt',
  nowTitle: 'Aktuelles Datum und aktuelle Uhrzeit am Standort',
  time: 'Uhrzeit (Ortszeit)',
  timeZone: 'Zeitzone',
  play: 'Tagesverlauf abspielen',
  pause: 'Animation anhalten',
  speed: 'Geschwindigkeit (simulierte Minuten pro Sekunde)',
  speedUnit: 'min/s',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    heading: 'Point in time',
    date: 'Date',
    quickDates: 'Quick date selection',
    quick: {
      dec: 'December solstice',
      mar: 'March equinox',
      jun: 'June solstice',
      sep: 'September equinox',
    },
    today: 'Today',
    now: 'Now',
    nowTitle: 'Current date and time at the site',
    time: 'Time (local)',
    timeZone: 'Time zone',
    play: 'Play the day',
    pause: 'Pause animation',
    speed: 'Speed (simulated minutes per second)',
    speedUnit: 'min/s',
  },
};

/** Date, local clock time (with sunrise/sunset marks and time zone) and the day animation. */
export function TimeControls() {
  useAnimation();
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const id = useId();
  const tz = useConfigSection('location').timezone;
  const date = useTimeStore((s) => s.date);
  const minutes = useTimeStore((s) => s.minutes);
  const playing = useTimeStore((s) => s.playing);
  const speed = useTimeStore((s) => s.speed);
  const setDate = useTimeStore((s) => s.setDate);
  const setMinutes = useTimeStore((s) => s.setMinutes);
  const togglePlaying = useTimeStore((s) => s.togglePlaying);
  const setSpeed = useTimeStore((s) => s.setSpeed);
  const times = useSunTimes();
  const utc = useSelectedUtc();

  const year = date.slice(0, 4);
  const quickDates = [
    { date: `${year}-12-21`, title: t.quick.dec },
    { date: `${year}-03-20`, title: t.quick.mar },
    { date: `${year}-06-21`, title: t.quick.jun },
    { date: `${year}-09-22`, title: t.quick.sep },
  ];
  const today = todayAtSite();
  const zone = `${f.tzName(tz, utc)}, ${f.utcOffset(tzOffsetMinutes(tz, utc))}`;

  const marks: SliderMark[] = [];
  // Sun-coloured ticks at sunrise/sunset (the text line below names them).
  if (times.sunrise !== null) marks.push({ value: times.sunrise, label: f.time(times.sunrise), tone: 'sun' });
  if (times.sunset !== null) marks.push({ value: times.sunset, label: f.time(times.sunset), tone: 'sun' });

  const setNow = (): void => {
    const now = utcToLocal(Date.now(), tz);
    setDate(now.date);
    setMinutes(Math.round(now.minutes));
  };

  let sunText: string;
  if (times.polar === 'day') sunText = c.polarDay;
  else if (times.polar === 'night') sunText = c.polarNight;
  else
    sunText = [
      times.sunrise !== null ? `${c.sunrise} ${f.time(times.sunrise)}` : null,
      times.sunset !== null ? `${c.sunset} ${f.time(times.sunset)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <section className={styles.card} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className={styles.heading}>
        {t.heading}
      </h2>

      <div className={styles.dateRow}>
        <label htmlFor={`${id}-date`} className={styles.label}>
          {t.date}
        </label>
        <input
          id={`${id}-date`}
          type="date"
          className={styles.dateInput}
          value={date}
          min="1900-01-01"
          max="2100-12-31"
          required
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className={styles.quick} role="group" aria-label={t.quickDates}>
        {quickDates.map((q) => (
          <Button
            key={q.date}
            size="sm"
            pressed={date === q.date}
            title={q.title}
            onClick={() => setDate(q.date)}
            className={styles.quickButton}
          >
            {f.dateShort(q.date)}
          </Button>
        ))}
        <Button
          size="sm"
          pressed={date === today}
          onClick={() => setDate(today)}
          className={styles.quickButton}
        >
          {t.today}
        </Button>
      </div>

      <div className={styles.timeHead}>
        <label htmlFor={`${id}-time`} className={styles.label}>
          {t.time}
        </label>
        {/* Not <output>: its implicit role=status would announce every animation step (the slider's
            aria-valuetext already gives screen readers the time). */}
        <span className={styles.clock}>{f.time(minutes)}</span>
        <Button size="sm" variant="ghost" onClick={setNow} title={t.nowTitle}>
          {t.now}
        </Button>
      </div>
      <Slider
        id={`${id}-time`}
        value={minutes}
        min={0}
        max={1440}
        step={5}
        onChange={setMinutes}
        valueText={(m) => `${f.time(m)} (${zone})`}
        marks={marks}
        aria-describedby={`${id}-sun ${id}-zone`}
      />
      <p id={`${id}-sun`} className={styles.meta}>
        {sunText}
      </p>
      <p id={`${id}-zone`} className={styles.meta}>
        {t.timeZone}: {tz} ({zone})
      </p>

      <div className={styles.playRow}>
        <Button
          variant="primary"
          icon={playing ? <PauseIcon /> : <PlayIcon />}
          onClick={togglePlaying}
          className={styles.play}
        >
          {playing ? t.pause : t.play}
        </Button>
        <div className={styles.speed}>
          <Segmented<Speed>
            label={t.speed}
            size="sm"
            value={speed}
            onChange={setSpeed}
            options={SPEED_OPTIONS.map((s) => ({ value: s, label: `${s}`, title: `${s} ${t.speedUnit}` }))}
          />
          <span className={styles.speedUnit} aria-hidden="true">
            {t.speedUnit}
          </span>
        </div>
      </div>
    </section>
  );
}
