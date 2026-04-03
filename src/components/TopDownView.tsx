import type { Config, SeasonDay } from '../types';
import {
  toRad,
  getPanelGeometry,
  getSolarPosition,
  getProfileAngle,
} from '../utils/solar';

interface TopDownViewProps {
  tilt: number;
  hour: number;
  season: SeasonDay;
  allSeasons: SeasonDay[];
  cfg: Config;
}

// ─────────────────────────────────────────────
// TOP-DOWN VIEW
// ─────────────────────────────────────────────
export function TopDownView({ tilt, hour, season, allSeasons, cfg }: TopDownViewProps) {
  const geo = getPanelGeometry(tilt, cfg);
  const totalPanelWidth = cfg.panelWidth * cfg.numPanels;
  const vw = 520;
  const vh = 440;
  const cx = vw / 2;
  const cy = vh / 2 + 20;
  const radius = 160;
  const bldgW = 50;

  const currentSol = getSolarPosition(season.day, hour, cfg);
  const profileAngle = currentSol.altitude > 0 ? getProfileAngle(currentSol.altitude, currentSol.azimuth, cfg) : null;
  const isBehind = currentSol.altitude > 0 && profileAngle === null;

  function azToXY(az: number, r: number) {
    const svgAngle = toRad(az);
    return { x: cx + r * Math.sin(svgAngle), y: cy - r * Math.cos(svgAngle) };
  }

  const facadeNorm = azToXY(cfg.facadeAzimuth, radius * 0.55);
  const facadePerp = cfg.facadeAzimuth + 90;
  const arcStart = cfg.facadeAzimuth - 90;
  const arcEnd = cfg.facadeAzimuth + 90;

  const allPaths = allSeasons.map(sd => {
    const pts: { x: number; y: number }[] = [];
    for (let h = 4; h <= 22; h += 0.15) {
      const s = getSolarPosition(sd.day, h, cfg);
      if (s.altitude <= 0) continue;
      const r = radius * (1 - (s.altitude / 90) * 0.4);
      pts.push(azToXY(s.azimuth, r));
    }
    return { ...sd, pts };
  });

  let sunPos: { x: number; y: number } | null = null;
  if (currentSol.altitude > 0) {
    const r = radius * (1 - (currentSol.altitude / 90) * 0.4);
    sunPos = azToXY(currentSol.azimuth, r);
  }
  const sunAzLine = currentSol.altitude > 0 ? azToXY(currentSol.azimuth, radius + 20) : null;

  function arcPath(startDeg: number, endDeg: number, r: number) {
    const s = azToXY(startDeg, r);
    const e = azToXY(endDeg, r);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  }

  const hourMarkers: { x: number; y: number; h: number }[] = [];
  for (let h = 5; h <= 21; h++) {
    const s = getSolarPosition(season.day, h, cfg);
    if (s.altitude <= 0) continue;
    const r = radius * (1 - (s.altitude / 90) * 0.4);
    const pos = azToXY(s.azimuth, r);
    hourMarkers.push({ ...pos, h });
  }

  const topSc = 0.14;
  const panelDepth = geo.panelD * topSc;
  const panelW = totalPanelWidth * topSc;
  const normR = toRad(cfg.facadeAzimuth);
  const perpR = toRad(facadePerp);
  const railDist = 30;
  const railCx = cx + railDist * Math.sin(normR);
  const railCy = cy - railDist * Math.cos(normR);

  function panelCorners() {
    const hw = panelW / 2;
    const corners: [number, number][] = [[0, -hw], [0, hw], [panelDepth, hw], [panelDepth, -hw]];
    return corners.map(([out, along]) => ({
      x: railCx + out * Math.sin(normR) + along * Math.sin(perpR),
      y: railCy - out * Math.cos(normR) - along * Math.cos(perpR),
    }));
  }

  const pCorners = panelCorners();
  const panelPts = pCorners.map(p => `${p.x},${p.y}`).join(' ');

  const dividers = Array.from({ length: cfg.numPanels - 1 }, (_, i) => {
    const frac = (i + 1) / cfg.numPanels;
    const along = panelW * frac - panelW / 2;
    return {
      x1: railCx + along * Math.sin(perpR),
      y1: railCy - along * Math.cos(perpR),
      x2: railCx + panelDepth * Math.sin(normR) + along * Math.sin(perpR),
      y2: railCy - panelDepth * Math.cos(normR) - along * Math.cos(perpR),
    };
  });

  const widthLabelPos = {
    x: railCx + (panelDepth + 12) * Math.sin(normR),
    y: railCy - (panelDepth + 12) * Math.cos(normR),
  };
  const depthMid = {
    x: railCx + (panelDepth / 2) * Math.sin(normR) + (panelW / 2 + 12) * Math.sin(perpR),
    y: railCy - (panelDepth / 2) * Math.cos(normR) - (panelW / 2 + 12) * Math.cos(perpR),
  };

  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width: '100%', background: '#0f172a', borderRadius: 12 }}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#1e293b" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={radius * 0.66} fill="none" stroke="#1e293b" strokeWidth={0.5} strokeDasharray="4,6" />
      <circle cx={cx} cy={cy} r={radius * 0.33} fill="none" stroke="#1e293b" strokeWidth={0.5} strokeDasharray="4,6" />

      {[{ label: 'N', az: 0 }, { label: 'O', az: 90 }, { label: 'S', az: 180 }, { label: 'W', az: 270 }].map(c => {
        const pos = azToXY(c.az, radius + 18);
        return <text key={c.label} x={pos.x} y={pos.y + 4} fill="#64748b" fontSize={12} fontWeight={700} textAnchor="middle">{c.label}</text>;
      })}

      <path d={arcPath(arcStart, arcEnd, radius + 6)} fill="none" stroke="#22c55e" strokeWidth={3} opacity={0.2} />
      <path d={arcPath(arcStart, arcEnd, radius + 6)} fill="none" stroke="#22c55e" strokeWidth={1} opacity={0.4} strokeDasharray="4,3" />

      {/* Building */}
      {(() => {
        const angle = toRad(cfg.facadeAzimuth);
        const hw = bldgW / 2;
        const hh = 35;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        // Shift building center inward so its facade face aligns with the panel rail
        const bx = cx - (hh - railDist) * sinA;
        const by = cy + (hh - railDist) * cosA;
        const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => ({
          x: bx + dx * cosA - dy * sinA, y: by + dx * sinA + dy * cosA
        }));
        return <polygon points={corners.map(p => `${p.x},${p.y}`).join(' ')} fill="#334155" stroke="#475569" strokeWidth={1.5} />;
      })()}

      {/* Facade normal */}
      <line x1={cx} y1={cy} x2={facadeNorm.x} y2={facadeNorm.y} stroke="#f97316" strokeWidth={2} opacity={0.6} />
      <circle cx={facadeNorm.x} cy={facadeNorm.y} r={3} fill="#f97316" />
      <text x={facadeNorm.x + 8} y={facadeNorm.y - 6} fill="#f97316" fontSize={9} fontWeight={600}>{cfg.facadeAzimuth}°</text>

      {/* Panels */}
      <polygon points={panelPts} fill="#22c55e" opacity={0.25} stroke="#4ade80" strokeWidth={1.5} />
      {dividers.map((d, i) => (
        <line key={i} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="#4ade80" strokeWidth={0.8} opacity={0.5} />
      ))}
      <text x={widthLabelPos.x} y={widthLabelPos.y} fill="#4ade80" fontSize={8} textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(${cfg.facadeAzimuth + 90}, ${widthLabelPos.x}, ${widthLabelPos.y})`}>
        {cfg.numPanels}×{cfg.panelWidth.toFixed(0)} = {totalPanelWidth.toFixed(0)} cm
      </text>
      <text x={depthMid.x} y={depthMid.y} fill="#4ade80" fontSize={8} textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(${cfg.facadeAzimuth}, ${depthMid.x}, ${depthMid.y})`}>
        {geo.panelD.toFixed(0)} cm
      </text>

      {/* Sun paths */}
      {allPaths.map((sp, si) => {
        if (sp.pts.length < 2) return null;
        const d = sp.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
        const isActive = sp.day === season.day;
        return <path key={si} d={d} fill="none" stroke={sp.color} strokeWidth={isActive ? 2.5 : 1} opacity={isActive ? 0.7 : 0.2} strokeDasharray={isActive ? 'none' : '4,4'} />;
      })}

      {hourMarkers.map(m => (
        <g key={m.h}>
          <circle cx={m.x} cy={m.y} r={2} fill={season.color} opacity={0.4} />
          <text x={m.x + 6} y={m.y + 3} fill={season.color} fontSize={8} opacity={0.5}>{m.h}h</text>
        </g>
      ))}

      {sunAzLine && sunPos && (
        <line x1={cx} y1={cy} x2={sunAzLine.x} y2={sunAzLine.y} stroke={isBehind ? '#475569' : '#fbbf24'} strokeWidth={1} opacity={0.3} strokeDasharray="4,4" />
      )}

      {sunPos && (
        <>
          <circle cx={sunPos.x} cy={sunPos.y} r={10} fill={isBehind ? '#475569' : '#fbbf24'} opacity={0.8} />
          <circle cx={sunPos.x} cy={sunPos.y} r={15} fill="none" stroke={isBehind ? '#475569' : '#fbbf24'} strokeWidth={1} opacity={0.3} strokeDasharray="3,3" />
          <text x={sunPos.x} y={sunPos.y - 18} fill={isBehind ? '#64748b' : '#fbbf24'} fontSize={9} fontWeight={700} textAnchor="middle">
            Az: {currentSol.azimuth.toFixed(0)}° · Alt: {currentSol.altitude.toFixed(1)}°
          </text>
        </>
      )}

      <text x={12} y={18} fill="#e2e8f0" fontSize={13} fontWeight={700}>Draufsicht (von oben)</text>
      <text x={12} y={34} fill="#94a3b8" fontSize={10}>{season.label}</text>

      <line x1={12} y1={vh - 48} x2={30} y2={vh - 48} stroke="#f97316" strokeWidth={2} />
      <text x={34} y={vh - 44} fill="#f97316" fontSize={9}>Fassaden-Normale ({cfg.facadeAzimuth}°)</text>
      <rect x={12} y={vh - 38} width={18} height={6} fill="#22c55e" opacity={0.25} stroke="#4ade80" strokeWidth={1} />
      <text x={34} y={vh - 30} fill="#22c55e" fontSize={9}>Panels ({cfg.numPanels}× {cfg.panelWidth.toFixed(0)}×{cfg.panelLength.toFixed(0)} cm)</text>
      <path d={`M 12 ${vh - 18} L 30 ${vh - 18}`} stroke="#22c55e" strokeWidth={1} opacity={0.4} strokeDasharray="4,3" />
      <text x={34} y={vh - 14} fill="#64748b" fontSize={9}>Aktiver Bereich (±90° zur Fassade)</text>

      {allSeasons.map((sd, i) => (
        <g key={i}>
          <line x1={vw - 190} y1={18 + i * 14} x2={vw - 172} y2={18 + i * 14} stroke={sd.color} strokeWidth={sd.day === season.day ? 2.5 : 1} strokeDasharray={sd.day === season.day ? 'none' : '4,4'} opacity={sd.day === season.day ? 0.8 : 0.4} />
          <text x={vw - 168} y={21 + i * 14} fill={sd.color} fontSize={9} opacity={sd.day === season.day ? 1 : 0.5}>{sd.label.split(' (')[0]}</text>
        </g>
      ))}
    </svg>
  );
}
