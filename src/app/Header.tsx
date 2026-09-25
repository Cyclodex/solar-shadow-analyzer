import { Button } from '../components/Button';
import { LogoIcon, MoonIcon, SunIcon } from '../components/icons';
import { Segmented } from '../components/Segmented';
import { compassPoint, displayLocationName, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { InstallButton } from '../pwa/InstallButton';
import { useConfig } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { ExportMenu } from './ExportMenu';
import { openLocationSearch } from './openLocationSearch';
import { ShareButton } from './ShareButton';
import styles from './Header.module.css';

const de = {
  language: 'Sprache',
  toLight: 'Helles Design',
  toDark: 'Dunkles Design',
  facade: (deg: string, dir: string) => `Fassade ${deg} ${dir}`,
  findLocation: (name: string) => `${name}: Adresse oder Ort suchen`,
};
const messages: Messages<typeof de> = {
  de,
  en: {
    language: 'Language',
    toLight: 'Light theme',
    toDark: 'Dark theme',
    facade: (deg, dir) => `Facade ${deg} ${dir}`,
    findLocation: (name) => `${name}: search for an address or place`,
  },
};

/** Title, configuration summary and global actions (language, theme, share, export, install). */
export function Header() {
  const c = useCommon();
  const t = useMessages(messages);
  const f = useFormat();
  const lang = useLang();
  const setLang = useUiStore((s) => s.setLang);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const { location, building, panels } = useConfig();

  const locationName = displayLocationName(location, f);
  const summary = [
    <button
      key="location"
      type="button"
      className={styles.locationLink}
      aria-label={t.findLocation(locationName)}
      title={t.findLocation(locationName)}
      onClick={openLocationSearch}
    >
      {locationName}
    </button>,
    t.facade(f.deg(building.facadeAzimuth), compassPoint(building.facadeAzimuth, lang)),
    c.floorsCount(building.numFloors),
    `${panels.count} × ${f.unit(panels.powerWp, 'Wp')}`,
  ];

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <LogoIcon className={styles.logo} />
        <div className={styles.titles}>
          <h1 className={styles.title}>{c.appTitle}</h1>
          <p className={styles.summary}>
            {summary.map((s, i) => (
              <span key={i} className={styles.summaryItem}>
                {s}
              </span>
            ))}
          </p>
        </div>
      </div>
      <div className={styles.actions}>
        <Segmented
          label={t.language}
          size="sm"
          value={lang}
          onChange={setLang}
          options={[
            { value: 'de', label: <span lang="de">DE</span>, title: 'Deutsch' },
            { value: 'en', label: <span lang="en">EN</span>, title: 'English' },
          ]}
        />
        <Button
          variant="ghost"
          iconOnly
          icon={theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          onClick={toggleTheme}
          title={theme === 'dark' ? t.toLight : t.toDark}
        >
          {theme === 'dark' ? t.toLight : t.toDark}
        </Button>
        <ShareButton />
        <ExportMenu />
        <InstallButton />
      </div>
    </header>
  );
}
