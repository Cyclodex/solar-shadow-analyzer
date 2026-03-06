import { useMemo } from 'react';
import type { Config } from '../types';
import {
  getDayOfYear,
  getPanelGeometry,
  getSolarPosition,
  getProfileAngle,
  getRelativeYield,
} from '../utils/solar';

interface TiltComparisonChartProps {
  currentTilt: number;
  cfg: Config;
}

const TILTS = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70];

// ─────────────────────────────────────────────
// TILT COMPARISON CHART
// ─────────────────────────────────────────────
export function TiltComparisonChart({ currentTilt, cfg }: TiltComparisonChartProps) {
  const data = useMemo(() => {
    const baseY = getRelativeYield(40, cfg);
    return TILTS.map(t => {
      const geo = getPanelGeometry(t, cfg);
      const relY = getRelativeYield(t, cfg) / baseY;
      const doy = getDayOfYear(6, 21);
      let sH = 0, maxP = 0;
      for (let h = 5; h <= 21; h += 0.25) {
        const sol = getSolarPosition(doy, h, cfg);
        if (sol.altitude <= 0) continue;
        const p = getProfileAngle(sol.altitude, sol.azimuth, cfg);
        if (p !== null && p > maxP) maxP = p;
        if (p !== null && p >= geo.criticalAngle) sH += 0.25;
      }
      return { tilt: t, critAngle: geo.criticalAngle, relYield: relY, shadowH: sH, noShadow: maxP < geo.criticalAngle };
    });
  }, [JSON.stringify(cfg)]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxY = Math.max(...data.map(d => d.relYield));

  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '16px 20px', marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Neigungswinkel-Vergleich</div>
      <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 60px 70px 80px', gap: '0', fontSize: 11, alignItems: 'center' }}>
        <div style={{ color: '#64748b', padding: '4px 0', fontWeight: 600 }}>Winkel</div>
        <div style={{ color: '#64748b', padding: '4px 8px', fontWeight: 600 }}>Ertrag (rel.)</div>
        <div style={{ color: '#64748b', padding: '4px 0', fontWeight: 600, textAlign: 'right' }}>Krit. ∠</div>
        <div style={{ color: '#64748b', padding: '4px 0', fontWeight: 600, textAlign: 'right' }}>Schatten</div>
        <div style={{ color: '#64748b', padding: '4px 0', fontWeight: 600, textAlign: 'center' }}></div>
        {data.map(d => {
          const isA = d.tilt === currentTilt;
          return (
            <div key={d.tilt} style={{ display: 'contents' }}>
              <div style={{ padding: '5px 0', fontWeight: isA ? 800 : 500, color: isA ? '#f8fafc' : '#94a3b8', fontSize: isA ? 13 : 11 }}>{d.tilt}°</div>
              <div style={{ padding: '5px 8px' }}>
                <div style={{ position: 'relative', height: 16, background: '#0f172a', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(d.relYield / maxY) * 100}%`, height: '100%', background: isA ? 'linear-gradient(90deg, #3b82f6, #60a5fa)' : 'linear-gradient(90deg, #334155, #475569)', borderRadius: 4 }} />
                  <span style={{ position: 'absolute', right: 6, top: 1, fontSize: 10, color: isA ? '#fff' : '#94a3b8', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{(d.relYield * 100).toFixed(1)}%</span>
                </div>
              </div>
              <div style={{ padding: '5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: isA ? '#fbbf24' : '#64748b', fontWeight: isA ? 700 : 400 }}>{d.critAngle.toFixed(1)}°</div>
              <div style={{ padding: '5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: d.noShadow ? '#22c55e' : d.shadowH <= 1.5 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>{d.noShadow ? '0h' : `~${d.shadowH.toFixed(1)}h`}</div>
              <div style={{ padding: '5px 0', textAlign: 'center' }}>
                {d.noShadow ? <span style={{ fontSize: 9, color: '#22c55e', fontWeight: 600 }}>✓ Schattenfrei</span>
                  : d.shadowH <= 1.5 ? <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 600 }}>Minimal</span>
                  : <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 600 }}>Spürbar</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 10 }}>Ertrag normiert auf 40° (≈ Optimum). Schatten = max. Stunden am 21. Juni.</div>
    </div>
  );
}
