import type { SliderMark, SliderProps } from '../components/Slider';
import { useFormat } from '../i18n';
import { tzOffsetMinutes } from '../model/time';
import { useSelectedUtc, useSunTimes } from '../hooks/useModel';
import { useConfigSection } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';

export type TimeSliderProps = Pick<
  SliderProps,
  'value' | 'min' | 'max' | 'step' | 'onChange' | 'valueText' | 'marks'
>;

/**
 * The local clock time slider (0…1440 min in 5-min steps, sunrise/sunset marks, time and zone as
 * aria-valuetext), shared by TimeControls and the control bar on phones (app/BottomBar). Also returns the
 * zone text, e.g. "MESZ, UTC+2".
 */
export function useTimeSlider(): { slider: TimeSliderProps; zone: string } {
  const f = useFormat();
  const tz = useConfigSection('location').timezone;
  const minutes = useTimeStore((s) => s.minutes);
  const setMinutes = useTimeStore((s) => s.setMinutes);
  const times = useSunTimes();
  const utc = useSelectedUtc();

  const zone = `${f.tzName(tz, utc)}, ${f.utcOffset(tzOffsetMinutes(tz, utc))}`;
  const marks: SliderMark[] = [];
  // Sun-coloured ticks at sunrise/sunset.
  if (times.sunrise !== null) marks.push({ value: times.sunrise, label: f.time(times.sunrise), tone: 'sun' });
  if (times.sunset !== null) marks.push({ value: times.sunset, label: f.time(times.sunset), tone: 'sun' });

  return {
    slider: {
      value: minutes,
      min: 0,
      max: 1440,
      step: 5,
      onChange: setMinutes,
      valueText: (m) => `${f.time(m)} (${zone})`,
      marks,
    },
    zone,
  };
}
