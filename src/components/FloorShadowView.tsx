import type { Config, SeasonDay } from '../types';
import { toRad, getPanelGeometry, getSolarPosition, getProfileAngle } from '../utils/solar';

interface FloorShadowViewProps {
  tilt: number;
  hour: number;
  season: SeasonDay;
  cfg: Config;
}

// ─────────────────────────────────────────────
// FLOOR SHADOW VIEW
// Top-down perspective of the lower panel with
// the shadow cast by the upper-floor panel.
//
// Shadow math (all coords in facade-local space):
//   X = along facade (positive right when facing facade)
//   Y = away from facade (positive outward)
//   Z = vertical (positive up)
//
// Lower panel surface: (x, y, -y·panelH/panelD)
// Upper panel surface: (x, y,  balconyH - y·panelH/panelD)  [same tilt, one floor up]
//
// A ray from lower-panel point Q=(qx,qy) toward the sun intersects the upper-panel
// surface after parameter t:
//   t = balconyH / (sin(alt) + cos(alt)·cos(azDiff)·(panelH/panelD))
//
// The horizontal shift of the intersection point:
//   ΔX = t · cos(alt) · sin(azDiff)
//   ΔY = t · cos(alt) · cos(azDiff)
//
// Point Q is in shadow when the intersection lands inside the upper panel:
//   qx + ΔX ∈ [-W/2, W/2]  →  qx ∈ [-W/2 - ΔX, W/2 - ΔX]
//   qy + ΔY ∈ [0, panelD]  →  qy ∈ [-ΔY, panelD - ΔY]
//
// The shadow region on the lower panel is therefore a rectangle (same shape,
// shifted by the sun's azimuth and altitude).
// ─────────────────────────────────────────────
export function FloorShadowView({ tilt, hour, season, cfg }: FloorShadowViewProps) {
  const geo = getPanelGeometry(tilt, cfg);
  const { panelD, panelH, criticalAngle } = geo;
  const totalWidth = cfg.numPanels * cfg.panelWidth;

  const solar = getSolarPosition(season.day, hour, cfg);
  const profileAngle =
    solar.altitude > 0 ? getProfileAngle(solar.altitude, solar.azimuth, cfg) : null;
  const hasShadow =
    cfg.numFloors >= 2 && profileAngle !== null && profileAngle >= criticalAngle;
  const isBehind = solar.altitude > 0 && profileAngle === null;

  const vw = 520;
  const vh = 400;
  const marginX = 72;
  const marginTop = 82;
  const marginBottom = 100;

  // Dynamic scale: fit the panel comfortably
  const sc = Math.min(
    (vw - 2 * marginX) / totalWidth,
    (vh - marginTop - marginBottom) / (panelD * 1.6 + 10),
    3.5,
  );

  const cx = vw / 2;
  const facadeY = marginTop; // SVG Y of the facade/railing line (near edge of panel)
  const panelFarY = facadeY + panelD * sc; // SVG Y of panel far edge

  const pLeft = cx - (totalWidth / 2) * sc;
  const pRight = cx + (totalWidth / 2) * sc;

  // ── Shadow rectangle ─────────────────────────────────────────
  let svgShadow: { x: number; y: number; w: number; h: number } | null = null;
  let shadowPct = 0;

  if (cfg.numFloors >= 2 && solar.altitude > 0.5 && panelD > 0.1) {
    const altRad = toRad(solar.altitude);
    const azDiffRad = toRad(solar.azimuth - cfg.facadeAzimuth);
    const sinAlt = Math.sin(altRad);
    const cosAlt = Math.cos(altRad);
    const sinAzDiff = Math.sin(azDiffRad);
    const cosAzDiff = Math.cos(azDiffRad);

    const denom = sinAlt + cosAlt * cosAzDiff * (panelH / panelD);
    if (denom > 0.001) {
      const t = cfg.balconyHeight / denom;
      const deltaX = t * cosAlt * sinAzDiff;
      const deltaY = t * cosAlt * cosAzDiff;

      // Intersection of upper-panel shadow region with lower panel bounds
      const xMin = Math.max(-totalWidth / 2, -totalWidth / 2 - deltaX);
      const xMax = Math.min(totalWidth / 2, totalWidth / 2 - deltaX);
      const yMin = Math.max(0, -deltaY);
      const yMax = Math.min(panelD, panelD - deltaY);

      if (xMax > xMin + 0.1 && yMax > yMin + 0.1) {
        svgShadow = {
          x: cx + xMin * sc,
          y: facadeY + yMin * sc,
          w: (xMax - xMin) * sc,
          h: (yMax - yMin) * sc,
        };
        shadowPct = Math.min(((xMax - xMin) * (yMax - yMin)) / (totalWidth * panelD) * 100, 100);
      }
    }
  }

  // ── Sun direction indicator ───────────────────────────────────
  const azDiffRad = toRad(solar.azimuth - cfg.facadeAzimuth);
  // In the top-down SVG: X right = along-facade right, Y down = away from facade.
  const sunDirSvgX = Math.sin(azDiffRad);
  const sunDirSvgY = Math.cos(azDiffRad);
  const indicCx = vw - 66;
  const indicCy = marginTop + (panelFarY - marginTop) / 2;
  const arrowLen = 28;
  // Arrow: drawn FROM the sun's direction TOWARD the center of the indicator
  const arrowFromX = indicCx - sunDirSvgX * arrowLen;
  const arrowFromY = indicCy - sunDirSvgY * arrowLen;
  const arrowToX = indicCx + sunDirSvgX * 6;
  const arrowToY = indicCy + sunDirSvgY * 6;

  // ── Legend Y positions ────────────────────────────────────────
  const legendY = vh - 88;

  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} style={{ width: '100%', background: '#0f172a', borderRadius: 12 }}>
      <defs>
        <clipPath id="floorPanelClip">
          <rect x={pLeft} y={facadeY} width={pRight - pLeft} height={panelD * sc} />
        </clipPath>
      </defs>

      {/* Title */}
      <text x={12} y={18} fill="#e2e8f0" fontSize={13} fontWeight={700}>
        Stockwerkansicht — Schatten auf unterem Panel
      </text>
      <text x={12} y={34} fill="#94a3b8" fontSize={10}>{season.label}</text>

      {/* Building wall indicator */}
      <rect
        x={pLeft - 22} y={facadeY - 22}
        width={pRight - pLeft + 44} height={16}
        fill="#334155" stroke="#475569" strokeWidth={1} rx={2}
      />
      <text x={cx} y={facadeY - 11} fill="#64748b" fontSize={8} textAnchor="middle">
        ← Fassade ({cfg.facadeAzimuth}°) →
      </text>

      {/* Lower panel — base (illuminated) */}
      <rect
        x={pLeft} y={facadeY}
        width={pRight - pLeft} height={panelD * sc}
        fill="#22c55e" opacity={0.25}
        stroke="#4ade80" strokeWidth={1.5}
      />

      {/* Panel dividers */}
      {Array.from({ length: cfg.numPanels - 1 }, (_, i) => {
        const x = pLeft + ((i + 1) / cfg.numPanels) * (pRight - pLeft);
        return (
          <line
            key={i}
            x1={x} y1={facadeY}
            x2={x} y2={panelFarY}
            stroke="#4ade80" strokeWidth={0.8} opacity={0.5}
          />
        );
      })}

      {/* Shadow on lower panel (clipped) */}
      {svgShadow && (
        <>
          <rect
            x={svgShadow.x} y={svgShadow.y}
            width={svgShadow.w} height={svgShadow.h}
            fill="#0f172a" opacity={0.72}
            clipPath="url(#floorPanelClip)"
          />
          <rect
            x={svgShadow.x} y={svgShadow.y}
            width={svgShadow.w} height={svgShadow.h}
            fill="none"
            stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3,2" opacity={0.55}
            clipPath="url(#floorPanelClip)"
          />
        </>
      )}

      {/* Upper panel outline (dashed orange — same footprint, one floor above) */}
      {cfg.numFloors >= 2 && (
        <>
          <rect
            x={pLeft} y={facadeY}
            width={pRight - pLeft} height={panelD * sc}
            fill="none"
            stroke="#f97316" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.45}
          />
          <text x={pRight + 6} y={facadeY + 10} fill="#f97316" fontSize={8} opacity={0.65}>
            Oberes Panel
          </text>
          <text x={pRight + 6} y={facadeY + 20} fill="#f97316" fontSize={8} opacity={0.65}>
            (gestrichelt)
          </text>
        </>
      )}

      {/* ── Dimension annotations ── */}
      {/* Width arrow */}
      <line x1={pLeft} y1={panelFarY + 14} x2={pRight} y2={panelFarY + 14}
        stroke="#94a3b8" strokeWidth={0.8} />
      <line x1={pLeft} y1={panelFarY + 10} x2={pLeft} y2={panelFarY + 18}
        stroke="#94a3b8" strokeWidth={0.8} />
      <line x1={pRight} y1={panelFarY + 10} x2={pRight} y2={panelFarY + 18}
        stroke="#94a3b8" strokeWidth={0.8} />
      <text x={cx} y={panelFarY + 28} fill="#94a3b8" fontSize={9} textAnchor="middle">
        {cfg.numPanels}×{cfg.panelWidth.toFixed(0)} = {totalWidth.toFixed(0)} cm
      </text>

      {/* Depth arrow */}
      <line x1={pLeft - 14} y1={facadeY} x2={pLeft - 14} y2={panelFarY}
        stroke="#94a3b8" strokeWidth={0.8} />
      <line x1={pLeft - 18} y1={facadeY} x2={pLeft - 10} y2={facadeY}
        stroke="#94a3b8" strokeWidth={0.8} />
      <line x1={pLeft - 18} y1={panelFarY} x2={pLeft - 10} y2={panelFarY}
        stroke="#94a3b8" strokeWidth={0.8} />
      <text
        x={pLeft - 28} y={(facadeY + panelFarY) / 2}
        fill="#94a3b8" fontSize={9} textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(-90, ${pLeft - 28}, ${(facadeY + panelFarY) / 2})`}
      >
        {panelD.toFixed(0)} cm
      </text>

      {/* ── Sun direction indicator ── */}
      <circle cx={indicCx} cy={indicCy} r={34} fill="#1e293b" stroke="#334155" strokeWidth={1} />
      {/* Facade direction line (top of circle = toward facade) */}
      <line x1={indicCx} y1={indicCy - 26} x2={indicCx} y2={indicCy - 16}
        stroke="#475569" strokeWidth={1} strokeDasharray="2,2" />
      <text x={indicCx} y={indicCy - 30} fill="#64748b" fontSize={7} textAnchor="middle">
        Fassade
      </text>
      {solar.altitude > 0 && !isBehind && (
        <>
          {/* Sun position dot and arrow toward panel center */}
          <circle cx={arrowFromX} cy={arrowFromY} r={7} fill="#fbbf24" opacity={0.9} />
          <circle cx={arrowFromX} cy={arrowFromY} r={11} fill="none"
            stroke="#fbbf24" strokeWidth={1} opacity={0.35} strokeDasharray="2,2" />
          <line x1={arrowFromX} y1={arrowFromY} x2={arrowToX} y2={arrowToY}
            stroke="#fbbf24" strokeWidth={1.5} opacity={0.7} />
          <text x={indicCx} y={indicCy + 40} fill="#fbbf24" fontSize={8} textAnchor="middle">
            Alt: {solar.altitude.toFixed(1)}°
          </text>
          <text x={indicCx} y={indicCy + 50} fill="#94a3b8" fontSize={8} textAnchor="middle">
            Az: {solar.azimuth.toFixed(0)}°
          </text>
        </>
      )}
      {isBehind && (
        <>
          <text x={indicCx} y={indicCy + 3} fill="#475569" fontSize={8} textAnchor="middle">
            Sonne hinter
          </text>
          <text x={indicCx} y={indicCy + 13} fill="#475569" fontSize={8} textAnchor="middle">
            Fassade
          </text>
        </>
      )}
      {solar.altitude <= 0 && (
        <text x={indicCx} y={indicCy + 4} fill="#475569" fontSize={8} textAnchor="middle">
          Nacht
        </text>
      )}

      {/* ── Legend ── */}
      <rect x={12} y={legendY} width={12} height={8}
        fill="#22c55e" opacity={0.25} stroke="#4ade80" strokeWidth={0.8} />
      <text x={28} y={legendY + 7} fill="#4ade80" fontSize={8}>
        Unteres Panel (besonnt)
      </text>
      <rect x={12} y={legendY + 14} width={12} height={8}
        fill="#0f172a" opacity={0.72} stroke="#94a3b8" strokeWidth={0.8} />
      <text x={28} y={legendY + 21} fill="#94a3b8" fontSize={8}>
        Schatten (vom oberen Panel)
      </text>
      <line x1={12} y1={legendY + 32} x2={24} y2={legendY + 32}
        stroke="#f97316" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6} />
      <text x={28} y={legendY + 35} fill="#f97316" fontSize={8} opacity={0.7}>
        Oberes Panel (Umriss, direkt darüber)
      </text>

      {/* ── Status bar ── */}
      <rect x={12} y={vh - 44} width={vw - 24} height={38}
        fill="#1e293b" rx={5} opacity={0.85} />
      <text x={22} y={vh - 29} fill="#94a3b8" fontSize={9}>
        Stockwerkabstand: {cfg.balconyHeight} cm · Paneltiefe: {panelD.toFixed(0)} cm · Krit. Winkel: {criticalAngle.toFixed(1)}°
      </text>
      {cfg.numFloors >= 2 ? (
        <text x={22} y={vh - 14}
          fill={shadowPct > 0 ? '#ef4444' : hasShadow ? '#f59e0b' : '#22c55e'} fontSize={11} fontWeight={700}>
          {shadowPct > 0
            ? `Verschattet: ~${shadowPct.toFixed(0)}% des unteren Panels (Profilwinkel ${profileAngle?.toFixed(1)}° > ${criticalAngle.toFixed(1)}°)`
            : hasShadow
              ? `Sonne zu seitlich — Schatten trifft Panel nicht (Profilwinkel ${profileAngle?.toFixed(1)}° > ${criticalAngle.toFixed(1)}°)`
              : isBehind
                ? 'Sonne hinter Fassade — keine Verschattung'
                : solar.altitude <= 0
                  ? 'Nacht — keine Sonne'
                  : 'Kein Schatten auf unterem Panel ✓'}
        </text>
      ) : (
        <text x={22} y={vh - 14} fill="#64748b" fontSize={10}>
          Mindestens 2 Etagen erforderlich (aktuell: {cfg.numFloors})
        </text>
      )}
    </svg>
  );
}
