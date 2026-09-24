import { Suspense, useId, type MouseEvent } from 'react';
import { BottomBar } from './app/BottomBar';
import { DataLoader } from './app/DataLoader';
import { Footer } from './app/Footer';
import { Header } from './app/Header';
import { KpiBar } from './app/KpiBar';
import { ViewToggles } from './app/ViewToggles';
import { WarningsBar } from './app/WarningsBar';
import { jumpTo } from './app/jumpTo';
import { BOTTOM_BAR_LAYOUT, WIDE_LAYOUT } from './app/layout';
import { useDocumentSettings } from './app/useDocumentSettings';
import { DailyProfileChart } from './charts/DailyProfileChart';
import { EconomicsCard } from './charts/EconomicsCard';
import { MonthlyTable } from './charts/MonthlyTable';
import { MonthlyYieldChart } from './charts/MonthlyYieldChart';
import { ShadeHeatmap } from './charts/ShadeHeatmap';
import { TiltSweepChart } from './charts/TiltSweepChart';
import { Button } from './components/Button';
import { Placeholder } from './components/Placeholder';
import { Spinner } from './components/Spinner';
import { QuickControls, SettingsSections } from './controls/Sidebar';
import { PrintRoot } from './export/PrintRoot';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useMessages, type Messages } from './i18n';
import { PwaToast } from './pwa/PwaToast';
import { reloadPage } from './pwa/updates';
import { useUiStore } from './state/uiStore';
import { FrontalView } from './views/FrontalView';
import { PanelShadowView } from './views/PanelShadowView';
import { ProfileView } from './views/ProfileView';
import { SunPathView } from './views/SunPathView';
import { Scene3DLazy } from './views/scene3d';
import { SceneErrorBoundary } from './views/scene3d/SceneErrorBoundary';
import styles from './App.module.css';

const de = {
  skip: 'Zu den Ergebnissen springen',
  controls: 'Eingaben',
  views: 'Ansichten',
  analysis: 'Analyse',
  loading3d: '3D-Ansicht wird geladen …',
  failed3d: 'Die 3D-Ansicht konnte nicht geladen werden.',
  failed3dDetail:
    'Wahrscheinlich ist inzwischen eine neue Version erschienen, oder die Internetverbindung fehlt. Neu laden holt die aktuelle Version.',
  reload: 'Neu laden',
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
    failed3d: 'The 3D view could not be loaded.',
    failed3dDetail:
      'Most likely a new version has been released in the meantime, or there is no internet connection. Reloading fetches the current version.',
    reload: 'Reload',
    noViews: 'All views are hidden.',
  },
};

/** Skip link: focuses and scrolls to the results without replacing the '#c=' share hash (jumpTo). */
function skipToResults(e: MouseEvent<HTMLAnchorElement>): void {
  jumpTo(e, 'results');
}

/**
 * Layout (App.module.css): header, then the page. The DOM order is the reading order of each layout, so
 * keyboard focus and screen readers follow what is seen:
 * - desktop (≥ 1100 px): sticky sidebar (quick controls + settings) | main (KPIs, views, analysis);
 * - below: one column KPIs → time/tilt → views → analysis → settings;
 * - phones and touch tablets (BOTTOM_BAR_LAYOUT): KPIs → views → time/tilt → analysis → settings, with the
 *   control bar (time, tilt, "jump to" the regions) at the bottom of the screen.
 * Quick controls and settings move between the wrappers at the breakpoints; <main> and the results keep
 * their place in the tree (no remount of e.g. the 3D view's WebGL context).
 */
export default function App() {
  useDocumentSettings();
  const t = useMessages(messages);
  const views = useUiStore((s) => s.views);
  const viewsId = useId();
  const analysisId = useId();
  const wide = useMediaQuery(WIDE_LAYOUT);
  const bar = useMediaQuery(BOTTOM_BAR_LAYOUT);
  const anyView = Object.values(views).some(Boolean);
  // Targets of the bar's "jump to" links (app/BottomBar): focusable only there.
  const jumpTarget = bar ? -1 : undefined;

  const quick = (
    // Time and tilt are inputs, not part of the printed report (print.css hides the <aside> only).
    <div id="quick" className={styles.quick} data-print="hide" tabIndex={jumpTarget}>
      <QuickControls />
    </div>
  );
  const settings = (
    <div id="settings" className={styles.settings} tabIndex={jumpTarget}>
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

          {!wide && !bar && quick}

          <div className={styles.results}>
            <section id="views" className={styles.block} aria-labelledby={viewsId} tabIndex={jumpTarget}>
              <div className={styles.blockHead}>
                <h2 id={viewsId} className={styles.blockTitle}>
                  {t.views}
                </h2>
                <ViewToggles />
              </div>
              {views.scene3d && (
                // A chunk that fails to load (e.g. removed by a new deploy, src/pwa/staleChunks.ts) replaces
                // only this view, not the whole app.
                <SceneErrorBoundary
                  fallback={
                    <div className={styles.fallback3d}>
                      <Placeholder
                        detail={
                          <>
                            {t.failed3dDetail}{' '}
                            <Button size="sm" onClick={reloadPage}>
                              {t.reload}
                            </Button>
                          </>
                        }
                      >
                        {t.failed3d}
                      </Placeholder>
                    </div>
                  }
                >
                  <Suspense
                    fallback={
                      <div className={styles.fallback3d}>
                        <Spinner label={t.loading3d} showLabel />
                      </div>
                    }
                  >
                    <Scene3DLazy />
                  </Suspense>
                </SceneErrorBoundary>
              )}
              <div className={styles.grid}>
                {views.frontal && <FrontalView />}
                {views.profile && <ProfileView />}
                {views.sunpath && <SunPathView />}
                {views.panelShadow && <PanelShadowView />}
              </div>
              {!anyView && <p className={styles.empty}>{t.noViews}</p>}
            </section>

            {bar && quick}

            <section
              id="analysis"
              className={styles.block}
              aria-labelledby={analysisId}
              tabIndex={jumpTarget}
            >
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
      {bar && <BottomBar />}
      <PwaToast />
    </>
  );
}
