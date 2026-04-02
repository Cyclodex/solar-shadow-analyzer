import { useMemo } from 'react';
import type { Config } from '../types';
import { getDayOfYear, getSolarPosition, toRad } from '../utils/solar';
import { monthNames } from '../constants';

interface MonthlyYieldChartProps {
  currentTilt: number;
  cfg: Config;
}

// ─────────────────────────────────────────────
// MONTHLY YIELD CHART
// ─────────────────────────────────────────────
export function MonthlyYieldChart({ currentTilt, cfg }: MonthlyYieldChartProps) {
  const compareTilts = [35, currentTilt, 55].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const tiltColors: Record<number, string> = { 35: '#f59e0b', 55: '#22c55e' };

  const data = useMemo(() => {
    const months: Record<string, number>[] = [];
    for (let m = 1; m <= 12; m++) {
      const doy = getDayOfYear(m, 15);
      const entry: Record<string, number> = { month: m };
      for (const t of compareTilts) {
        let mY = 0;
        for (let h = 5; h <= 21; h += 0.25) {
          const sol = getSolarPosition(doy, h, cfg);
          if (sol.altitude <= 2) continue;
          const cosInc =
            Math.sin(toRad(sol.altitude)) * Math.cos(toRad(t)) +
            Math.cos(toRad(sol.altitude)) *
              Math.sin(toRad(t)) *
              Math.cos(toRad(sol.azimuth - cfg.facadeAzimuth));
          if (cosInc > 0) mY += cosInc * 0.25;
        }
        entry[`t${t}`] = mY;
      }
      months.push(entry);
    }
    const mx = Math.max(...months.flatMap(e => compareTilts.map(t => e[`t${t}`])));
    for (const e of months) for (const t of compareTilts) e[`t${t}`] /= mx;
    return months;
  }, [currentTilt, JSON.stringify(cfg)]); // eslint-disable-line react-hooks/exhaustive-deps

  const barW = 28 / compareTilts.length;

  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '16px 20px', marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Monatsvergleich Ertragspotential</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        {compareTilts.map(t => (
          <span key={t} style={{ fontSize: 11, color: t === currentTilt ? '#60a5fa' : (tiltColors[t] || '#94a3b8'), fontWeight: t === currentTilt ? 700 : 400 }}>● {t}°{t === currentTilt ? ' (aktuell)' : ''}</span>
        ))}
      </div>
      <svg viewBox="0 0 400 140" style={{ width: '100%' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(v => <line key={v} x1={30} y1={120 - v * 100} x2={390} y2={120 - v * 100} stroke="#334155" strokeWidth={0.5} />)}
        {data.map((d, mi) => {
          const gx = 35 + mi * 30;
          return compareTilts.map((t, ti) => {
            const h = d[`t${t}`] * 100;
            const col = t === currentTilt ? '#3b82f6' : (tiltColors[t] || '#64748b');
            return <rect key={`${mi}-${t}`} x={gx + ti * barW} y={120 - h} width={barW - 1} height={h} fill={col} opacity={t === currentTilt ? 0.9 : 0.5} rx={1} />;
          });
        })}
        {data.map((d, mi) => <text key={mi} x={35 + mi * 30 + 12} y={134} fill="#64748b" fontSize={8} textAnchor="middle">{monthNames[(d['month'] as number) - 1]}</text>)}
        <text x={2} y={24} fill="#64748b" fontSize={7}>100%</text>
        <text x={8} y={72} fill="#64748b" fontSize={7}>50%</text>
      </svg>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>Steilere Winkel gewinnen im Winter, verlieren leicht im Sommer.</div>
    </div>
  );
}
