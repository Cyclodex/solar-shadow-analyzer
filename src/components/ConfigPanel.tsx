import type { Config } from '../types';

interface ConfigPanelProps {
  config: Config;
  onChange: (key: keyof Config, value: number) => void;
  onReset: () => void;
}

// ─────────────────────────────────────────────
// CONFIG PANEL
// ─────────────────────────────────────────────
export function ConfigPanel({ config, onChange, onReset }: ConfigPanelProps) {
  const sectionStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
    letterSpacing: 1, marginTop: 16, marginBottom: 8, paddingBottom: 4,
    borderBottom: '1px solid #334155',
  };
  const numInputStyle: React.CSSProperties = {
    width: '100%', background: '#0f172a', border: '1px solid #334155',
    borderRadius: 4, padding: '4px 6px', color: '#e2e8f0', fontSize: 11,
    boxSizing: 'border-box',
  };

  const field = (key: keyof Config, label: string, min: number, max: number, step: number, unit: string) => (
    <div key={key} style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>
          {config[key]}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={config[key] as number}
        onChange={e => onChange(key, parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#6366f1', marginBottom: 3 }} />
      <input type="number" min={min} max={max} step={step} value={config[key] as number}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= min && v <= max) onChange(key, v);
        }}
        style={numInputStyle} />
    </div>
  );

  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '14px 16px', marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Einstellungen</span>
        <button onClick={onReset} style={{
          background: '#334155', border: 'none', borderRadius: 6, padding: '4px 10px',
          color: '#94a3b8', fontSize: 11, cursor: 'pointer', fontWeight: 600,
        }}>↺ Reset</button>
      </div>

      <div style={sectionStyle}>Standort</div>
      {field('latitude', 'Breitengrad', 0, 90, 0.1, '°')}
      {field('longitude', 'Längengrad', -180, 180, 0.1, '°')}
      {field('facadeAzimuth', 'Fassaden-Azimut', 0, 360, 1, '°')}

      <div style={sectionStyle}>Balkon</div>
      {field('balconyHeight', 'Balkonhöhe', 200, 400, 1, ' cm')}
      {field('railingHeight', 'Geländerhöhe', 60, 150, 1, ' cm')}

      <div style={sectionStyle}>Panels</div>
      {field('panelLength', 'Panel-Länge', 50, 250, 0.1, ' cm')}
      {field('panelWidth', 'Panel-Breite', 50, 250, 0.1, ' cm')}
      {field('numPanels', 'Anzahl Panels', 1, 6, 1, ' Stk')}
      {field('numFloors', 'Stockwerke', 1, 5, 1, ' OG')}
    </div>
  );
}
