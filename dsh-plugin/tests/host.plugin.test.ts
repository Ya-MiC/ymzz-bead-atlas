/** The Cordis entry: owner-only channel and cleanup, with a stand-in context. */
import { describe, expect, it } from 'vitest'
import { tempDir } from './helpers/fixtures.ts'
import { NodeSubprocess } from './helpers/node-subprocess.ts'

describe('host plugin entry', () => {
  it('registers /bead-atlas and refuses non-owner peers', async () => {
    process.env.DSH_HOME = tempDir('dsh home')
    const { apply, inject, name } = await import('../src/host/index.ts')
    expect(name).toBe('bead-atlas')
    expect(inject).toEqual(['subprocess', 'connection', 'webServer'])
    let channel = ''
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal, peer: { principal: { kind: string } }) => Promise<unknown>) | undefined
    const disposers: (() => unknown)[] = []
    const injected: string[][] = []
    apply({
      subprocess: new NodeSubprocess(),
      inject: (deps, callback) => {
        injected.push([...deps])
        callback({
          connection: { admit: () => ({ rejection: 401 }), rpc: { handle: (name, fn) => { channel = name; handler = fn; return () => {} } } },
          webServer: { register: () => { throw new Error('must not mount the fallback route when rpc.handle works') } },
          effect: () => undefined,
        })
        return undefined
      },
      effect: (factory) => { disposers.push(factory()); return undefined },
    })
    expect(injected).toEqual([['connection', 'webServer']])
    expect(channel).toBe('/bead-atlas')
    const signal = new AbortController().signal
    const guest = await handler?.('listJobs', {}, signal, { principal: { kind: 'guest' } }) as { ok: boolean; error?: { code: string } }
    expect(guest.ok).toBe(false)
    expect(guest.error?.code).toBe('bead-atlas/forbidden')
    const owner = await handler?.('listJobs', {}, signal, { principal: { kind: 'owner' } }) as { ok: boolean; value?: unknown[] }
    expect(owner.ok).toBe(true)
    expect(owner.value).toEqual([])
    for (const dispose of disposers) await dispose()
  })
})
