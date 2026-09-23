import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useTiltSweep } from '../hooks/useModel';

const de = {
  title: 'Neigungsvergleich',
  subtitle: 'Jahresertrag je Neigung θ ab Senkrechte (0° = senkrecht)',
  detail: (deg: string, kwh: string) => `Optimum ${deg}: ${kwh}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Tilt comparison',
    subtitle: 'Annual yield per tilt θ from vertical (0° = vertical)',
    detail: (deg, kwh) => `Optimum ${deg}: ${kwh}`,
  },
};

/** Annual yield vs. tilt (line per floor + total), current and optimum marked (STUB). */
export function TiltSweepChart() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const sweep = useTiltSweep();
  return (
    <ViewCard title={t.title} subtitle={t.subtitle} exportName="neigungsvergleich" busy={!sweep}>
      <Placeholder
        detail={
          sweep ? t.detail(f.deg(sweep.optimum.tiltFromVertical), f.kwh(sweep.optimum.totalKwh)) : c.computing
        }
      >
        {c.inProgress}
      </Placeholder>
    </ViewCard>
  );
}
