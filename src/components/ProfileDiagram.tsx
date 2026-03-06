import type { Config, SeasonDay } from '../types';
import { toRad, getPanelGeometry } from '../utils/solar';

interface ProfileDiagramProps {
  tilt: number;
  profileAngle: number | null;
  season: SeasonDay | null;
  cfg: Config;
}

// ─────────────────────────────────────────────
// PROFILE (SIDE) VIEW
// ─────────────────────────────────────────────
export function ProfileDiagram({ tilt, profileAngle, season, cfg }: ProfileDiagramProps) {
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
    <svg viewBox="0 0 480 340" style={{ width: '100%', background: '#0f172a', borderRadius: 12 }}>
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
        const col = isShadow ? '#ef4444' : '#38bdf8';
        return (
          <>
            <line x1={loTop.x} y1={loTop.y} x2={endX} y2={endY} stroke={col} strokeWidth={2} opacity={0.6} />
            <circle cx={endX} cy={endY} r={10} fill={isShadow ? '#ef4444' : '#fbbf24'} opacity={0.8} />
            <circle cx={endX} cy={endY} r={15} fill="none" stroke={isShadow ? '#ef4444' : '#fbbf24'} strokeWidth={1} opacity={0.3} strokeDasharray="3,3" />
            <text x={endX - 30} y={endY - 18} fill={col} fontSize={10} fontWeight={700}>{profileAngle.toFixed(1)}°</text>
          </>
        );
      })()}

      <text x={12} y={18} fill="#e2e8f0" fontSize={13} fontWeight={700}>Seitenansicht — Neigung {90 - tilt}° ({tilt}° vom Boden)</text>
      <text x={12} y={34} fill="#94a3b8" fontSize={10}>
        {season ? season.label : ''}{profileAngle !== null && profileAngle > 0 ? ` · Profil: ${profileAngle.toFixed(1)}°` : ''}
      </text>
      <text x={wallX - 18} y={lowerSlabY + 26} fill="#475569" fontSize={9}>← Gebäude</text>
      <text x={railX + panelD * sc + 10} y={lowerSlabY + 26} fill="#475569" fontSize={9}>Aussen →</text>
      <text x={12} y={lowerSlabY + panelH * sc + 44} fill="#64748b" fontSize={9}>
        Panel: {cfg.panelLength}×{cfg.panelWidth}×{cfg.panelThickness} cm · Querschnitt
      </text>
    </svg>
  );
}
