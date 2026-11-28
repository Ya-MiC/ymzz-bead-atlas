/** Materials list from usage.json, as the Host summarized it. */
import type { MaterialRow } from '../remote/types.ts'
import { formatNumber } from './format.ts'
import type { Translate } from './locales.ts'
import css from '../../styles/bead-atlas.module.css'

export interface MaterialsTableProps {
  readonly t: Translate
  readonly materials: readonly MaterialRow[]
}

export function MaterialsTable({ t, materials }: MaterialsTableProps) {
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <caption className={css.cardTitle}>{t('materials.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('materials.hex')}</th>
            <th scope="col">{t('materials.code')}</th>
            <th scope="col">{t('materials.name')}</th>
            <th scope="col" className={css.numeric}>{t('materials.count')}</th>
            <th scope="col" className={css.numeric}>{t('materials.purchase')}</th>
            <th scope="col" className={css.numeric}>{t('materials.packs')}</th>
          </tr>
        </thead>
        <tbody>
          {materials.map(row => (
            <tr key={`${row.code}-${row.referenceHex}`}>
              <td>
                <span className={css.swatchCell}>
                  <span className={css.swatch} style={{ backgroundColor: row.referenceHex }} aria-hidden="true" />
                  <code className={css.code}>{row.referenceHex}</code>
                </span>
              </td>
              <td><strong>{row.code}</strong></td>
              <td>{row.name}</td>
              <td className={css.numeric}>{formatNumber(row.beadCount)}</td>
              <td className={css.numeric}>{formatNumber(row.purchaseBeads)}</td>
              <td className={css.numeric}>{formatNumber(row.packsToBuy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
