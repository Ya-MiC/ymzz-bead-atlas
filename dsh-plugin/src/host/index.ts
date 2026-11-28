/**
 * Host half of the Bead Atlas DSH plugin (Cordis entry).
 *
 * It registers one authenticated Connection RPC channel, `/bead-atlas`, that
 * only the owner Peer may call, and runs the bundled Python engine through
 * `ctx.subprocess`. Data lives in DSH_HOME/bead-atlas.
 */
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import { BEAD_ATLAS_CHANNEL } from '../remote/types.ts'
import { BeadAtlasService } from './bead-atlas-service.ts'
import type { SubprocessLike } from './python-runner.ts'

/** Plugin name shown in diagnostics. */
export const name = 'bead-atlas'

/** Host services this plugin waits for. */
export const inject = ['subprocess', 'connection']

interface PeerLike {
  readonly principal: { readonly kind: string }
}

interface HostContext {
  readonly subprocess: SubprocessLike
  readonly connection: {
    readonly rpc: {
      handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal, peer: PeerLike) => Promise<unknown>): () => Promise<void>
    }
  }
  effect(factory: () => () => unknown, label?: string): unknown
  logger?(name: string): { info(...args: unknown[]): void; warn(...args: unknown[]): void }
}

/** Package root: dsh-plugin/lib/index.js → ../../ */
const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Start the service, mount the RPC channel, and stop running jobs on unload.
 * @param ctx - Host plugin context.
 */
export async function apply(ctx: HostContext): Promise<void> {
  const service = new BeadAtlasService({
    subprocess: ctx.subprocess,
    dataRoot: join(resolveDshHome(), 'bead-atlas'),
    engineRoot: ENGINE_ROOT,
  })
  await service.start()
  ctx.effect(() => ctx.connection.rpc.handle(BEAD_ATLAS_CHANNEL, async (endpoint, payload, signal, peer) => {
    if (peer.principal.kind !== 'owner') {
      return { ok: false, error: { code: 'bead-atlas/forbidden', message: 'Bead Atlas requires owner access.', details: {} } }
    }
    return await service.dispatch(endpoint, payload, signal)
  }), 'bead-atlas: rpc channel')
  ctx.effect(() => () => service.dispose(), 'bead-atlas: running jobs')
}
