/** Conversion settings form. Ranges mirror scripts/convert.py; the Host validates again. */
import { useId } from 'react'
import { SETTING_BOUNDS, type BrandCatalog, type ConversionSettings as Settings } from '../remote/types.ts'
import type { BeadAtlasLocaleKey, Translate } from './locales.ts'
import css from '../../styles/bead-atlas.module.css'

export interface ConversionSettingsProps {
  readonly t: Translate
  readonly settings: Settings
  readonly catalog: BrandCatalog | null
  readonly disabled: boolean
  readonly onChange: (next: Settings) => void
}

type NumericField = keyof typeof SETTING_BOUNDS

function NumberField({ t, id, label, field, settings, disabled, onChange, hint }: {
  t: Translate; id: string; label: BeadAtlasLocaleKey; field: NumericField; settings: Settings; disabled: boolean
  onChange: (next: Settings) => void; hint?: string
}) {
  const [min, max, integer] = SETTING_BOUNDS[field]
  return (
    <label className={css.field} htmlFor={`${id}-${field}`}>
      <span className={css.fieldLabel}>{t(label)}</span>
      <input
        id={`${id}-${field}`}
        className={css.input}
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step={integer ? 1 : 0.1}
        value={settings[field]}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.valueAsNumber
          onChange({ ...settings, [field]: Number.isFinite(value) ? value : 0 })
        }}
      />
      {hint !== undefined && <span className={css.fieldHint}>{hint}</span>}
    </label>
  )
}

/** Return the first numeric field outside its range, or null. */
export function invalidField(settings: Settings): NumericField | null {
  for (const [field, [min, max, integer]] of Object.entries(SETTING_BOUNDS) as [NumericField, readonly [number, number, boolean]][]) {
    const value = settings[field]
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return field
    if (field === 'beadMm' && value !== 0 && value < 0.1) return field
  }
  return null
}

export function ConversionSettings({ t, settings, catalog, disabled, onChange }: ConversionSettingsProps) {
  const id = useId()
  const brand = catalog?.brands.find(item => item.id === settings.brand) ?? null
  const shared = { t, id, settings, disabled, onChange }
  return (
    <section className={css.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={css.cardTitle}>{t('settings.title')}</h2>
      <div className={css.formGrid}>
        <label className={`${css.field} ${css.fieldWide}`} htmlFor={`${id}-brand`}>
          <span className={css.fieldLabel}>{t('settings.brand')}</span>
          <select
            id={`${id}-brand`}
            className={css.input}
            value={settings.brand}
            disabled={disabled || catalog === null || settings.preset !== ''}
            onChange={(event) => { onChange({ ...settings, brand: event.target.value }) }}
          >
            {catalog === null && <option value={settings.brand}>{settings.brand}</option>}
            {catalog?.brands.map(item => (
              <option key={item.id} value={item.id}>{t('settings.brandColors', { display: item.display, colors: item.colors })}</option>
            ))}
          </select>
        </label>
        <NumberField {...shared} label="settings.width" field="width" />
        <label className={css.field} htmlFor={`${id}-height`}>
          <span className={css.fieldLabel}>{t('settings.height')}</span>
          <input
            id={`${id}-height`}
            className={css.input}
            type="number"
            min={0}
            max={300}
            step={1}
            value={settings.height === 0 ? '' : settings.height}
            placeholder={t('settings.heightAuto')}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.valueAsNumber
              onChange({ ...settings, height: Number.isFinite(value) ? value : 0 })
            }}
          />
          <span className={css.fieldHint}>{t('settings.heightAuto')}</span>
        </label>
        <NumberField {...shared} label="settings.maxColors" field="maxColors" hint={t('settings.maxColorsHint')} />
        <NumberField {...shared} label="settings.beadMm" field="beadMm" hint={brand === null ? undefined : t('settings.beadAuto', { mm: brand.beadMm })} />
        <label className={css.field} htmlFor={`${id}-background`}>
          <span className={css.fieldLabel}>{t('settings.background')}</span>
          <span className={css.colorRow}>
            <input
              id={`${id}-background`}
              className={css.colorInput}
              type="color"
              value={settings.background.toLowerCase()}
              disabled={disabled}
              onChange={(event) => { onChange({ ...settings, background: event.target.value.toUpperCase() }) }}
            />
            <code className={css.code}>{settings.background}</code>
          </span>
        </label>
        <NumberField {...shared} label="settings.boardWidth" field="boardWidth" />
        <NumberField {...shared} label="settings.boardHeight" field="boardHeight" />
        <NumberField {...shared} label="settings.packSize" field="packSize" />
        <NumberField {...shared} label="settings.sparePercent" field="sparePercent" />
      </div>
      <details className={css.advanced}>
        <summary className={css.summary}>{t('settings.advanced')}</summary>
        <label className={css.field} htmlFor={`${id}-preset`}>
          <span className={css.fieldLabel}>{t('settings.preset')}</span>
          <select
            id={`${id}-preset`}
            className={css.input}
            value={settings.preset}
            disabled={disabled || catalog === null}
            onChange={(event) => {
              const preset = catalog?.presets.find(item => item.name === event.target.value)
              onChange({ ...settings, preset: event.target.value, brand: preset?.brand ?? settings.brand })
            }}
          >
            <option value="">{t('settings.presetNone')}</option>
            {catalog?.presets.map(item => <option key={item.name} value={item.name}>{`${item.name} · ${item.brand}`}</option>)}
          </select>
          <span className={css.fieldHint}>{t('settings.presetNote')}</span>
        </label>
      </details>
    </section>
  )
}
