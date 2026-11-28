/**
 * Compatibility mount for the `/bead-atlas` Connection RPC channel.
 *
 * DSH 0.2.2-rc.5 (current npm `latest`) exposes `connection.rpc.handle`, but its
 * registration reads `owner.webServer` inside a Cordis effect, which throws
 * `cannot get property "webServer" without inject` for plugin contexts. Upstream
 * master fixed this (`owner.get('webServer')` in client/connection rpc-host.ts).
 * No rc.5 package calls `rpc.handle` on the Host, so the bug is latent there.
 *
 * When `rpc.handle` is unusable, this module mounts the same channel directly on
 * the composition's `webServer`, the way rc.5's own Host routes do (open-in-app,
 * client-connection's /api): every request passes `connection.admit(req)` (the
 * Host/Origin fence plus browser or API authentication), and only the owner Peer
 * reaches the handler. The wire format is Connection RPC's: POST
 * `/bead-atlas/<endpoint>`, JSON `{ type: 'client-request', rpcId, method,
 * payload }` in, `{ type: 'server-response', rpcId, result }` out, so the
 * Client's `connection.rpc.call` is unchanged.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Largest request body accepted on the channel (base64 of the 15 MiB image cap plus envelope). */
export const MAX_CHANNEL_BODY_BYTES = 24 * 1024 * 1024

const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/

export interface PeerLike {
  readonly principal: { readonly kind: string }
}

export interface AdmitLike {
  admit(request: IncomingMessage): { rejection: number } | { peer: PeerLike }
}

export type ChannelHandler = (endpoint: string, payload: unknown, signal: AbortSignal, peer: PeerLike) => Promise<unknown>

export interface WebRouteLike {
  readonly kind: 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  if (endpoint.split('/').some(segment => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT.test(segment))) return undefined
  return endpoint
}

function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  if (res.headersSent || res.destroyed) return
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function envelope(rpcId: string, result: unknown): string {
  return JSON.stringify({ type: 'server-response', rpcId, result })
}

/**
 * Build the prefix route for one channel.
 * @param channel - channel path, e.g. `/bead-atlas`.
 * @param connection - the Host Connection service (for `admit`).
 * @param handler - endpoint handler returning `{ ok, value }` or `{ ok: false, error }`.
 */
export function channelRoute(channel: string, connection: AdmitLike, handler: ChannelHandler): WebRouteLike {
  return {
    kind: 'prefix',
    path: channel,
    handler: async (req, res) => {
      const admission = connection.admit(req)
      if ('rejection' in admission) {
        send(res, admission.rejection, admission.rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      const endpoint = endpointFromPath(channel, new URL(req.url ?? '/', 'http://dsh.internal').pathname)
      if (req.method !== 'POST' || endpoint === undefined) { send(res, 404, 'not found'); return }
      if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        send(res, 415, 'content type must be application/json')
        return
      }
      const declared = Number(req.headers['content-length'] ?? 0)
      if (declared > MAX_CHANNEL_BODY_BYTES) { send(res, 413, 'request too large'); req.destroy(); return }
      const abort = new AbortController()
      res.on('close', () => { if (!res.writableEnded) abort.abort() })
      const chunks: Buffer[] = []
      let received = 0
      for await (const chunk of req) {
        received += (chunk as Buffer).byteLength
        if (received > MAX_CHANNEL_BODY_BYTES) { send(res, 413, 'request too large'); req.destroy(); return }
        chunks.push(chunk as Buffer)
      }
      let body: { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown }
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body } catch { send(res, 400, 'body is not JSON'); return }
      const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request'
      if (body?.type !== 'client-request' || typeof body.rpcId !== 'string' || typeof body.method !== 'string') {
        send(res, 200, envelope(rpcId, { ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: { issues: [] } } }), 'application/json')
        return
      }
      if (body.method !== endpoint) {
        send(res, 200, envelope(rpcId, { ok: false, error: { code: 'gateway/bad-request', message: `method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(endpoint)}`, details: { issues: [] } } }), 'application/json')
        return
      }
      try {
        const result = await handler(endpoint, body.payload, abort.signal, admission.peer)
        send(res, 200, envelope(rpcId, result), 'application/json')
      } catch (error) {
        send(res, 500, `handler failure: ${String(error)}`)
      }
    },
  }
}
