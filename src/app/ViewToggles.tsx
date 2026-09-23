import { Button } from '../components/Button';
import { useMessages, type Messages } from '../i18n';
import { VIEW_KEYS, useUiStore, type ViewKey } from '../state/uiStore';
import styles from './ViewToggles.module.css';

const de: { group: string } & Record<ViewKey, string> = {
  group: 'Sichtbare Ansichten',
  scene3d: '3D',
  frontal: 'Frontal',
  profile: 'Seite',
  sunpath: 'Sonnenbahn',
  panelShadow: 'Panel-Schatten',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    group: 'Visible views',
    scene3d: '3D',
    frontal: 'Front',
    profile: 'Side',
    sunpath: 'Sun path',
    panelShadow: 'Panel shadow',
  },
};

/** Chips (toggle buttons with aria-pressed) that show/hide the views. */
export function ViewToggles() {
  const t = useMessages(messages);
  const views = useUiStore((s) => s.views);
  const toggleView = useUiStore((s) => s.toggleView);
  return (
    <div className={styles.row} role="group" aria-label={t.group}>
      <span className={styles.label} aria-hidden="true">
        {t.group}
      </span>
      {VIEW_KEYS.map((key) => (
        <Button
          key={key}
          size="sm"
          pressed={views[key]}
          onClick={() => toggleView(key)}
          className={styles.chip}
        >
          {t[key]}
        </Button>
      ))}
    </div>
  );
}
