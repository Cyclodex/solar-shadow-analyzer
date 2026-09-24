import { Suspense, useId, type MouseEvent } from 'react';
import { DataLoader } from './app/DataLoader';
import { Footer } from './app/Footer';
import { Header } from './app/Header';
import { KpiBar } from './app/KpiBar';
import { ViewToggles } from './app/ViewToggles';
import { WarningsBar } from './app/WarningsBar';
import { useDocumentSettings } from './app/useDocumentSettings';
import { DailyProfileChart } from './charts/DailyProfileChart';
import { EconomicsCard } from './charts/EconomicsCard';
import { MonthlyTable } from './charts/MonthlyTable';
import { MonthlyYieldChart } from './charts/MonthlyYieldChart';
import { ShadeHeatmap } from './charts/ShadeHeatmap';
import { TiltSweepChart } from './charts/TiltSweepChart';
import { Spinner } from './components/Spinner';
import { QuickControls, SettingsSections } from './controls/Sidebar';
import { PrintRoot } from './export/PrintRoot';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useMessages, type Messages } from './i18n';
import { PwaToast } from './pwa/PwaToast';
import { useUiStore } from './state/uiStore';
import { FrontalView } from './views/FrontalView';
import { PanelShadowView } from './views/PanelShadowView';
import { ProfileView } from './views/ProfileView';
import { SunPathView } from './views/SunPathView';
import { Scene3DLazy } from './views/scene3d';
import styles from './App.module.css';

const de = {
  skip: 'Zu den Ergebnissen springen',
  controls: 'Eingaben',
  views: 'Ansichten',
  analysis: 'Analyse',
  loading3d: '3D-Ansicht wird geladen …',
  noViews: 'Alle Ansichten sind ausgeblendet.',
};
const messages: Messages<typeof de> = {
  de,
  en: {
    skip: 'Skip to results',
    controls: 'Inputs',
    views: 'Views',
    analysis: 'Analysis',
    loading3d: 'Loading 3D view …',
    noViews: 'All views are hidden.',
  },
};

/** Desktop layout (sidebar | main); same breakpoint as App.module.css. */
const WIDE_LAYOUT = '(min-width: 1100px)';

/**
 * Skip link: focuses and scrolls to the results without navigating to '#results', which would replace
 * the '#c=' share hash and add a history entry. Without the target the native jump remains.
 */
function skipToResults(e: MouseEvent<HTMLAnchorElement>): void {
  const target = document.getElementById('results');
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView?.({ block: 'start' });
  target.focus({ preventScroll: true });
}

/**
 * Layout (App.module.css): header, then the page. The DOM order is the reading order of each layout, so
 * keyboard focus and screen readers follow what is seen:
 * - desktop (≥ 1100 px): sticky sidebar (quick controls + settings) | main (KPIs, views, analysis);
 * - below: one column KPIs → time/tilt → views → analysis → settings.
 * Quick controls and settings move between the wrappers at the breakpoint; <main> and the results keep
 * their place in the tree (no remount of e.g. the 3D view's WebGL context).
 */
export default function App() {
  useDocumentSettings();
  const t = useMessages(messages);
  const views = useUiStore((s) => s.views);
  const viewsId = useId();
  const analysisId = useId();
  const wide = useMediaQuery(WIDE_LAYOUT);
  const anyView = Object.values(views).some(Boolean);

  const quick = (
    // Time and tilt are inputs, not part of the printed report (print.css hides the <aside> only).
    <div className={styles.quick} data-print="hide">
      <QuickControls />
    </div>
  );
  const settings = (
    <div className={styles.settings}>
      <SettingsSections />
    </div>
  );

  return (
    <>
      <a className={styles.skip} href="#results" onClick={skipToResults}>
        {t.skip}
      </a>
      <DataLoader />
      <PrintRoot />
      <Header />
      <div className={styles.shell}>
        {wide && (
          <aside className={styles.sidebar} aria-label={t.controls}>
            {quick}
            {settings}
          </aside>
        )}

        <main className={styles.main}>
          <div id="results" className={styles.top} tabIndex={-1}>
            <WarningsBar />
            <KpiBar />
          </div>

          {!wide && quick}

          <div className={styles.results}>
            <section className={styles.block} aria-labelledby={viewsId}>
              <div className={styles.blockHead}>
                <h2 id={viewsId} className={styles.blockTitle}>
                  {t.views}
                </h2>
                <ViewToggles />
              </div>
              {views.scene3d && (
                <Suspense
                  fallback={
                    <div className={styles.fallback3d}>
                      <Spinner label={t.loading3d} showLabel />
                    </div>
                  }
                >
                  <Scene3DLazy />
                </Suspense>
              )}
              <div className={styles.grid}>
                {views.frontal && <FrontalView />}
                {views.profile && <ProfileView />}
                {views.sunpath && <SunPathView />}
                {views.panelShadow && <PanelShadowView />}
              </div>
              {!anyView && <p className={styles.empty}>{t.noViews}</p>}
            </section>

            <section className={styles.block} aria-labelledby={analysisId}>
              <div className={styles.blockHead}>
                <h2 id={analysisId} className={styles.blockTitle}>
                  {t.analysis}
                </h2>
              </div>
              <div className={styles.grid}>
                <DailyProfileChart />
                <ShadeHeatmap />
                <MonthlyYieldChart />
                <TiltSweepChart />
              </div>
              <EconomicsCard />
              <MonthlyTable />
            </section>
          </div>
        </main>

        {!wide && (
          <aside className={styles.sidebar} aria-label={t.controls}>
            {settings}
          </aside>
        )}

        <div className={styles.footer}>
          <Footer />
        </div>
      </div>
      <PwaToast />
    </>
  );
}
