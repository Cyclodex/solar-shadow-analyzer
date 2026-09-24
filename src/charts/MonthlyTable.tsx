import { useMemo, useState } from 'react';
import { ViewCard } from '../components/ViewCard';
import { Button } from '../components/Button';
import { DownloadIcon } from '../components/icons';
import { monthNames, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useAnnualInputsPending, useHeatmapStats, useShadedFloor, useSimulation } from '../hooks/useModel';
import { clearSkyParts, exportFilename } from '../export/filenames';
import { downloadCsv, monthlyResultsCsv, userCsvFormat } from '../export/resultsCsv';
import { useConfigSection } from '../state/configStore';
import { useTimeStore } from '../state/timeStore';
import { floorColor } from '../styles/tokens';
import { ColumnHeader, DataTable, type DataTableColumn, type DataTableRow } from './lib/DataTable';
import { useFloorLabels } from './lib/floors';
import { monthlyRows, type MonthlyRow } from './lib/monthlyTable';
import { useSourceLabel } from './lib/sourceLabel';
import { useNearViewport } from './lib/useNearViewport';
import chart from './lib/chart.module.css';

const de = {
  title: 'Monatstabelle',
  subtitle: 'Ertrag je Stockwerk, Verschattungsverlust und verschattete Stunden je Monat',
  csv: 'CSV',
  csvLabel: 'Monatstabelle als CSV herunterladen',
  caption: (year: number) => `Monatswerte ${year}`,
  month: 'Monat',
  loss: 'Verlust',
  shaded: (floor: string) => `Verschattet ${floor}`,
  year: 'Jahr',
  kwh: 'kWh',
  h: 'h',
  hoursNote: (floor: string, above: string, year: number) =>
    `Verschattete Stunden: Stunden mit direkter Sonne auf ${floor}, in denen mehr als 1 % der Fläche durch ${above} verschattet ist (10-Minuten-Raster, ${year}).`,
  lossNote: 'Verlust: Differenz zum Ertrag ohne Verschattung durch das jeweils obere Stockwerk.',
  single: 'Nur ein Stockwerk: keine Verschattung durch Panels.',
  waiting: 'Die Monatswerte werden berechnet …',
};
type Texts = typeof de;
const messages: Messages<Texts> = {
  de,
  en: {
    title: 'Monthly table',
    subtitle: 'Yield per floor, shading loss and shaded hours per month',
    csv: 'CSV',
    csvLabel: 'Download the monthly table as CSV',
    caption: (year) => `Monthly values ${year}`,
    month: 'Month',
    loss: 'Loss',
    shaded: (floor) => `Shaded ${floor}`,
    year: 'Year',
    kwh: 'kWh',
    h: 'h',
    hoursNote: (floor, above, year) =>
      `Shaded hours: hours with direct sun on ${floor} during which more than 1% of the area is shaded by ${above} (10-minute grid, ${year}).`,
    lossNote: 'Loss: difference to the yield without shading by the floor above.',
    single: 'Single floor: no shading by panels.',
    waiting: 'Computing the monthly values …',
  },
};

/** Monthly numbers per floor (simulation) with loss, shaded hours (heatmap statistics) and CSV export. */
export function MonthlyTable() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const simulation = useSimulation();
  const pending = useAnnualInputsPending();
  const locationName = useConfigSection('location').name;
  const { numFloors } = useConfigSection('building');
  const heatmapYear = useConfigSection('weather').year;
  const shadedFloor = useShadedFloor();
  // The shaded-hours column is shown with the simulation only: no heatmap before that. It needs the year
  // of shade behind the heatmap: computed only near the screen (useNearViewport), else the last result is
  // kept (e.g. while the tilt slider is dragged at the top of a phone, the card is far below).
  const [nearRef, near] = useNearViewport<HTMLElement>();
  const fresh = useHeatmapStats(shadedFloor, simulation !== null && near);
  const [kept, setKept] = useState(fresh);
  if (fresh && fresh !== kept) setKept(fresh);
  const stats = fresh ?? (near ? null : kept);
  const labels = useFloorLabels();
  const date = useTimeStore((s) => s.date);
  const source = useSourceLabel(simulation);
  const months = monthNames(lang, 'long');
  const currentMonth = Number(date.slice(5, 7)) - 1;

  const multi = (simulation?.floors.length ?? numFloors) > 1;
  const floorName = labels[shadedFloor] ?? String(shadedFloor);
  const aboveName = labels[shadedFloor + 1] ?? String(shadedFloor + 1);
  const data = useMemo(
    () => (simulation ? monthlyRows(simulation, multi ? stats : null) : null),
    [simulation, stats, multi],
  );

  const n = simulation?.floors.length ?? 0;
  const columns: DataTableColumn[] = [
    { key: 'month', header: t.month },
    ...Array.from({ length: n }, (_, k) => ({
      key: `f${k}`,
      header: <ColumnHeader name={labels[k] ?? String(k)} unit={t.kwh} color={floorColor(k)} />,
      numeric: true,
    })),
    ...(multi
      ? [
          { key: 'total', header: <ColumnHeader name={c.total} unit={t.kwh} />, numeric: true },
          { key: 'loss', header: <ColumnHeader name={t.loss} unit={t.kwh} />, numeric: true },
          { key: 'lossPct', header: <ColumnHeader name={t.loss} unit="%" />, numeric: true },
          { key: 'shaded', header: <ColumnHeader name={t.shaded(floorName)} unit={t.h} />, numeric: true },
        ]
      : []),
  ];

  const toRow = (r: MonthlyRow): DataTableRow => ({
    key: r.month === null ? 'year' : String(r.month),
    current: r.month !== null && r.month === currentMonth,
    cells: [
      r.month === null ? t.year : months[r.month],
      ...r.floorsKwh.map((v) => f.num(v)),
      ...(multi
        ? [f.num(r.totalKwh), f.num(r.lossKwh, 1), f.num(r.lossPct, 1), f.num(r.shadedHours ?? 0)]
        : []),
    ],
  });

  const busy = !simulation || pending;

  // The export menu's monthly CSV (same columns and naming scheme) plus the shaded hours of the table.
  const exportCsv = (): void => {
    // Provisional values (inputs still loading) are not exported, as in the export menu.
    if (!simulation || busy) return;
    const shadedHours =
      multi && stats
        ? { floor: floorName, monthly: stats.monthly.map((m) => m.shadedHours), year: stats.shadedHours }
        : undefined;
    const parts = [locationName, simulation.year, ...clearSkyParts(simulation.source, lang)];
    downloadCsv(
      monthlyResultsCsv(simulation, lang, userCsvFormat(lang), { shadedHours }),
      exportFilename('monthlyTable', lang, parts, 'csv'),
    );
  };

  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle}
      minHeight={160}
      busy={busy}
      toolbar={
        <Button
          size="sm"
          variant="ghost"
          icon={<DownloadIcon />}
          onClick={exportCsv}
          disabled={!data || busy}
          aria-label={t.csvLabel}
        >
          {t.csv}
        </Button>
      }
    >
      {data && simulation ? (
        <>
          <DataTable
            caption={t.caption(simulation.year)}
            captionHidden
            columns={columns}
            rows={data.months.map(toRow)}
            footer={[toRow(data.year)]}
          />
          <p ref={nearRef} className={chart.caption}>
            {[
              source,
              multi ? t.lossNote : t.single,
              multi ? t.hoursNote(floorName, aboveName, heatmapYear) : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        </>
      ) : (
        <div ref={nearRef} className={chart.empty}>
          {t.waiting}
        </div>
      )}
    </ViewCard>
  );
}
