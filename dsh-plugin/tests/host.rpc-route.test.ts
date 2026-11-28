/** The rc.5 compatibility route: same wire format as Connection RPC, owner-only, fenced by connection.admit. */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { channelRoute, type PeerLike } from '../src/host/rpc-route.ts'
import { apply } from '../src/host/index.ts'
import { NodeSubprocess } from './helpers/node-subprocess.ts'
import { tempDir } from './helpers/fixtures.ts'

let server: Server | undefined
afterEach(async () => { await new Promise<void>(resolve => { if (server) server.close(() => { resolve() }); else resolve() }); server = undefined })

async function serve(admit: (req: IncomingMessage) => { rejection: number } | { peer: PeerLike }) {
  const calls: { endpoint: string; payload: unknown; peer: PeerLike }[] = []
  const route = channelRoute('/bead-atlas', { admit }, async (endpoint, payload, _signal, peer) => {
    calls.push({ endpoint, payload, peer })
    return { ok: true, value: { echo: payload } }
  })
  server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise<void>(resolve => { server?.listen(0, '127.0.0.1', () => { resolve() }) })
  const port = (server.address() as AddressInfo).port
  const post = (path: string, body: unknown, type = 'application/json') => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { calls, post, port }
}

const message = (method: string, payload: unknown = {}) => ({ type: 'client-request', rpcId: 'r-1', method, payload })

describe('channelRoute', () => {
  it('answers a Connection RPC envelope', async () => {
    const { calls, post } = await serve(() => ({ peer: { principal: { kind: 'owner' } } }))
    const response = await post('/bead-atlas/listJobs', message('listJobs', { a: 1 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ type: 'server-response', rpcId: 'r-1', result: { ok: true, value: { echo: { a: 1 } } } })
    expect(calls[0]?.endpoint).toBe('listJobs')
  })

  it('passes the admission rejection through without calling the handler', async () => {
    const { calls, post } = await serve(() => ({ rejection: 401 }))
    const response = await post('/bead-atlas/listJobs', message('listJobs'))
    expect(response.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('rejects GET, bad paths, wrong content type, and mismatched methods', async () => {
    const { calls, post, port } = await serve(() => ({ peer: { principal: { kind: 'owner' } } }))
    expect((await fetch(`http://127.0.0.1:${port}/bead-atlas/listJobs`)).status).toBe(404)
    expect((await post('/bead-atlas/../etc/passwd', message('x'))).status).toBe(404)
    expect((await post('/bead-atlas/a/%2e%2e', message('x'))).status).toBe(404)
    expect((await post('/bead-atlas/listJobs', 'x', 'text/plain')).status).toBe(415)
    expect((await post('/bead-atlas/listJobs', '{not json')).status).toBe(400)
    const mismatch = await (await post('/bead-atlas/listJobs', message('deleteJob'))).json() as { result: { ok: boolean; error: { code: string } } }
    expect(mismatch.result.error.code).toBe('gateway/bad-request')
    expect(calls).toHaveLength(0)
  })
})

describe('host entry fallback', () => {
  it('mounts the route on webServer when rpc.handle throws (DSH 0.2.2-rc.5)', async () => {
    process.env.DSH_HOME = tempDir('dsh home')
    const routes: { kind: string; path: string }[] = []
    const effects: (() => unknown)[] = []
    apply({
      subprocess: new NodeSubprocess(),
      inject: (_deps, callback) => {
        callback({
          connection: {
            admit: () => ({ rejection: 401 }),
            rpc: { handle: () => { throw new Error('cannot get property "webServer" without inject') } },
          },
          webServer: { register: (route) => { routes.push(route); return () => {} } },
          effect: (factory) => { effects.push(factory()); return undefined },
        })
        return undefined
      },
      effect: (factory) => { effects.push(factory()); return undefined },
    })
    expect(routes).toEqual([expect.objectContaining({ kind: 'prefix', path: '/bead-atlas' })])
    for (const dispose of effects) await dispose()
  })
})
