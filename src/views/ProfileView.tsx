import { ViewCard } from '../components/ViewCard';
import { Placeholder } from '../components/Placeholder';
import { useFormat, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useInstant, useLayout } from '../hooks/useModel';

const de = {
  title: 'Seitenansicht',
  subtitle: 'Schnitt senkrecht zur Fassade',
  detail: (profile: string, critical: string) => `Profilwinkel ${profile} · kritisch ${critical}`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    title: 'Side view',
    subtitle: 'Section perpendicular to the facade',
    detail: (profile, critical) => `Profile angle ${profile} · critical ${critical}`,
  },
};

/** Section perpendicular to the facade: balconies, tilted panels, profile angle (STUB). */
export function ProfileView() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const layout = useLayout();
  const instant = useInstant();
  const profile = instant.profileAngle === null ? '–' : f.deg(instant.profileAngle, 1);
  return (
    <ViewCard title={t.title} subtitle={t.subtitle} exportName="seitenansicht" minHeight={320}>
      <Placeholder detail={t.detail(profile, f.deg(layout.criticalProfileAngle, 1))}>
        {c.inProgress}
      </Placeholder>
    </ViewCard>
  );
}
