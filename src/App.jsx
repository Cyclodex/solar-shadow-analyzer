import { useState, useMemo } from "react";

// ─────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────
const DEFAULT_CONFIG = {
  latitude: 47.1,
  longitude: 7.45,
  facadeAzimuth: 213,
  balconyHeight: 280,
  railingHeight: 100,
  panelLength: 113.4,
  panelWidth: 176.2,
  numPanels: 2,
  numFloors: 2,
  panelTilt: 45,
  panelThickness: 3, // not user-editable, kept for rendering
};

// ─────────────────────────────────────────────
// PURE FUNCTIONS
// ─────────────────────────────────────────────
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

function getPanelGeometry(tilt, cfg) {
  const pH = cfg.panelLength * Math.sin(toRad(tilt));
  const pD = cfg.panelLength * Math.cos(toRad(tilt));
  const vGap = cfg.balconyHeight - pH;
  const crit = toDeg(Math.atan(vGap / pD));
  return { panelH: pH, panelD: pD, verticalGap: vGap, criticalAngle: crit };
}

function getSolarPosition(dayOfYear, hour, cfg) {
  const decl = 23.45 * Math.sin(toRad((360 / 365) * (dayOfYear - 81)));
  const latR = toRad(cfg.latitude);
  const declR = toRad(decl);
  const hAngle = (hour - 12) * 15;
  const hRad = toRad(hAngle);
  const sinAlt = Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(hRad);
  const alt = toDeg(Math.asin(sinAlt));
  const cosAz = (Math.sin(declR) - Math.sin(latR) * sinAlt) / (Math.cos(latR) * Math.cos(toRad(alt)));
  let az = toDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
  if (hAngle > 0) az = 360 - az;
  return { altitude: alt, azimuth: az };
}

function getProfileAngle(alt, az, cfg) {
  const diff = toRad(az - cfg.facadeAzimuth);
  const cosDiff = Math.cos(diff);
  if (cosDiff <= 0) return null;
  return toDeg(Math.atan(Math.tan(toRad(alt)) / cosDiff));
}

function getDayOfYear(m, d) {
  const t = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return t[m - 1] + d;
}

function getRelativeYield(tilt, cfg) {
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const doy = getDayOfYear(m, 15);
    for (let h = 5; h <= 21; h += 0.25) {
      const sol = getSolarPosition(doy, h, cfg);
      if (sol.altitude <= 2) continue;
      const cosInc =
        Math.sin(toRad(sol.altitude)) * Math.cos(toRad(tilt)) +
        Math.cos(toRad(sol.altitude)) * Math.sin(toRad(tilt)) * Math.cos(toRad(sol.azimuth - cfg.facadeAzimuth));
      if (cosInc > 0) total += cosInc * 0.25;
    }
  }
  return total;
}

const monthNames = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const seasonDays = [
  { label: "Wintersonnenwende (21. Dez)", day: getDayOfYear(12, 21), color: "#3b82f6" },
  { label: "Tagundnachtgleiche (20. Mär)", day: getDayOfYear(3, 20), color: "#f59e0b" },
  { label: "Sommersonnenwende (21. Jun)", day: getDayOfYear(6, 21), color: "#ef4444" },
];

// ─────────────────────────────────────────────
// TOP-DOWN VIEW
// ─────────────────────────────────────────────
function TopDownView({ tilt, hour, season, allSeasons, cfg }) {
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

  function azToXY(az, r) {
    const svgAngle = toRad(az);
    return { x: cx + r * Math.sin(svgAngle), y: cy - r * Math.cos(svgAngle) };
  }

  const facadeNorm = azToXY(cfg.facadeAzimuth, radius * 0.55);
  const facadePerp = cfg.facadeAzimuth + 90;
  const arcStart = cfg.facadeAzimuth - 90;
  const arcEnd = cfg.facadeAzimuth + 90;

  const allPaths = allSeasons.map(sd => {
    const pts = [];
    for (let h = 4; h <= 22; h += 0.15) {
      const s = getSolarPosition(sd.day, h, cfg);
      if (s.altitude <= 0) continue;
      const r = radius * (1 - s.altitude / 90 * 0.4);
      pts.push(azToXY(s.azimuth, r));
    }
    return { ...sd, pts };
  });

  let sunPos = null;
  if (currentSol.altitude > 0) {
    const r = radius * (1 - currentSol.altitude / 90 * 0.4);
    sunPos = azToXY(currentSol.azimuth, r);
  }
  const sunAzLine = currentSol.altitude > 0 ? azToXY(currentSol.azimuth, radius + 20) : null;

  function arcPath(startDeg, endDeg, r) {
    const s = azToXY(startDeg, r);
    const e = azToXY(endDeg, r);
    const largeArc = (endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  }

  const hourMarkers = [];
  for (let h = 5; h <= 21; h++) {
    const s = getSolarPosition(season.day, h, cfg);
    if (s.altitude <= 0) continue;
    const r = radius * (1 - s.altitude / 90 * 0.4);
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
    const corners = [[0, -hw], [0, hw], [panelDepth, hw], [panelDepth, -hw]];
    return corners.map(([out, along]) => ({
      x: railCx + out * Math.sin(normR) + along * Math.sin(perpR),
      y: railCy - out * Math.cos(normR) - along * Math.cos(perpR),
    }));
  }

  const pCorners = panelCorners();
  const panelPts = pCorners.map(p => `${p.x},${p.y}`).join(" ");

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
    <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width: "100%", background: "#0f172a", borderRadius: 12 }}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#1e293b" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={radius * 0.66} fill="none" stroke="#1e293b" strokeWidth={0.5} strokeDasharray="4,6" />
      <circle cx={cx} cy={cy} r={radius * 0.33} fill="none" stroke="#1e293b" strokeWidth={0.5} strokeDasharray="4,6" />

      {[{ label: "N", az: 0 }, { label: "O", az: 90 }, { label: "S", az: 180 }, { label: "W", az: 270 }].map(c => {
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
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => ({
          x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos
        }));
        return <polygon points={corners.map(p => `${p.x},${p.y}`).join(" ")} fill="#334155" stroke="#475569" strokeWidth={1.5} />;
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
        const d = sp.pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        const isActive = sp.day === season.day;
        return <path key={si} d={d} fill="none" stroke={sp.color} strokeWidth={isActive ? 2.5 : 1} opacity={isActive ? 0.7 : 0.2} strokeDasharray={isActive ? "none" : "4,4"} />;
      })}

      {hourMarkers.map(m => (
        <g key={m.h}>
          <circle cx={m.x} cy={m.y} r={2} fill={season.color} opacity={0.4} />
          <text x={m.x + 6} y={m.y + 3} fill={season.color} fontSize={8} opacity={0.5}>{m.h}h</text>
        </g>
      ))}

      {sunAzLine && sunPos && (
        <line x1={cx} y1={cy} x2={sunAzLine.x} y2={sunAzLine.y} stroke={isBehind ? "#475569" : "#fbbf24"} strokeWidth={1} opacity={0.3} strokeDasharray="4,4" />
      )}

      {sunPos && (
        <>
          <circle cx={sunPos.x} cy={sunPos.y} r={10} fill={isBehind ? "#475569" : "#fbbf24"} opacity={0.8} />
          <circle cx={sunPos.x} cy={sunPos.y} r={15} fill="none" stroke={isBehind ? "#475569" : "#fbbf24"} strokeWidth={1} opacity={0.3} strokeDasharray="3,3" />
          <text x={sunPos.x} y={sunPos.y - 18} fill={isBehind ? "#64748b" : "#fbbf24"} fontSize={9} fontWeight={700} textAnchor="middle">
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
          <line x1={vw - 190} y1={18 + i * 14} x2={vw - 172} y2={18 + i * 14} stroke={sd.color} strokeWidth={sd.day === season.day ? 2.5 : 1} strokeDasharray={sd.day === season.day ? "none" : "4,4"} opacity={sd.day === season.day ? 0.8 : 0.4} />
          <text x={vw - 168} y={21 + i * 14} fill={sd.color} fontSize={9} opacity={sd.day === season.day ? 1 : 0.5}>{sd.label.split(" (")[0]}</text>
        </g>
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────
// FRONTAL VIEW
// ─────────────────────────────────────────────
function FrontalView({ tilt, hour, season, allSeasons, cfg }) {
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

  function sunToXY(alt, az) {
    const relAz = az - cfg.facadeAzimuth;
    const x = skyCenterX - (relAz / 90) * skyRadius;
    const y = skyCenterY - (alt / 90) * skyRadius * 0.95;
    return { x, y };
  }

  const allPaths = allSeasons.map(sd => {
    const pts = [];
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

  const hourMarkers = [];
  for (let h = 6; h <= 20; h++) {
    const s = getSolarPosition(season.day, h, cfg);
    if (s.altitude <= 0) continue;
    const pos = sunToXY(s.altitude, s.azimuth);
    if (pos.x > 30 && pos.x < vw - 30) hourMarkers.push({ ...pos, h });
  }

  const floorColors = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
  const floorStrokes = ["#fb923c", "#4ade80", "#60a5fa", "#c084fc", "#f472b6"];

  function renderBalcony(balcY, panelColor, panelStroke, label) {
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
    <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width: "100%", background: "#0f172a", borderRadius: 12 }}>
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c1e3a" />
          <stop offset="60%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#1a1a2e" />
        </linearGradient>
        <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={isShadow ? "#ef4444" : "#fbbf24"} stopOpacity="0.4" />
          <stop offset="100%" stopColor={isShadow ? "#ef4444" : "#fbbf24"} stopOpacity="0" />
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
        const d = sp.pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        const isActive = sp.day === season.day;
        return <path key={si} d={d} fill="none" stroke={sp.color} strokeWidth={isActive ? 2 : 1} opacity={isActive ? 0.7 : 0.2} strokeDasharray={isActive ? "none" : "4,4"} />;
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
            {renderBalcony(balcY, floorColors[i] || "#22c55e", floorStrokes[i] || "#4ade80", label)}
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
          <circle cx={currentPos.x} cy={currentPos.y} r={14} fill={isShadow ? "#ef4444" : isBehind ? "#475569" : "#fbbf24"} />
          <circle cx={currentPos.x} cy={currentPos.y} r={20} fill="none" stroke={isShadow ? "#ef4444" : isBehind ? "#475569" : "#fbbf24"} strokeWidth={1} opacity={0.3} strokeDasharray="3,3" />
          {!isBehind && profileAngle !== null && profileAngle > 0 && (
            <line x1={currentPos.x} y1={currentPos.y + 14}
              x2={vw / 2} y2={facadeTop + 36 - railH + panelVisH / 2}
              stroke={isShadow ? "#ef4444" : "#fbbf24"} strokeWidth={1.5} opacity={0.3} strokeDasharray="6,4" />
          )}
          <text x={currentPos.x} y={currentPos.y - 24} fill={isShadow ? "#ef4444" : isBehind ? "#64748b" : "#fbbf24"} fontSize={10} fontWeight={700} textAnchor="middle">
            {currentSol.altitude.toFixed(1)}° {isBehind ? "(hinter Fassade)" : ""}
          </text>
        </>
      )}

      <text x={12} y={18} fill="#e2e8f0" fontSize={13} fontWeight={700}>Frontalansicht (von Süden)</text>
      <text x={12} y={34} fill="#94a3b8" fontSize={10}>{season.label}</text>
      {allSeasons.map((sd, i) => (
        <g key={i}>
          <line x1={vw - 195} y1={18 + i * 14} x2={vw - 175} y2={18 + i * 14} stroke={sd.color} strokeWidth={sd.day === season.day ? 2 : 1} strokeDasharray={sd.day === season.day ? "none" : "4,4"} opacity={sd.day === season.day ? 0.8 : 0.4} />
          <text x={vw - 170} y={21 + i * 14} fill={sd.color} fontSize={9} opacity={sd.day === season.day ? 1 : 0.5}>{sd.label.split(" (")[0]}</text>
        </g>
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────
// PROFILE (SIDE) VIEW
// ─────────────────────────────────────────────
function ProfileDiagram({ tilt, profileAngle, season, cfg }) {
  const { panelH, panelD, criticalAngle } = getPanelGeometry(tilt, cfg);
  const sc = 0.28;
  const wallX = 130;
  const upperSlabY = 70;
  const lowerSlabY = upperSlabY + cfg.balconyHeight * sc;
  const railOffsetX = 55;
  const railX = wallX + railOffsetX;
  const upperRailTopY = upperSlabY - cfg.railingHeight * sc;
  const lowerRailTopY = lowerSlabY - cfg.railingHeight * sc;
  const upTop = { x: railX, y: upperRailTopY };
  const upBot = { x: railX + panelD * sc, y: upperRailTopY + panelH * sc };
  const loTop = { x: railX, y: lowerRailTopY };
  const isShadow = profileAngle !== null && profileAngle >= criticalAngle;
  const thickPx = cfg.panelThickness * sc;

  return (
    <svg viewBox="0 0 480 340" style={{ width: "100%", background: "#0f172a", borderRadius: 12 }}>
      <rect x={wallX - 30} y={upperRailTopY - 20} width={32} height={lowerSlabY - upperRailTopY + 50} fill="#1e293b" stroke="#334155" strokeWidth={1} />
      <rect x={wallX} y={upperSlabY - 4} width={railOffsetX + 6} height={7} fill="#475569" rx={1} />
      <line x1={railX + 1} y1={upperSlabY - 4} x2={railX + 1} y2={upperRailTopY} stroke="#78716c" strokeWidth={2.5} />
      <rect x={railX - 4} y={upperRailTopY - 3} width={10} height={5} fill="#78716c" rx={1} />
      <rect x={wallX} y={lowerSlabY - 4} width={railOffsetX + 6} height={7} fill="#475569" rx={1} />
      <line x1={railX + 1} y1={lowerSlabY - 4} x2={railX + 1} y2={lowerRailTopY} stroke="#78716c" strokeWidth={2.5} />
      <rect x={railX - 4} y={lowerRailTopY - 3} width={10} height={5} fill="#78716c" rx={1} />

      <line x1={wallX - 42} y1={upperSlabY} x2={wallX - 42} y2={lowerSlabY} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,3" />
      <line x1={wallX - 48} y1={upperSlabY} x2={wallX - 36} y2={upperSlabY} stroke="#94a3b8" strokeWidth={1} />
      <line x1={wallX - 48} y1={lowerSlabY} x2={wallX - 36} y2={lowerSlabY} stroke="#94a3b8" strokeWidth={1} />
      <text x={wallX - 78} y={(upperSlabY + lowerSlabY) / 2 + 4} fill="#94a3b8" fontSize={9} fontWeight={600}>{cfg.balconyHeight} cm</text>

      {/* Upper panel */}
      {(() => {
        const angle = toRad(tilt);
        const nx = -Math.sin(angle) * thickPx;
        const ny = Math.cos(angle) * thickPx;
        return (
          <polygon
            points={`${upTop.x},${upTop.y} ${upBot.x},${upBot.y} ${upBot.x + nx},${upBot.y + ny} ${upTop.x + nx},${upTop.y + ny}`}
            fill="#f97316" opacity={0.8} stroke="#fb923c" strokeWidth={1} />
        );
      })()}
      <text x={upBot.x + 10} y={(upTop.y + upBot.y) / 2 + 2} fill="#f97316" fontSize={10} fontWeight={700}>Oberes Panel</text>

      {/* Lower panel */}
      {(() => {
        const loBot = { x: loTop.x + panelD * sc, y: loTop.y + panelH * sc };
        const angle = toRad(tilt);
        const nx = -Math.sin(angle) * thickPx;
        const ny = Math.cos(angle) * thickPx;
        return (
          <polygon
            points={`${loTop.x},${loTop.y} ${loBot.x},${loBot.y} ${loBot.x + nx},${loBot.y + ny} ${loTop.x + nx},${loTop.y + ny}`}
            fill="#22c55e" opacity={0.8} stroke="#4ade80" strokeWidth={1} />
        );
      })()}
      <text x={loTop.x + panelD * sc + 10} y={(loTop.y + loTop.y + panelH * sc) / 2 + 2} fill="#22c55e" fontSize={10} fontWeight={700}>Unteres Panel</text>

      {/* Critical angle line */}
      {(() => {
        const dx = upBot.x - loTop.x;
        const dy = loTop.y - upBot.y;
        const ext = 1.7;
        return <line x1={loTop.x} y1={loTop.y} x2={loTop.x + dx * ext} y2={loTop.y - dy * ext} stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.5} />;
      })()}

      {/* Gap annotations */}
      {(() => {
        const annotX = upBot.x + 52;
        const vGap = cfg.balconyHeight - panelH;
        return (
          <>
            <line x1={annotX} y1={upBot.y} x2={annotX} y2={loTop.y} stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3,2" />
            <line x1={annotX - 5} y1={upBot.y} x2={annotX + 5} y2={upBot.y} stroke="#94a3b8" strokeWidth={0.8} />
            <line x1={annotX - 5} y1={loTop.y} x2={annotX + 5} y2={loTop.y} stroke="#94a3b8" strokeWidth={0.8} />
            <text x={annotX + 6} y={(upBot.y + loTop.y) / 2 + 3} fill="#94a3b8" fontSize={8}>{vGap.toFixed(0)}cm</text>
            <line x1={loTop.x} y1={loTop.y + 14} x2={upBot.x} y2={loTop.y + 14} stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3,2" />
            <text x={(loTop.x + upBot.x) / 2 - 12} y={loTop.y + 24} fill="#94a3b8" fontSize={8}>{panelD.toFixed(0)}cm</text>
          </>
        );
      })()}

      {/* Sun ray */}
      {profileAngle !== null && profileAngle > 0 && (() => {
        const rayRad = toRad(profileAngle);
        const diagLen = 180;
        const endX = loTop.x + diagLen * Math.cos(rayRad);
        const endY = loTop.y - diagLen * Math.sin(rayRad);
        const col = isShadow ? "#ef4444" : "#38bdf8";
        return (
          <>
            <line x1={loTop.x} y1={loTop.y} x2={endX} y2={endY} stroke={col} strokeWidth={2} opacity={0.6} />
            <circle cx={endX} cy={endY} r={10} fill={isShadow ? "#ef4444" : "#fbbf24"} opacity={0.8} />
            <circle cx={endX} cy={endY} r={15} fill="none" stroke={isShadow ? "#ef4444" : "#fbbf24"} strokeWidth={1} opacity={0.3} strokeDasharray="3,3" />
            <text x={endX - 30} y={endY - 18} fill={col} fontSize={10} fontWeight={700}>{profileAngle.toFixed(1)}°</text>
          </>
        );
      })()}

      <text x={12} y={18} fill="#e2e8f0" fontSize={13} fontWeight={700}>Seitenansicht — Neigung {tilt}°</text>
      <text x={12} y={34} fill="#94a3b8" fontSize={10}>
        {season ? season.label : ""}{profileAngle !== null && profileAngle > 0 ? ` · Profil: ${profileAngle.toFixed(1)}°` : ""}
      </text>
      <text x={wallX - 18} y={lowerSlabY + 26} fill="#475569" fontSize={9}>← Gebäude</text>
      <text x={railX + panelD * sc + 10} y={lowerSlabY + 26} fill="#475569" fontSize={9}>Aussen →</text>
      <text x={12} y={lowerSlabY + panelH * sc + 44} fill="#64748b" fontSize={9}>
        Panel: {cfg.panelLength}×{cfg.panelWidth}×{cfg.panelThickness} cm · Querschnitt
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────
// TILT COMPARISON CHART
// ─────────────────────────────────────────────
function TiltComparisonChart({ currentTilt, cfg }) {
  const tilts = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70];
  const data = useMemo(() => {
    const baseY = getRelativeYield(40, cfg);
    return tilts.map(t => {
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
  }, [JSON.stringify(cfg)]);

  const maxY = Math.max(...data.map(d => d.relYield));

  return (
    <div style={{ background: "#1e293b", borderRadius: 12, padding: "16px 20px", marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Neigungswinkel-Vergleich</div>
      <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 60px 70px 80px", gap: "0", fontSize: 11, alignItems: "center" }}>
        <div style={{ color: "#64748b", padding: "4px 0", fontWeight: 600 }}>Winkel</div>
        <div style={{ color: "#64748b", padding: "4px 8px", fontWeight: 600 }}>Ertrag (rel.)</div>
        <div style={{ color: "#64748b", padding: "4px 0", fontWeight: 600, textAlign: "right" }}>Krit. ∠</div>
        <div style={{ color: "#64748b", padding: "4px 0", fontWeight: 600, textAlign: "right" }}>Schatten</div>
        <div style={{ color: "#64748b", padding: "4px 0", fontWeight: 600, textAlign: "center" }}></div>
        {data.map(d => {
          const isA = d.tilt === currentTilt;
          return (
            <div key={d.tilt} style={{ display: "contents" }}>
              <div style={{ padding: "5px 0", fontWeight: isA ? 800 : 500, color: isA ? "#f8fafc" : "#94a3b8", fontSize: isA ? 13 : 11 }}>{d.tilt}°</div>
              <div style={{ padding: "5px 8px" }}>
                <div style={{ position: "relative", height: 16, background: "#0f172a", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${(d.relYield / maxY) * 100}%`, height: "100%", background: isA ? "linear-gradient(90deg, #3b82f6, #60a5fa)" : "linear-gradient(90deg, #334155, #475569)", borderRadius: 4 }} />
                  <span style={{ position: "absolute", right: 6, top: 1, fontSize: 10, color: isA ? "#fff" : "#94a3b8", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{(d.relYield * 100).toFixed(1)}%</span>
                </div>
              </div>
              <div style={{ padding: "5px 0", textAlign: "right", fontVariantNumeric: "tabular-nums", color: isA ? "#fbbf24" : "#64748b", fontWeight: isA ? 700 : 400 }}>{d.critAngle.toFixed(1)}°</div>
              <div style={{ padding: "5px 0", textAlign: "right", fontVariantNumeric: "tabular-nums", color: d.noShadow ? "#22c55e" : d.shadowH <= 1.5 ? "#f59e0b" : "#ef4444", fontWeight: 600 }}>{d.noShadow ? "0h" : `~${d.shadowH.toFixed(1)}h`}</div>
              <div style={{ padding: "5px 0", textAlign: "center" }}>
                {d.noShadow ? <span style={{ fontSize: 9, color: "#22c55e", fontWeight: 600 }}>✓ Schattenfrei</span>
                  : d.shadowH <= 1.5 ? <span style={{ fontSize: 9, color: "#f59e0b", fontWeight: 600 }}>Minimal</span>
                  : <span style={{ fontSize: 9, color: "#ef4444", fontWeight: 600 }}>Spürbar</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 10 }}>Ertrag normiert auf 40° (≈ Optimum). Schatten = max. Stunden am 21. Juni.</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MONTHLY YIELD CHART
// ─────────────────────────────────────────────
function MonthlyYieldChart({ currentTilt, cfg }) {
  const compareTilts = [35, currentTilt, 55].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const tiltColors = { 35: "#f59e0b", 55: "#22c55e" };
  const data = useMemo(() => {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const doy = getDayOfYear(m, 15);
      const entry = { month: m };
      for (const t of compareTilts) {
        let mY = 0;
        for (let h = 5; h <= 21; h += 0.25) {
          const sol = getSolarPosition(doy, h, cfg);
          if (sol.altitude <= 2) continue;
          const cosInc =
            Math.sin(toRad(sol.altitude)) * Math.cos(toRad(t)) +
            Math.cos(toRad(sol.altitude)) * Math.sin(toRad(t)) * Math.cos(toRad(sol.azimuth - cfg.facadeAzimuth));
          if (cosInc > 0) mY += cosInc * 0.25;
        }
        entry[`t${t}`] = mY;
      }
      months.push(entry);
    }
    const mx = Math.max(...months.flatMap(e => compareTilts.map(t => e[`t${t}`])));
    for (const e of months) for (const t of compareTilts) e[`t${t}`] /= mx;
    return months;
  }, [currentTilt, JSON.stringify(cfg)]);
  const barW = 28 / compareTilts.length;

  return (
    <div style={{ background: "#1e293b", borderRadius: 12, padding: "16px 20px", marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Monatsvergleich Ertragspotential</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        {compareTilts.map(t => (
          <span key={t} style={{ fontSize: 11, color: t === currentTilt ? "#60a5fa" : (tiltColors[t] || "#94a3b8"), fontWeight: t === currentTilt ? 700 : 400 }}>● {t}°{t === currentTilt ? " (aktuell)" : ""}</span>
        ))}
      </div>
      <svg viewBox="0 0 400 140" style={{ width: "100%" }}>
        {[0, 0.25, 0.5, 0.75, 1].map(v => <line key={v} x1={30} y1={120 - v * 100} x2={390} y2={120 - v * 100} stroke="#334155" strokeWidth={0.5} />)}
        {data.map((d, mi) => {
          const gx = 35 + mi * 30;
          return compareTilts.map((t, ti) => {
            const h = d[`t${t}`] * 100;
            const col = t === currentTilt ? "#3b82f6" : (tiltColors[t] || "#64748b");
            return <rect key={`${mi}-${t}`} x={gx + ti * barW} y={120 - h} width={barW - 1} height={h} fill={col} opacity={t === currentTilt ? 0.9 : 0.5} rx={1} />;
          });
        })}
        {data.map((d, mi) => <text key={mi} x={35 + mi * 30 + 12} y={134} fill="#64748b" fontSize={8} textAnchor="middle">{monthNames[d.month - 1]}</text>)}
        <text x={2} y={24} fill="#64748b" fontSize={7}>100%</text>
        <text x={8} y={72} fill="#64748b" fontSize={7}>50%</text>
      </svg>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Steilere Winkel gewinnen im Winter, verlieren leicht im Sommer.</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CONFIG PANEL
// ─────────────────────────────────────────────
function ConfigPanel({ config, onChange, onReset }) {
  const sectionStyle = {
    fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase",
    letterSpacing: 1, marginTop: 16, marginBottom: 8, paddingBottom: 4,
    borderBottom: "1px solid #334155",
  };
  const numInputStyle = {
    width: "100%", background: "#0f172a", border: "1px solid #334155",
    borderRadius: 4, padding: "4px 6px", color: "#e2e8f0", fontSize: 11,
    boxSizing: "border-box",
  };

  const field = (key, label, min, max, step, unit) => (
    <div key={key} style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>
          {config[key]}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={config[key]}
        onChange={e => onChange(key, parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#6366f1", marginBottom: 3 }} />
      <input type="number" min={min} max={max} step={step} value={config[key]}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= min && v <= max) onChange(key, v);
        }}
        style={numInputStyle} />
    </div>
  );

  return (
    <div style={{ background: "#1e293b", borderRadius: 12, padding: "14px 16px", marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Einstellungen</span>
        <button onClick={onReset} style={{
          background: "#334155", border: "none", borderRadius: 6, padding: "4px 10px",
          color: "#94a3b8", fontSize: 11, cursor: "pointer", fontWeight: 600,
        }}>↺ Reset</button>
      </div>

      <div style={sectionStyle}>Standort</div>
      {field("latitude", "Breitengrad", 0, 90, 0.1, "°")}
      {field("longitude", "Längengrad", -180, 180, 0.1, "°")}
      {field("facadeAzimuth", "Fassaden-Azimut", 0, 360, 1, "°")}

      <div style={sectionStyle}>Balkon</div>
      {field("balconyHeight", "Balkonhöhe", 200, 400, 1, " cm")}
      {field("railingHeight", "Geländerhöhe", 60, 150, 1, " cm")}

      <div style={sectionStyle}>Panels</div>
      {field("panelLength", "Panel-Länge", 50, 250, 0.1, " cm")}
      {field("panelWidth", "Panel-Breite", 50, 250, 0.1, " cm")}
      {field("numPanels", "Anzahl Panels", 1, 6, 1, " Stk")}
      {field("numFloors", "Stockwerke", 1, 5, 1, " OG")}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function ShadowAnalysis() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [selectedMonth, setSelectedMonth] = useState(0);
  const [hour, setHour] = useState(12);
  const [activeViews, setActiveViews] = useState({ frontal: true, profile: true, topdown: true });

  const handleConfigChange = (key, value) => setConfig(prev => ({ ...prev, [key]: value }));
  const handleReset = () => setConfig(DEFAULT_CONFIG);

  const tilt = config.panelTilt;
  const geo = getPanelGeometry(tilt, config);
  const season = seasonDays[selectedMonth];
  const solar = getSolarPosition(season.day, hour, config);
  const profileAngle = solar.altitude > 0 ? getProfileAngle(solar.altitude, solar.azimuth, config) : null;
  const isShadow = profileAngle !== null && profileAngle >= geo.criticalAngle;
  const sunBehind = solar.altitude > 0 && profileAngle === null;

  const yearAnalysis = useMemo(() => {
    const results = [];
    for (let m = 1; m <= 12; m++) {
      const doy = getDayOfYear(m, 15);
      let maxP = 0, sH = 0;
      for (let h = 6; h <= 20; h += 0.25) {
        const sv = getSolarPosition(doy, h, config);
        if (sv.altitude <= 0) continue;
        const p = getProfileAngle(sv.altitude, sv.azimuth, config);
        if (p !== null && p > maxP) maxP = p;
        if (p !== null && p >= geo.criticalAngle) sH += 0.25;
      }
      results.push({ month: m, maxProfile: maxP, shadowH: sH });
    }
    return results;
  }, [JSON.stringify(config)]);

  const toggleView = (key) => setActiveViews(prev => ({ ...prev, [key]: !prev[key] }));
  const noShadowYear = yearAnalysis.every(r => r.maxProfile < geo.criticalAngle);

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#0f172a", color: "#e2e8f0", minHeight: "100vh", padding: "24px 16px" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>

          {/* ─── LEFT COLUMN ─── */}
          <div style={{ width: 300, flexShrink: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>Verschattungsanalyse</h1>
            <p style={{ color: "#94a3b8", fontSize: 11, marginBottom: 16 }}>
              {config.latitude.toFixed(1)}°N · {config.facadeAzimuth}° Azimut · {config.numPanels}×{config.panelWidth.toFixed(0)} cm · Balkon {config.balconyHeight} cm
            </p>

            {/* Tilt slider */}
            <div style={{ background: "linear-gradient(135deg, #1e1b4b, #312e81)", borderRadius: 12, padding: "14px 16px", marginBottom: 12, border: "1px solid #4f46e5" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#a5b4fc" }}>Panelneigung</span>
                <span style={{ fontSize: 26, fontWeight: 800, color: "#f8fafc", fontVariantNumeric: "tabular-nums" }}>{tilt}°</span>
              </div>
              <input type="range" min={20} max={75} step={1} value={tilt}
                onChange={e => handleConfigChange("panelTilt", parseInt(e.target.value))}
                style={{ width: "100%", accentColor: "#818cf8" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6366f1", marginTop: 2 }}>
                <span>20° (flach)</span><span>75° (steil)</span>
              </div>
            </div>

            {/* Season buttons */}
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>Jahreszeit</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
              {seasonDays.map((sv, i) => (
                <button key={i} onClick={() => setSelectedMonth(i)} style={{
                  padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, textAlign: "left",
                  border: selectedMonth === i ? `2px solid ${sv.color}` : "2px solid #334155",
                  background: selectedMonth === i ? sv.color + "22" : "#1e293b",
                  color: selectedMonth === i ? sv.color : "#94a3b8",
                }}>{sv.label.split(" (")[0]}</button>
              ))}
            </div>

            {/* Time slider */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "#94a3b8" }}>
                Uhrzeit: <strong style={{ color: "#e2e8f0" }}>{Math.floor(hour)}:{String(Math.round((hour % 1) * 60)).padStart(2, "0")}</strong>
              </label>
              <input type="range" min={5} max={21} step={0.25} value={hour}
                onChange={e => setHour(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: season.color, marginTop: 4 }} />
            </div>

            {/* View toggles */}
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>Ansichten</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 4 }}>
              {[
                { key: "frontal", label: "Frontalansicht" },
                { key: "profile", label: "Seitenansicht" },
                { key: "topdown", label: "Draufsicht" },
              ].map(v => (
                <button key={v.key} onClick={() => toggleView(v.key)} style={{
                  padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, textAlign: "left",
                  border: activeViews[v.key] ? "2px solid #818cf8" : "2px solid #334155",
                  background: activeViews[v.key] ? "#312e81" : "#1e293b",
                  color: activeViews[v.key] ? "#c7d2fe" : "#64748b",
                }}>{activeViews[v.key] ? "✓ " : "○ "}{v.label}</button>
              ))}
            </div>

            {/* Config panel */}
            <ConfigPanel config={config} onChange={handleConfigChange} onReset={handleReset} />
          </div>

          {/* ─── RIGHT COLUMN ─── */}
          <div style={{ flex: 1, minWidth: 320 }}>

            {/* Result box */}
            <div style={{
              background: noShadowYear ? "linear-gradient(135deg, #064e3b, #065f46)" : "linear-gradient(135deg, #78350f, #92400e)",
              borderRadius: 12, padding: "16px 20px", marginBottom: 16,
              border: `1px solid ${noShadowYear ? "#10b981" : "#f59e0b"}`
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: noShadowYear ? "#6ee7b7" : "#fde68a" }}>Kritischer Profilwinkel</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#fbbf24" }}>{geo.criticalAngle.toFixed(1)}°</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: noShadowYear ? "#6ee7b7" : "#fde68a" }}>Panel ragt</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc" }}>{geo.panelD.toFixed(1)} cm raus · {geo.panelH.toFixed(1)} cm runter</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: noShadowYear ? "#6ee7b7" : "#fde68a" }}>Verschattung</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: yearAnalysis.some(r => r.maxProfile >= geo.criticalAngle) ? "#ef4444" : "#22c55e" }}>
                    {yearAnalysis.some(r => r.maxProfile >= geo.criticalAngle) ? `${yearAnalysis.filter(r => r.maxProfile >= geo.criticalAngle).length} Monate betroffen` : "Ganzjährig schattenfrei ✓"}
                  </div>
                </div>
              </div>
            </div>

            {/* Solar info cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
              {[
                { label: "Sonnenhöhe", val: solar.altitude > 0 ? solar.altitude.toFixed(1) + "°" : "—", col: solar.altitude > 0 ? "#fbbf24" : "#475569" },
                { label: "Azimut", val: solar.altitude > 0 ? solar.azimuth.toFixed(1) + "°" : "—", col: solar.altitude > 0 ? "#f59e0b" : "#475569" },
                { label: "Profilwinkel", val: profileAngle !== null && profileAngle > 0 ? profileAngle.toFixed(1) + "°" : sunBehind ? "hinter Fassade" : "—", col: profileAngle !== null && profileAngle > 0 ? (isShadow ? "#ef4444" : "#22d3ee") : "#475569" },
                { label: "Verschattung?", val: solar.altitude <= 0 ? "—" : isShadow ? "JA" : "NEIN", col: solar.altitude <= 0 ? "#475569" : isShadow ? "#ef4444" : "#22c55e" },
              ].map((c, i) => (
                <div key={i} style={{ background: "#1e293b", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{c.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: c.col, marginTop: 2 }}>{c.val}</div>
                </div>
              ))}
            </div>

            {/* Diagrams */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {activeViews.frontal && <FrontalView tilt={tilt} hour={hour} season={season} allSeasons={seasonDays} cfg={config} />}
              {activeViews.topdown && <TopDownView tilt={tilt} hour={hour} season={season} allSeasons={seasonDays} cfg={config} />}
              {activeViews.profile && <ProfileDiagram tilt={tilt} profileAngle={profileAngle !== null && profileAngle > 0 ? profileAngle : null} season={season} cfg={config} />}
            </div>

            <TiltComparisonChart currentTilt={tilt} cfg={config} />
            <MonthlyYieldChart currentTilt={tilt} cfg={config} />

            {/* Year table */}
            <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 24, marginBottom: 8 }}>Jahresübersicht bei {tilt}°</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #334155" }}>
                    <th style={{ textAlign: "left", padding: "8px 6px", color: "#94a3b8" }}>Monat</th>
                    <th style={{ textAlign: "right", padding: "8px 6px", color: "#94a3b8" }}>Max. Profilwinkel</th>
                    <th style={{ textAlign: "center", padding: "8px 6px", color: "#94a3b8" }}>Verschattung</th>
                  </tr>
                </thead>
                <tbody>
                  {yearAnalysis.map(r => {
                    const has = r.maxProfile >= geo.criticalAngle;
                    return (
                      <tr key={r.month} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "6px", fontWeight: 600 }}>{monthNames[r.month - 1]}</td>
                        <td style={{ padding: "6px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: has ? "#ef4444" : "#22c55e", fontWeight: 600 }}>
                          {r.maxProfile.toFixed(1)}° <span style={{ fontSize: 10, color: "#64748b" }}>/ {geo.criticalAngle.toFixed(1)}°</span>
                        </td>
                        <td style={{ padding: "6px", textAlign: "center", color: has ? "#ef4444" : "#22c55e", fontWeight: 600 }}>
                          {has ? `~${r.shadowH.toFixed(1)}h` : "Keine"}
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
