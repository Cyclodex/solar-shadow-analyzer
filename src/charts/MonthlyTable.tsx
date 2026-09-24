import { useMemo } from 'react';
import { ViewCard } from '../components/ViewCard';
import { Button } from '../components/Button';
import { DownloadIcon } from '../components/icons';
import { cssVars } from '../components/cssVars';
import { monthNames, useFormat, useLang, useMessages, type Messages } from '../i18n';
import { useCommon } from '../i18n/common';
import { useHeatmapStats, useSimulation } from '../hooks/useModel';
import { exportFilename } from '../export/filenames';
import { downloadCsv, userCsvFormat } from '../export/resultsCsv';
import { useConfigSection } from '../state/configStore';
import { useDataStore } from '../state/dataStore';
import { useTimeStore } from '../state/timeStore';
import { floorColor } from '../styles/tokens';
import { DataTable, type DataTableColumn, type DataTableRow } from './lib/DataTable';
import { useFloorLabels, useShadedFloor } from './lib/floors';
import { monthlyCsv, monthlyRows, type MonthlyRow } from './lib/monthlyTable';
import { useSourceLabel } from './lib/sourceLabel';
import chart from './lib/chart.module.css';
import styles from './MonthlyTable.module.css';

const de = {
  title: 'Monatstabelle',
  subtitle: 'Ertrag je Stockwerk, Verschattungsverlust und verschattete Stunden je Monat',
  csv: 'CSV',
  csvLabel: 'Monatstabelle als CSV herunterladen',
  caption: (year: number) => `Monatswerte ${year}`,
  month: 'Monat',
  loss: 'Verlust',
  lossPct: 'Verlust in %',
  shaded: (floor: string) => `Verschattet ${floor}`,
  year: 'Jahr',
  kwh: 'kWh',
  h: 'h',
  hoursNote: (floor: string, above: string, year: number) =>
    `Verschattete Stunden: Stunden mit direkter Sonne auf ${floor}, in denen mehr als 1 % der Fläche durch ${above} verschattet ist (10-Minuten-Raster, ${year}).`,
  lossNote: 'Verlust: Differenz zum Ertrag ohne Verschattung durch das jeweils obere Stockwerk.',
  single: 'Nur ein Stockwerk: keine Verschattung durch Panels.',
  waiting: 'Die Monatswerte werden berechnet …',
  /** File name part after "verschattung-monatsertrag-", tells the table export from the export menu's. */
  fileTag: 'tabelle',
  clearSkyTag: 'klarer-himmel',
  csvFloor: (floor: string) => `${floor} (kWh)`,
  csvTotal: 'Total (kWh)',
  csvLoss: 'Verlust (kWh)',
  csvLossPct: 'Verlust (%)',
  csvShaded: (floor: string) => `Verschattete Stunden ${floor} (h)`,
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
    lossPct: 'Loss in %',
    shaded: (floor) => `Shaded ${floor}`,
    year: 'Year',
    kwh: 'kWh',
    h: 'h',
    hoursNote: (floor, above, year) =>
      `Shaded hours: hours with direct sun on ${floor} during which more than 1% of the area is shaded by ${above} (10-minute grid, ${year}).`,
    lossNote: 'Loss: difference to the yield without shading by the floor above.',
    single: 'Single floor: no shading by panels.',
    waiting: 'Computing the monthly values …',
    fileTag: 'table',
    clearSkyTag: 'clear-sky',
    csvFloor: (floor) => `${floor} (kWh)`,
    csvTotal: 'Total (kWh)',
    csvLoss: 'Loss (kWh)',
    csvLossPct: 'Loss (%)',
    csvShaded: (floor) => `Shaded hours ${floor} (h)`,
  },
};

/** Column header: name with an optional floor swatch and the unit on a second line. */
function Header({ name, unit, floor }: { name: string; unit: string; floor?: number }) {
  return (
    <span className={styles.head}>
      <span className={styles.name}>
        {floor !== undefined && (
          <span className={styles.swatch} style={cssVars({ '--c': floorColor(floor) })} aria-hidden="true" />
        )}
        {name}
      </span>
      <span className={styles.unit}>{unit}</span>
    </span>
  );
}

/** Monthly numbers per floor (simulation) with loss, shaded hours (heatmap statistics) and CSV export. */
export function MonthlyTable() {
  const t = useMessages(messages);
  const c = useCommon();
  const f = useFormat();
  const lang = useLang();
  const simulation = useSimulation();
  const weatherStatus = useDataStore((s) => s.weather.status);
  const locationName = useConfigSection('location').name;
  const { numFloors } = useConfigSection('building');
  const heatmapYear = useConfigSection('weather').year;
  const shadedFloor = useShadedFloor();
  const stats = useHeatmapStats(shadedFloor);
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
      header: <Header name={labels[k] ?? String(k)} unit={t.kwh} floor={k} />,
      numeric: true,
    })),
    ...(multi
      ? [
          { key: 'total', header: <Header name={c.total} unit={t.kwh} />, numeric: true },
          { key: 'loss', header: <Header name={t.loss} unit={t.kwh} />, numeric: true },
          { key: 'lossPct', header: <Header name={t.loss} unit="%" />, numeric: true },
          { key: 'shaded', header: <Header name={t.shaded(floorName)} unit={t.h} />, numeric: true },
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

  const exportCsv = (): void => {
    if (!data || !simulation) return;
    const csv = monthlyCsv(
      data,
      {
        month: t.month,
        floors: Array.from({ length: n }, (_, k) => t.csvFloor(labels[k] ?? String(k))),
        total: t.csvTotal,
        lossKwh: multi ? t.csvLoss : null,
        lossPct: multi ? t.csvLossPct : null,
        shadedHours: multi ? t.csvShaded(floorName) : null,
        monthNames: months,
        year: t.year,
      },
      userCsvFormat(lang),
    );
    // Same naming scheme as the export menu's CSV files.
    const clearSky = simulation.source === 'clear-sky' ? [t.clearSkyTag] : [];
    downloadCsv(
      csv,
      exportFilename('monthly', lang, [t.fileTag, locationName, simulation.year, ...clearSky], 'csv'),
    );
  };

  return (
    <ViewCard
      title={t.title}
      subtitle={t.subtitle}
      minHeight={160}
      busy={!simulation || weatherStatus === 'loading'}
      toolbar={
        <Button
          size="sm"
          variant="ghost"
          icon={<DownloadIcon />}
          onClick={exportCsv}
          disabled={!data}
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
          <p className={chart.caption}>
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
        <div className={chart.empty}>{t.waiting}</div>
      )}
    </ViewCard>
  );
}
