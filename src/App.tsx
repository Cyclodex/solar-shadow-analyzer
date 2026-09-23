import { Suspense, useId } from 'react';
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
import { useMessages, type Messages } from './i18n';
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

/**
 * Layout (App.module.css): header, then a grid. Desktop (≥ 1100 px): sticky sidebar (quick controls +
 * settings) left, results right. Below: one column in the order KPIs → time/tilt → views → analysis →
 * settings — the sidebar and main wrappers become `display: contents` so the same components are placed
 * in different grid areas without duplication.
 */
export default function App() {
  useDocumentSettings();
  const t = useMessages(messages);
  const views = useUiStore((s) => s.views);
  const viewsId = useId();
  const analysisId = useId();
  const anyView = Object.values(views).some(Boolean);

  return (
    <>
      <a className={styles.skip} href="#results">
        {t.skip}
      </a>
      <DataLoader />
      <Header />
      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label={t.controls}>
          <div className={styles.quick}>
            <QuickControls />
          </div>
          <div className={styles.settings}>
            <SettingsSections />
          </div>
        </aside>

        <main className={styles.main}>
          <div id="results" className={styles.top} tabIndex={-1}>
            <WarningsBar />
            <KpiBar />
          </div>

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

        <div className={styles.footer}>
          <Footer />
        </div>
      </div>
    </>
  );
}
