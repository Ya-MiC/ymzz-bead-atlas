/**
 * Bead Atlas Client half. Registers one global panel: the sidebar entry in
 * `sidebar.panellist` and the page in the keyed `main` slot, both under the
 * panel id `bead-atlas`. All work goes to the Host over the `/bead-atlas`
 * Connection RPC channel.
 *
 * The context is typed structurally because the @deepseek-ai client type
 * packages are monorepo-internal; only the members used here are declared.
 */
import type { ComponentType } from 'react'
import { BEAD_ATLAS_PANEL_ID } from '../remote/types.ts'
import { createApi, type BeadAtlasApi, type ConnectionLike } from './api.ts'
import { BeadAtlasIcon } from './BeadAtlasIcon.tsx'
import { BeadAtlasPage } from './BeadAtlasPage.tsx'
import { en, zh } from './locales.ts'

export const name = 'bead-atlas-client'
/** Services this half needs: slot registry, locale tables, and the Connection RPC handle. */
export const inject = ['slots', 'locale', 'connection']

/** Locale namespace for this plugin's copy. */
export const NS = 'bead-atlas'

type Dispose = () => void

export interface BeadAtlasClientContext {
  effect(factory: () => Dispose | (() => void), label?: string): void
  get(name: 'connection'): unknown
  locale: {
    register(namespace: string, tables: Record<string, Record<string, string>>): Dispose
    bind(namespace: string): (key: string, params?: Record<string, string | number>) => string
  }
  slots: {
    inject(slot: string, factory: () => Dispose): void
    register(options: Record<string, unknown>, component: ComponentType<never>): Dispose
  }
}

export interface BeadAtlasInjected {
  readonly api: BeadAtlasApi
}

/**
 * Register the dictionaries, the sidebar entry, and the main panel.
 * @param ctx - DSH Client context with slots, locale, and connection.
 */
export function apply(ctx: BeadAtlasClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'bead-atlas: dictionaries')
  const t = ctx.locale.bind(NS)
  const api = createApi(ctx.get('connection') as ConnectionLike)

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: BEAD_ATLAS_PANEL_ID,
    locale: NS,
    inject: (): BeadAtlasInjected => ({ api }),
  }, BeadAtlasPage as ComponentType<never>))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: BEAD_ATLAS_PANEL_ID,
    order: 40,
    locale: NS,
    label: () => t('panel'),
  }, BeadAtlasIcon as ComponentType<never>))
}
