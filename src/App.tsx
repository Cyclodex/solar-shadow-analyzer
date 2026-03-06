import { useState, useMemo } from 'react';
import type { Config, ActiveViews, YearlyMonthResult } from './types';
import { DEFAULT_CONFIG, monthNames, seasonDays } from './constants';
import { getPanelGeometry, getSolarPosition, getProfileAngle, getDayOfYear } from './utils/solar';
import { ConfigPanel } from './components/ConfigPanel';
import { FrontalView } from './components/FrontalView';
import { ProfileDiagram } from './components/ProfileDiagram';
import { TopDownView } from './components/TopDownView';
import { TiltComparisonChart } from './components/TiltComparisonChart';
import { MonthlyYieldChart } from './components/MonthlyYieldChart';

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function ShadowAnalysis() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [selectedMonth, setSelectedMonth] = useState(0);
  const [hour, setHour] = useState(12);
  const [activeViews, setActiveViews] = useState<ActiveViews>({ frontal: true, profile: true, topdown: true });

  const handleConfigChange = (key: keyof Config, value: number) =>
    setConfig(prev => ({ ...prev, [key]: value }));
  const handleReset = () => setConfig(DEFAULT_CONFIG);

  const tilt = 90 - config.panelTilt; // config stores angle from vertical (0=senkrecht), geometry needs angle from horizontal
  const geo = getPanelGeometry(tilt, config);
  const season = seasonDays[selectedMonth];
  const solar = getSolarPosition(season.day, hour, config);
  const profileAngle = solar.altitude > 0 ? getProfileAngle(solar.altitude, solar.azimuth, config) : null;
  const isShadow = profileAngle !== null && profileAngle >= geo.criticalAngle;
  const sunBehind = solar.altitude > 0 && profileAngle === null;

  const yearAnalysis = useMemo<YearlyMonthResult[]>(() => {
    const results: YearlyMonthResult[] = [];
    for (let m = 1; m <= 12; m++) {
      const doy = getDayOfYear(m, 15);
      let maxP = 0, sH = 0, sunH = 0;
      for (let h = 6; h <= 20; h += 0.25) {
        const sv = getSolarPosition(doy, h, config);
        if (sv.altitude <= 0) continue;
        const p = getProfileAngle(sv.altitude, sv.azimuth, config);
        if (p !== null) {
          sunH += 0.25;
          if (p > maxP) maxP = p;
          if (p >= geo.criticalAngle) sH += 0.25;
        }
      }
      results.push({ month: m, maxProfile: maxP, shadowH: sH, sunH });
    }
    return results;
  }, [JSON.stringify(config)]); // eslint-disable-line react-hooks/exhaustive-deps

  const annualShadowPct = useMemo(() => {
    const totalSunH = yearAnalysis.reduce((s, r) => s + r.sunH, 0);
    const totalShadowH = yearAnalysis.reduce((s, r) => s + r.shadowH, 0);
    return totalSunH > 0 ? (totalShadowH / totalSunH) * 100 : 0;
  }, [yearAnalysis]);

  const toggleView = (key: keyof ActiveViews) =>
    setActiveViews(prev => ({ ...prev, [key]: !prev[key] }));
  const noShadowYear = yearAnalysis.every(r => r.maxProfile < geo.criticalAngle);

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: '#0f172a', color: '#e2e8f0', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* ─── LEFT COLUMN ─── */}
          <div style={{ width: 300, flexShrink: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>Verschattungsanalyse</h1>
            <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 16 }}>
              {config.latitude.toFixed(1)}°N · {config.facadeAzimuth}° Azimut · {config.numPanels}×{config.panelWidth.toFixed(0)} cm · Balkon {config.balconyHeight} cm
            </p>

            {/* Tilt slider */}
            <div style={{ background: 'linear-gradient(135deg, #1e1b4b, #312e81)', borderRadius: 12, padding: '14px 16px', marginBottom: 12, border: '1px solid #4f46e5' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>Panelneigung</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc' }}>{config.panelTilt}°</span>
                  <span style={{ fontSize: 12, color: '#818cf8', marginLeft: 6 }}>({tilt}° vom Boden)</span>
                </span>
              </div>
              <input type="range" min={0} max={90} step={1} value={config.panelTilt}
                onChange={e => handleConfigChange('panelTilt', parseInt(e.target.value))}
                style={{ width: '100%', accentColor: '#818cf8' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6366f1', marginTop: 2 }}>
                <span>0° (senkrecht)</span><span>90° (liegend)</span>
              </div>
              <div style={{ fontSize: 10, color: '#6366f1', marginTop: 4, opacity: 0.7 }}>
                0° = senkrecht zur Fassade (90° vom Boden)
              </div>
            </div>

            {/* Season buttons */}
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Jahreszeit</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              {seasonDays.map((sv, i) => (
                <button key={i} onClick={() => setSelectedMonth(i)} style={{
                  padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600, textAlign: 'left',
                  border: selectedMonth === i ? `2px solid ${sv.color}` : '2px solid #334155',
                  background: selectedMonth === i ? sv.color + '22' : '#1e293b',
                  color: selectedMonth === i ? sv.color : '#94a3b8',
                }}>{sv.label.split(' (')[0]}</button>
              ))}
            </div>

            {/* Time slider */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#94a3b8' }}>
                Uhrzeit: <strong style={{ color: '#e2e8f0' }}>{Math.floor(hour)}:{String(Math.round((hour % 1) * 60)).padStart(2, '0')}</strong>
              </label>
              <input type="range" min={5} max={21} step={0.25} value={hour}
                onChange={e => setHour(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: season.color, marginTop: 4 }} />
            </div>

            {/* View toggles */}
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Ansichten</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
              {([
                { key: 'frontal' as const, label: 'Frontalansicht' },
                { key: 'profile' as const, label: 'Seitenansicht' },
                { key: 'topdown' as const, label: 'Draufsicht' },
              ]).map(v => (
                <button key={v.key} onClick={() => toggleView(v.key)} style={{
                  padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, textAlign: 'left',
                  border: activeViews[v.key] ? '2px solid #818cf8' : '2px solid #334155',
                  background: activeViews[v.key] ? '#312e81' : '#1e293b',
                  color: activeViews[v.key] ? '#c7d2fe' : '#64748b',
                }}>{activeViews[v.key] ? '✓ ' : '○ '}{v.label}</button>
              ))}
            </div>

            {/* Config panel */}
            <ConfigPanel config={config} onChange={handleConfigChange} onReset={handleReset} />
          </div>

          {/* ─── RIGHT COLUMN ─── */}
          <div style={{ flex: 1, minWidth: 320 }}>

            {/* Result box */}
            <div style={{
              background: noShadowYear ? 'linear-gradient(135deg, #064e3b, #065f46)' : 'linear-gradient(135deg, #78350f, #92400e)',
              borderRadius: 12, padding: '16px 20px', marginBottom: 16,
              border: `1px solid ${noShadowYear ? '#10b981' : '#f59e0b'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: noShadowYear ? '#6ee7b7' : '#fde68a' }}>Kritischer Profilwinkel</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#fbbf24' }}>{geo.criticalAngle.toFixed(1)}°</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: noShadowYear ? '#6ee7b7' : '#fde68a' }}>Panel ragt</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>{geo.panelD.toFixed(1)} cm raus · {geo.panelH.toFixed(1)} cm runter</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: noShadowYear ? '#6ee7b7' : '#fde68a' }}>Verschattung</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: yearAnalysis.some(r => r.maxProfile >= geo.criticalAngle) ? '#ef4444' : '#22c55e' }}>
                    {yearAnalysis.some(r => r.maxProfile >= geo.criticalAngle) ? `${yearAnalysis.filter(r => r.maxProfile >= geo.criticalAngle).length} Monate betroffen` : 'Ganzjährig schattenfrei ✓'}
                  </div>
                </div>
              </div>
            </div>

            {/* Solar info cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Sonnenhöhe', val: solar.altitude > 0 ? solar.altitude.toFixed(1) + '°' : '—', col: solar.altitude > 0 ? '#fbbf24' : '#475569' },
                { label: 'Azimut', val: solar.altitude > 0 ? solar.azimuth.toFixed(1) + '°' : '—', col: solar.altitude > 0 ? '#f59e0b' : '#475569' },
                { label: 'Profilwinkel', val: profileAngle !== null && profileAngle > 0 ? profileAngle.toFixed(1) + '°' : sunBehind ? 'hinter Fassade' : '—', col: profileAngle !== null && profileAngle > 0 ? (isShadow ? '#ef4444' : '#22d3ee') : '#475569' },
              ].map((c, i) => (
                <div key={i} style={{ background: '#1e293b', borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>{c.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: c.col, marginTop: 2 }}>{c.val}</div>
                </div>
              ))}
              <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Jahres-Verschattung</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: annualShadowPct === 0 ? '#22c55e' : annualShadowPct < 5 ? '#f59e0b' : '#ef4444', marginTop: 2 }}>
                  {annualShadowPct.toFixed(1)}%
                </div>
                <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>der Sonnenstunden</div>
              </div>
            </div>

            {/* Diagrams */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activeViews.frontal && <FrontalView tilt={tilt} hour={hour} season={season} allSeasons={seasonDays} cfg={config} />}
              {activeViews.topdown && <TopDownView tilt={tilt} hour={hour} season={season} allSeasons={seasonDays} cfg={config} />}
              {activeViews.profile && <ProfileDiagram tilt={tilt} profileAngle={profileAngle !== null && profileAngle > 0 ? profileAngle : null} season={season} cfg={config} />}
            </div>

            <TiltComparisonChart currentTilt={tilt} cfg={config} />
            <MonthlyYieldChart currentTilt={tilt} cfg={config} />

            {/* Year table */}
            <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 24, marginBottom: 8 }}>Jahresübersicht bei {tilt}°</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #334155' }}>
                    <th style={{ textAlign: 'left', padding: '8px 6px', color: '#94a3b8' }}>Monat</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', color: '#94a3b8' }}>Max. Profilwinkel</th>
                    <th style={{ textAlign: 'center', padding: '8px 6px', color: '#94a3b8' }}>Verschattung</th>
                  </tr>
                </thead>
                <tbody>
                  {yearAnalysis.map(r => {
                    const has = r.maxProfile >= geo.criticalAngle;
                    return (
                      <tr key={r.month} style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '6px', fontWeight: 600 }}>{monthNames[r.month - 1]}</td>
                        <td style={{ padding: '6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: has ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                          {r.maxProfile.toFixed(1)}° <span style={{ fontSize: 10, color: '#64748b' }}>/ {geo.criticalAngle.toFixed(1)}°</span>
                        </td>
                        <td style={{ padding: '6px', textAlign: 'center', color: has ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                          {has ? `~${r.shadowH.toFixed(1)}h` : 'Keine'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
