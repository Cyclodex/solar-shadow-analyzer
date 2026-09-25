import { useId } from 'react';
import { Button } from '../../components/Button';
import { InfoTip } from '../../components/InfoTip';
import { Spinner } from '../../components/Spinner';
import { useFormat, useMessages } from '../../i18n';
import type { BuildingInfo } from '../../model/geocode';
import { useConfigSection } from '../../state/configStore';
import { addressMatchesLocation, retryBuildingInfo, useAddressSession } from './addressSession';
import { messages, yearText } from './addressBuildingText';
import styles from './AddressBuilding.module.css';

function Facts({ info }: { info: BuildingInfo }) {
  const t = useMessages(messages);
  const f = useFormat();
  const year = yearText(info, t);
  const rows: { term: string; value: string; tip?: string; wide?: boolean }[] = [
    { term: t.storeys, value: info.storeys === null ? t.unknown : f.int(info.storeys), tip: t.storeysInfo },
    { term: t.year, value: year },
    { term: t.area, value: info.area === null ? t.unknown : f.unit(info.area, 'm²') },
    {
      term: t.category,
      value: info.category === null ? t.unknown : t.categories[info.category],
      wide: true,
    },
  ];
  return (
    <dl className={styles.facts}>
      {rows.map(({ term, value, tip, wide }) => (
        <div key={term} className={wide ? `${styles.fact} ${styles.wide}` : styles.fact}>
          <dt className={styles.term}>
            {term}
            {tip && <InfoTip label={term}>{tip}</InfoTip>}
          </dt>
          <dd className={styles.value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Read-only data of the building at the picked address (building register: storeys, year of construction,
 * footprint, category). Shown while the location still is that address (addressMatchesLocation); session only.
 */
export function AddressBuilding() {
  const t = useMessages(messages);
  const headingId = useId();
  const location = useConfigSection('location');
  const address = useAddressSession((s) => s.address);
  const building = useAddressSession((s) => s.building);
  if (!address || !addressMatchesLocation(address, location)) return null;

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <h4 id={headingId} className={styles.title}>
        {t.title}
      </h4>
      <p className={styles.address}>
        <span className={styles.label}>{address.label}</span>
        <span className={styles.meta}>
          {address.country === 'LI' ? t.liechtenstein : t.switzerland} · {t.egid(address.egid)}
        </span>
      </p>
      {building.status === 'loading' && <Spinner label={t.loading} showLabel size="sm" />}
      {building.status === 'error' && (
        <div className={styles.error} role="alert">
          <span>{t.error}</span>
          <Button size="sm" variant="ghost" onClick={retryBuildingInfo}>
            {t.retry}
          </Button>
        </div>
      )}
      {building.status === 'ready' &&
        (building.info ? (
          <Facts info={building.info} />
        ) : (
          <p className={styles.note}>{address.country === 'LI' ? t.noRecordLi : t.noRecord}</p>
        ))}
      <p className={styles.source}>{t.source}</p>
    </section>
  );
}
