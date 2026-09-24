import { useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { useFormat, useMessages } from '../../i18n';
import { sceneMessages } from './messages';
import { HORIZON_RING_RADIUS } from './sceneLayout';
import { SceneStage } from './SceneStage';
import { useSceneData } from './useSceneData';
import styles from './Scene3D.module.css';

interface LegendItemProps {
  swatch: string;
  label: string;
  /** Toggle state; omit for an info-only entry. */
  pressed?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

/** Legend entry; layers that can be hidden get a toggle button (aria-pressed) as their label. */
function LegendItem({ swatch, label, pressed, onToggle, children }: LegendItemProps) {
  const icon = <span className={`${styles.swatch} ${swatch}`} />;
  return (
    <li className={styles.legendItem}>
      {onToggle ? (
        <Button
          size="sm"
          variant="ghost"
          icon={icon}
          pressed={pressed}
          onClick={onToggle}
          className={styles.chip}
          // Printed as a plain label (swatch + name); print.css leaves out the entry when it is off.
          data-print="label"
        >
          {label}
        </Button>
      ) : (
        <span className={styles.legendLabel}>
          <span aria-hidden="true">{icon}</span>
          {label}
        </span>
      )}
      <p className={styles.legendText}>{children}</p>
    </li>
  );
}

/**
 * The WebGL part of the 3D view (code-split: three.js and R3F load only when WebGL 2 is available):
 * scene stage and the legend, whose entries toggle the layers.
 */
export default function SceneView() {
  const t = useMessages(sceneMessages);
  const f = useFormat();
  const data = useSceneData();
  const [showModelShade, setShowModelShade] = useState(true);
  const [castShadows, setCastShadows] = useState(true);
  const [showSunPath, setShowSunPath] = useState(true);

  return (
    <>
      <SceneStage
        data={data}
        showModelShade={showModelShade}
        castShadows={castShadows}
        showSunPath={showSunPath}
      />
      <ul className={styles.legend} aria-label={t.layers}>
        <LegendItem
          swatch={styles.swatchModel}
          label={t.modelShade}
          pressed={showModelShade}
          onToggle={() => setShowModelShade((v) => !v)}
        >
          {t.legendModel}
        </LegendItem>
        <LegendItem
          swatch={styles.swatchCast}
          label={t.castShadows}
          pressed={castShadows}
          onToggle={() => setCastShadows((v) => !v)}
        >
          {t.legendCast}
        </LegendItem>
        <LegendItem
          swatch={styles.swatchPath}
          label={t.sunPath}
          pressed={showSunPath}
          onToggle={() => setShowSunPath((v) => !v)}
        >
          {t.legendPath(f.date(data.date))}
        </LegendItem>
        {data.farHorizon && (
          <LegendItem swatch={styles.swatchHorizon} label={t.horizon}>
            {t.legendHorizon(f.unit(HORIZON_RING_RADIUS, 'm'))}
          </LegendItem>
        )}
      </ul>
    </>
  );
}
