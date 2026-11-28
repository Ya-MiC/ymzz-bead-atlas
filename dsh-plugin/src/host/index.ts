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
import { channelRoute, type AdmitLike, type WebRouteLike } from './rpc-route.ts'

/** Plugin name shown in diagnostics. */
export const name = 'bead-atlas'

/**
 * Host services this plugin waits for. `webServer` is required because
 * `connection.rpc.handle` mounts the channel route on it (verified against
 * @deepseek-ai/dsh-client-connection 0.2.2-rc.5; upstream timeline injects the same pair).
 */
export const inject = ['subprocess', 'connection', 'webServer']

interface PeerLike {
  readonly principal: { readonly kind: string }
}

type RpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal, peer: PeerLike) => Promise<unknown>

interface ConnectionScope {
  readonly connection: AdmitLike & { readonly rpc: { handle(channel: string, handler: RpcHandler): () => unknown } }
  readonly webServer: { register(route: WebRouteLike): () => void }
  effect(factory: () => () => unknown, label?: string): unknown
}

interface HostContext {
  readonly subprocess: SubprocessLike
  /** Run `callback` with a scope that may read the listed services (Cordis `ctx.inject`). */
  inject(deps: readonly string[], callback: (scope: ConnectionScope) => void): unknown
  effect(factory: () => () => unknown, label?: string): unknown
}

/** Package root: dsh-plugin/lib/index.js → ../../ */
const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Start the service, mount the RPC channel, and stop running jobs on unload.
 * @param ctx - Host plugin context.
 */
export function apply(ctx: HostContext): void {
  const service = new BeadAtlasService({
    subprocess: ctx.subprocess,
    dataRoot: join(resolveDshHome(), 'bead-atlas'),
    engineRoot: ENGINE_ROOT,
  })
  const started = service.start()
  started.catch(() => { /* reported to the caller by the first request below */ })
  const handler: RpcHandler = async (endpoint, payload, signal, peer) => {
    if (peer.principal.kind !== 'owner') {
      return { ok: false, error: { code: 'bead-atlas/forbidden', message: 'Bead Atlas requires owner access.', details: {} } }
    }
    try {
      await started
    } catch (error) {
      return { ok: false, error: { code: 'bead-atlas/internal', message: `data directory unavailable: ${error instanceof Error ? error.message : String(error)}`, details: {} } }
    }
    return await service.dispatch(endpoint, payload, signal)
  }
  // Same registration shape as upstream experimental/timeline: the channel route
  // lives on webServer, so it is mounted from a scope that injects both.
  ctx.inject(['connection', 'webServer'], (scope) => {
    try {
      scope.connection.rpc.handle(BEAD_ATLAS_CHANNEL, handler)
    } catch {
      // DSH 0.2.2-rc.5: rpc.handle cannot reach webServer from a plugin context.
      // Mount the identical channel directly; see rpc-route.ts.
      // Read both services here: rc.5's failure is reading them inside the effect.
      const webServer = scope.webServer
      const route = channelRoute(BEAD_ATLAS_CHANNEL, scope.connection, handler)
      scope.effect(() => webServer.register(route), 'bead-atlas: rpc channel (rc.5 route)')
    }
  })
  ctx.effect(() => () => service.dispose(), 'bead-atlas: running jobs')
}
