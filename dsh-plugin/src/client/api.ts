/**
 * Typed calls over DSH's Connection RPC channel. The Host answers every call
 * with `{ ok, value }` or `{ ok: false, error: { code, message, details } }`;
 * transport failures arrive in the same shape with a `gateway/*` code.
 */
import { BEAD_ATLAS_CHANNEL, type BeadAtlasEndpoints, type EndpointName, type RpcOutcome } from '../remote/types.ts'

export type BeadAtlasApi = {
  readonly [K in EndpointName]: (payload: BeadAtlasEndpoints[K]['payload'], signal?: AbortSignal) => Promise<RpcOutcome<BeadAtlasEndpoints[K]['result']>>
}

/** The `connection` service surface this plugin calls (see @deepseek-ai/dsh-client-connection). */
export interface ConnectionLike {
  readonly rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: unknown }>
  }
}

function normalize<T>(result: { ok: boolean; value?: unknown; error?: unknown }): RpcOutcome<T> {
  if (result.ok) return { ok: true, value: result.value as T }
  const error = (result.error ?? {}) as { code?: unknown; message?: unknown; details?: unknown }
  return {
    ok: false,
    error: {
      code: (typeof error.code === 'string' ? error.code : 'bead-atlas/internal') as never,
      message: typeof error.message === 'string' ? error.message : '',
      details: typeof error.details === 'object' && error.details !== null ? error.details as Record<string, unknown> : {},
    },
  }
}

/**
 * Build the API object from the Client's connection.
 * @param connection - `ctx.get('connection')`.
 */
export function createApi(connection: ConnectionLike): BeadAtlasApi {
  const call = (endpoint: EndpointName) => async (payload: unknown, signal?: AbortSignal) => {
    try {
      return normalize(await connection.rpc.call(BEAD_ATLAS_CHANNEL, endpoint, payload, signal))
    } catch (error) {
      return { ok: false as const, error: { code: 'bead-atlas/internal' as const, message: error instanceof Error ? error.message : String(error), details: {} } }
    }
  }
  return {
    getEnvironmentStatus: call('getEnvironmentStatus'),
    listBrands: call('listBrands'),
    createJob: call('createJob'),
    getJob: call('getJob'),
    cancelJob: call('cancelJob'),
    listJobs: call('listJobs'),
    getResultFile: call('getResultFile'),
    deleteJob: call('deleteJob'),
    getConfig: call('getConfig'),
    updateConfig: call('updateConfig'),
  } as BeadAtlasApi
}
