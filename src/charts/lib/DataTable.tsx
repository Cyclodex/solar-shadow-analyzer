import { useState, type ReactNode } from 'react';
import { useMessages, type Messages } from '../../i18n';
import styles from './table.module.css';

// ─────────────────────────────────────────────
// DATA TABLE
// Accessible table (caption, column headers, row headers in the first column, optional totals footer)
// inside a keyboard-scrollable region, so wide tables scroll inside the card and never the page.
// ChartDataTable wraps it in a <details> disclosure: the table twin of a chart.
// ─────────────────────────────────────────────

export interface DataTableColumn {
  key: string;
  header: ReactNode;
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
}

export interface DataTableRow {
  key: string;
  /** One cell per column; the first one is the row header. */
  cells: readonly ReactNode[];
  /** Highlights the row and marks it aria-current (e.g. the selected month). */
  current?: boolean;
}

export interface DataTableProps {
  caption: ReactNode;
  /** Visually hide the caption (it stays the table's accessible name). */
  captionHidden?: boolean;
  /** Accessible name of the scroll region. */
  label: string;
  columns: readonly DataTableColumn[];
  rows: readonly DataTableRow[];
  /** Rows in <tfoot> (totals). */
  footer?: readonly DataTableRow[];
  className?: string;
}

function Row({ row, columns }: { row: DataTableRow; columns: readonly DataTableColumn[] }) {
  return (
    <tr className={row.current ? styles.current : undefined} aria-current={row.current ? 'true' : undefined}>
      {row.cells.map((cell, i) =>
        i === 0 ? (
          <th key={columns[i]?.key ?? i} scope="row">
            {cell}
          </th>
        ) : (
          <td key={columns[i]?.key ?? i} className={columns[i]?.numeric ? styles.num : undefined}>
            {cell}
          </td>
        ),
      )}
    </tr>
  );
}

export function DataTable({
  caption,
  captionHidden,
  label,
  columns,
  rows,
  footer,
  className,
}: DataTableProps) {
  return (
    <div
      className={[styles.scroll, className].filter(Boolean).join(' ')}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className={styles.table}>
        <caption className={captionHidden ? 'sr-only' : styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                className={c.numeric ? styles.num : i === 0 ? styles.left : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.key} row={r} columns={columns} />
          ))}
        </tbody>
        {footer && footer.length > 0 && (
          <tfoot>
            {footer.map((r) => (
              <Row key={r.key} row={r} columns={columns} />
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}

const de = { show: 'Werte als Tabelle' };
const messages: Messages<typeof de> = { de, en: { show: 'Values as a table' } };

export interface ChartDataTableProps extends Omit<DataTableProps, 'label' | 'captionHidden'> {
  /** Summary text of the disclosure (default "Werte als Tabelle"). */
  summary?: string;
}

/**
 * The table twin of a chart in a <details> disclosure. The table is only rendered while open
 * (charts with many points stay cheap).
 */
export function ChartDataTable({ summary, caption, ...table }: ChartDataTableProps) {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  const title = summary ?? t.show;
  return (
    <details className={styles.details} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.summary}>{title}</summary>
      {open && <DataTable caption={caption} captionHidden label={title} {...table} />}
    </details>
  );
}
