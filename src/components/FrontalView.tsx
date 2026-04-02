import type { Config, SeasonDay } from '../types';
import {
  getPanelGeometry,
  getSolarPosition,
  getProfileAngle,
} from '../utils/solar';

interface FrontalViewProps {
  tilt: number;
  hour: number;
  season: SeasonDay;
  allSeasons: SeasonDay[];
  cfg: Config;
}

// ─────────────────────────────────────────────
// FRONTAL VIEW
// ─────────────────────────────────────────────
export function FrontalView({ tilt, hour, season, allSeasons, cfg }: FrontalViewProps) {
  const geo = getPanelGeometry(tilt, cfg);
  const totalPanelWidth = cfg.panelWidth * cfg.numPanels;
  const vw = 600;
  const facadeTop = 225;
  const bsc = 0.38;
  const panelTotalW = totalPanelWidth * bsc;
  const singlePanelW = cfg.panelWidth * bsc;
  const facadeW = panelTotalW + 40;
  const facadeLeft = (vw - facadeW) / 2;
  const balcW = panelTotalW + 20;
  const balcLeft = (vw - balcW) / 2;
  const panelLeft = (vw - panelTotalW) / 2;
  const vertSc = 0.19;
  const floorSpacingPx = cfg.balconyHeight * vertSc;
  const groundY = Math.max(380, facadeTop + 36 + cfg.numFloors * floorSpacingPx + 40);
  const vh = groundY + 40;
  const railH = cfg.railingHeight * vertSc;
  const panelVisH = geo.panelH * vertSc;
  const skyRadius = 240;
  const skyCenterX = vw / 2;
  const skyCenterY = facadeTop;

  function sunToXY(alt: number, az: number) {
    const relAz = az - cfg.facadeAzimuth;
    const x = skyCenterX - (relAz / 90) * skyRadius;
    const y = skyCenterY - (alt / 90) * skyRadius * 0.95;
    return { x, y };
  }

  const allPaths = allSeasons.map(sd => {
    const pts: { x: number; y: number }[] = [];
    for (let h = 4; h <= 22; h += 0.15) {
      const s = getSolarPosition(sd.day, h, cfg);
      if (s.altitude <= 0) continue;
      const pos = sunToXY(s.altitude, s.azimuth);
      if (pos.x > 20 && pos.x < vw - 20) pts.push(pos);
    }
    return { ...sd, pts };
  });

  const currentSol = getSolarPosition(season.day, hour, cfg);
  const currentPos = currentSol.altitude > 0 ? sunToXY(currentSol.altitude, currentSol.azimuth) : null;
  const profileAngle = currentSol.altitude > 0 ? getProfileAngle(currentSol.altitude, currentSol.azimuth, cfg) : null;
  const isShadow = profileAngle !== null && profileAngle >= geo.criticalAngle;
  const isBehind = currentSol.altitude > 0 && profileAngle === null;

  const hourMarkers: { x: number; y: number; h: number }[] = [];
  for (let h = 6; h <= 20; h++) {
    const s = getSolarPosition(season.day, h, cfg);
    if (s.altitude <= 0) continue;
    const pos = sunToXY(s.altitude, s.azimuth);
    if (pos.x > 30 && pos.x < vw - 30) hourMarkers.push({ ...pos, h });
  }

  const floorColors = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
  const floorStrokes = ['#fb923c', '#4ade80', '#60a5fa', '#c084fc', '#f472b6'];

  function renderBalcony(balcY: number, panelColor: string, panelStroke: string, label: string) {
    return (
      <>
        <rect x={balcLeft - 6} y={balcY} width={balcW + 12} height={4} fill="#475569" />
        {Array.from({ length: Math.round(balcW / 16) + 1 }).map((_, i) => (
          <line key={i} x1={balcLeft + i * 16} y1={balcY} x2={balcLeft + i * 16} y2={balcY - railH} stroke="#78716c" strokeWidth={1.2} />
        ))}
        <rect x={balcLeft - 2} y={balcY - railH - 2} width={balcW + 4} height={3} fill="#78716c" rx={1} />
        {Array.from({ length: cfg.numPanels }).map((_, pi) => (
          <rect key={pi} x={panelLeft + pi * (singlePanelW + 2)} y={balcY - railH}
            width={singlePanelW - 2} height={panelVisH}
            fill={panelColor} opacity={0.7} stroke={panelStroke} strokeWidth={1} rx={2} />
        ))}
        <text x={vw / 2} y={balcY - railH + panelVisH / 2 + 3}
          fill="#fff" fontSize={8} fontWeight={700} textAnchor="middle" opacity={0.9}>{label}</text>
      </>
    );
  }

  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width: '100%', background: '#0f172a', borderRadius: 12 }}>
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c1e3a" />
          <stop offset="60%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#1a1a2e" />
        </linearGradient>
        <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={isShadow ? '#ef4444' : '#fbbf24'} stopOpacity="0.4" />
          <stop offset="100%" stopColor={isShadow ? '#ef4444' : '#fbbf24'} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width={vw} height={vh} fill="url(#skyGrad)" />
      <rect x="0" y={groundY} width={vw} height={vh - groundY} fill="#1e293b" />

      {[15, 30, 45, 60, 75].map(a => {
        const y = skyCenterY - (a / 90) * skyRadius * 0.95;
        return (
          <g key={a}>
            <line x1={40} y1={y} x2={vw - 40} y2={y} stroke="#1e293b" strokeWidth={0.5} strokeDasharray="4,6" />
            <text x={18} y={y + 3} fill="#334155" fontSize={8}>{a}°</text>
          </g>
        );
      })}

      <text x={vw - 55} y={facadeTop - 6} fill="#475569" fontSize={10} fontWeight={600}>→ O</text>
      <text x={30} y={facadeTop - 6} fill="#475569" fontSize={10} fontWeight={600}>W ←</text>
      <text x={skyCenterX - 4} y={facadeTop - 6} fill="#64748b" fontSize={9}>S</text>

      {allPaths.map((sp, si) => {
        if (sp.pts.length < 2) return null;
        const d = sp.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
        const isActive = sp.day === season.day;
        return <path key={si} d={d} fill="none" stroke={sp.color} strokeWidth={isActive ? 2 : 1} opacity={isActive ? 0.7 : 0.2} strokeDasharray={isActive ? 'none' : '4,4'} />;
      })}

      {hourMarkers.map(m => (
        <g key={m.h}>
          <circle cx={m.x} cy={m.y} r={2} fill={season.color} opacity={0.4} />
          <text x={m.x} y={m.y - 7} fill={season.color} fontSize={8} textAnchor="middle" opacity={0.5}>{m.h}h</text>
        </g>
      ))}

      {/* Building facade */}
      <rect x={facadeLeft} y={facadeTop} width={facadeW} height={groundY - facadeTop} fill="#1e293b" stroke="#334155" strokeWidth={1.5} />
      {/* Windows */}
      {Array.from({ length: cfg.numFloors }).map((_, row) => {
        const wy = facadeTop + 10 + row * floorSpacingPx;
        const numWin = Math.floor(facadeW / 44);
        const winGap = facadeW / (numWin + 1);
        return Array.from({ length: numWin }).map((_, col) => (
          <rect key={`w${row}${col}`} x={facadeLeft + winGap * (col + 1) - 14} y={wy}
            width={28} height={20} fill="#0f172a" stroke="#334155" strokeWidth={0.8} rx={1} />
        ));
      })}

      {/* Balconies */}
      {Array.from({ length: cfg.numFloors }).map((_, i) => {
        const balcY = facadeTop + 36 + i * floorSpacingPx;
        const label = `${cfg.numPanels}× Panel ${i + 1}. OG (${cfg.panelWidth.toFixed(0)}×${cfg.panelLength.toFixed(0)} cm)`;
        return (
          <g key={i}>
            {renderBalcony(balcY, floorColors[i] || '#22c55e', floorStrokes[i] || '#4ade80', label)}
          </g>
        );
      })}

      {/* Panel width annotation on lowest floor */}
      {(() => {
        const lastFloorY = facadeTop + 36 + (cfg.numFloors - 1) * floorSpacingPx;
        return (
          <>
            <line x1={panelLeft} y1={lastFloorY + 10} x2={panelLeft + panelTotalW} y2={lastFloorY + 10} stroke="#94a3b8" strokeWidth={0.8} />
            <line x1={panelLeft} y1={lastFloorY + 6} x2={panelLeft} y2={lastFloorY + 14} stroke="#94a3b8" strokeWidth={0.8} />
            <line x1={panelLeft + panelTotalW} y1={lastFloorY + 6} x2={panelLeft + panelTotalW} y2={lastFloorY + 14} stroke="#94a3b8" strokeWidth={0.8} />
            <text x={vw / 2} y={lastFloorY + 22} fill="#94a3b8" fontSize={8} textAnchor="middle">
              {totalPanelWidth.toFixed(0)} cm ({cfg.numPanels}×{cfg.panelWidth.toFixed(0)})
            </text>
          </>
        );
      })()}

      {/* Sun */}
      {currentPos && currentPos.x > 10 && currentPos.x < vw - 10 && (
        <>
          <circle cx={currentPos.x} cy={currentPos.y} r={40} fill="url(#sunGlow)" />
          <circle cx={currentPos.x} cy={currentPos.y} r={14} fill={isShadow ? '#ef4444' : isBehind ? '#475569' : '#fbbf24'} />
          <circle cx={currentPos.x} cy={currentPos.y} r={20} fill="none" stroke={isShadow ? '#ef4444' : isBehind ? '#475569' : '#fbbf24'} strokeWidth={1} opacity={0.3} strokeDasharray="3,3" />
          {!isBehind && profileAngle !== null && profileAngle > 0 && (
            <line x1={currentPos.x} y1={currentPos.y + 14}
              x2={vw / 2} y2={facadeTop + 36 - railH + panelVisH / 2}
              stroke={isShadow ? '#ef4444' : '#fbbf24'} strokeWidth={1.5} opacity={0.3} strokeDasharray="6,4" />
          )}
          <text x={currentPos.x} y={currentPos.y - 24} fill={isShadow ? '#ef4444' : isBehind ? '#64748b' : '#fbbf24'} fontSize={10} fontWeight={700} textAnchor="middle">
            {currentSol.altitude.toFixed(1)}° {isBehind ? '(hinter Fassade)' : ''}
          </text>
        </>
      )}

      <text x={12} y={18} fill="#e2e8f0" fontSize={13} fontWeight={700}>Frontalansicht (von Süden)</text>
      <text x={12} y={34} fill="#94a3b8" fontSize={10}>{season.label}</text>
      {allSeasons.map((sd, i) => (
        <g key={i}>
          <line x1={vw - 195} y1={18 + i * 14} x2={vw - 175} y2={18 + i * 14} stroke={sd.color} strokeWidth={sd.day === season.day ? 2 : 1} strokeDasharray={sd.day === season.day ? 'none' : '4,4'} opacity={sd.day === season.day ? 0.8 : 0.4} />
          <text x={vw - 170} y={21 + i * 14} fill={sd.color} fontSize={9} opacity={sd.day === season.day ? 1 : 0.5}>{sd.label.split(' (')[0]}</text>
        </g>
      ))}
    </svg>
  );
}
