import { useDeferredValue, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '../components/Button';
import { MinusIcon, PauseIcon, PlayIcon, PlusIcon, SectionsIcon } from '../components/icons';
import { Slider } from '../components/Slider';
import { useDismissOnOutsidePointer } from '../components/usePopover';
import { useTimeSlider } from '../controls/useTimeSlider';
import { useResultsReady, useTiltSweep } from '../hooks/useModel';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { LIMITS } from '../model/defaults';
import { useConfigSection, usePatch } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { jumpTo } from './jumpTo';
import styles from './BottomBar.module.css';

/** Minutes per −/+ step; the steps snap to this grid (12:05 → 12:15 / 12:00). */
export const TIME_STEP = 15;

/** Jump targets: ids of the page regions in App.tsx (in page order). */
const SECTIONS = ['results', 'views', 'quick', 'analysis', 'settings'] as const;
type SectionKey = (typeof SECTIONS)[number];

const de = {
  region: 'Schnellsteuerung',
  time: 'Uhrzeit (Ortszeit)',
  clock: 'Uhrzeit',
  clockTitle: 'Zeitregler ein- oder ausblenden',
  earlier: (min: number) => `${min} Minuten früher`,
  later: (min: number) => `${min} Minuten später`,
  play: 'Tagesverlauf abspielen',
  pause: 'Animation anhalten',
  tilt: 'Panelneigung',
  tiltTitle: 'Neigungsregler ein- oder ausblenden',
  tiltField: 'Neigung θ ab Senkrechte',
  optimumMark: (deg: string) => `Opt. ${deg}`,
  jump: 'Springe zu',
  sections: {
    results: 'Ergebnisse',
    views: 'Ansichten (3D)',
    quick: 'Zeitpunkt und Neigung',
    analysis: 'Analyse',
    settings: 'Einstellungen',
  } satisfies Record<SectionKey, string>,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    region: 'Quick controls',
    time: 'Time (local)',
    clock: 'Time',
    clockTitle: 'Show or hide the time slider',
    earlier: (min) => `${min} minutes earlier`,
    later: (min) => `${min} minutes later`,
    play: 'Play the day',
    pause: 'Pause animation',
    tilt: 'Panel tilt',
    tiltTitle: 'Show or hide the tilt slider',
    tiltField: 'Tilt θ from vertical',
    optimumMark: (deg) => `Opt. ${deg}`,
    jump: 'Jump to',
    sections: {
      results: 'Results',
      views: 'Views (3D)',
      quick: 'Time and tilt',
      analysis: 'Analysis',
      settings: 'Settings',
    },
  },
};

type MessageSet = typeof de;
type Panel = 'time' | 'tilt';

/**
 * Publishes the height the bar covers as --bottom-bar-h on <html>: global.css pads the end of the page by
 * it and keeps focused elements above the bar (scroll-padding-bottom); other fixed elements (e.g. toasts)
 * can stay clear of it.
 */
function useBarHeight(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = (): void => {
      // The bar and the gap below it (floating dock on wider screens).
      const bottom = parseFloat(getComputedStyle(el).bottom) || 0;
      root.style.setProperty('--bottom-bar-h', `${Math.round(el.getBoundingClientRect().height + bottom)}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--bottom-bar-h');
    };
  }, [ref]);
}

/** The clock time slider (mounted only while its panel is open). */
function TimePanel({ label }: { label: string }) {
  const { slider } = useTimeSlider();
  return <Slider {...slider} aria-label={label} />;
}

/** The tilt slider with the optimum as mark (mounted only while its panel is open). */
function TiltPanel({ t }: { t: MessageSet }) {
  const f = useFormat();
  const theta = useConfigSection('panels').tiltFromVertical;
  const patch = usePatch();
  // Same sweep as the tilt card (cached); computed after the panel has painted, final inputs only.
  const ready = useResultsReady();
  const painted = useDeferredValue(true, false);
  const optimum = useTiltSweep(painted && ready)?.optimum;
  const { min, max, step } = LIMITS.panels.tiltFromVertical;
  return (
    <Slider
      value={theta}
      min={min}
      max={max}
      step={step}
      onChange={(v) => patch('panels', { tiltFromVertical: v })}
      valueText={(v) => f.deg(v)}
      marks={
        optimum
          ? [
              {
                value: optimum.tiltFromVertical,
                label: t.optimumMark(f.deg(optimum.tiltFromVertical)),
                tone: 'sun',
              },
            ]
          : undefined
      }
      aria-label={t.tiltField}
    />
  );
}

/**
 * "Jump to" menu (disclosure: a button with aria-expanded and a <nav> of in-page links). The links scroll
 * without changing the URL (jumpTo keeps the '#c=' share hash) and move the focus to the region. Escape
 * closes it and returns the focus to the button; so do a press outside and leaving it with Tab.
 */
function JumpMenu({ t }: { t: MessageSet }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const navId = useId();
  useDismissOnOutsidePointer(rootRef, open, () => setOpen(false));

  return (
    <div
      ref={rootRef}
      className={styles.jump}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Button
        ref={buttonRef}
        icon={<SectionsIcon />}
        aria-expanded={open}
        aria-controls={navId}
        title={t.jump}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sr-only-narrow">{t.jump}</span>
      </Button>
      <nav id={navId} className={styles.menu} aria-label={t.jump} hidden={!open}>
        <ul className={styles.menuList}>
          {SECTIONS.map((id) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className={styles.menuItem}
                onClick={(e) => {
                  setOpen(false);
                  jumpTo(e, id, { smooth: true });
                }}
              >
                {t.sections[id]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/**
 * Control bar at the bottom of the screen on phones and touch tablets (App.tsx, BOTTOM_BAR_LAYOUT): keeps
 * the time within reach while the 3D view or the results are on screen. Clock time with −/+ steps of
 * TIME_STEP minutes (stop the animation), play/pause, the clock button opens the time slider, the tilt
 * button the tilt slider, and a "jump to" menu for the page regions. The animation itself runs in
 * TimeControls (useAnimation is mounted there once).
 */
export function BottomBar() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const minutes = useTimeStore((s) => s.minutes);
  const date = useTimeStore((s) => s.date);
  const playing = useTimeStore((s) => s.playing);
  const togglePlaying = useTimeStore((s) => s.togglePlaying);
  const theta = useConfigSection('panels').tiltFromVertical;
  const [panel, setPanel] = useState<Panel | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const timeId = useId();
  const tiltId = useId();
  useBarHeight(barRef);

  const step = (dir: 1 | -1): void => {
    const { minutes: m, setMinutes, setPlaying } = useTimeStore.getState();
    setPlaying(false);
    const grid = dir > 0 ? Math.floor(m / TIME_STEP) : Math.ceil(m / TIME_STEP);
    setMinutes((grid + dir) * TIME_STEP);
  };
  const toggle = (p: Panel): void => setPanel((current) => (current === p ? null : p));

  // DOM order = focus order: each slider right after the button that opens it. The grid (CSS) shows the
  // open slider above the buttons on phones and between them on wider screens.
  return (
    <div ref={barRef} className={styles.bar} role="region" aria-label={t.region} data-print="hide">
      <div className={styles.time}>
        <Button iconOnly icon={<MinusIcon />} title={t.earlier(TIME_STEP)} onClick={() => step(-1)}>
          {t.earlier(TIME_STEP)}
        </Button>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={panel === 'time'}
          aria-controls={timeId}
          title={t.clockTitle}
          onClick={() => toggle('time')}
        >
          {/* Not a live region: the animation would announce every step. */}
          <span className="sr-only">{t.clock} </span>
          <span className={styles.clock}>{f.time(minutes)}</span>{' '}
          <span className={styles.date}>{f.dateShort(date)}</span>
        </button>
        <Button iconOnly icon={<PlusIcon />} title={t.later(TIME_STEP)} onClick={() => step(1)}>
          {t.later(TIME_STEP)}
        </Button>
      </div>
      <div id={timeId} className={styles.panel} hidden={panel !== 'time'}>
        {panel === 'time' && <TimePanel label={t.time} />}
      </div>
      <Button
        variant="primary"
        iconOnly
        icon={playing ? <PauseIcon /> : <PlayIcon />}
        title={playing ? t.pause : t.play}
        onClick={togglePlaying}
        className={styles.play}
      >
        {playing ? t.pause : t.play}
      </Button>
      <button
        type="button"
        className={`${styles.toggle} ${styles.tilt}`}
        aria-expanded={panel === 'tilt'}
        aria-controls={tiltId}
        title={t.tiltTitle}
        onClick={() => toggle('tilt')}
      >
        <span className="sr-only">{t.tilt} </span>
        <span className={styles.value}>
          {c.tiltSymbol} {f.deg(theta)}
        </span>
      </button>
      <div id={tiltId} className={styles.panel} hidden={panel !== 'tilt'}>
        {panel === 'tilt' && <TiltPanel t={t} />}
      </div>
      <JumpMenu t={t} />
    </div>
  );
}
