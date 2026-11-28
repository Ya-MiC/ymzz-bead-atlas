/**
 * Build both halves of the Bead Atlas DSH plugin.
 *
 * - Host: ESM `dsh-plugin/lib/index.js`, loaded by DSH's Cordis loader in Node.
 * - Client: `dsh-plugin/lib/client.js` in the closure-factory form DSH's module
 *   loader expects: `window.__ModuleLoader__.load({ id, factory })`, with platform
 *   modules resolved through the injected `require`. CSS Modules are compiled by
 *   lightningcss and injected as `<style data-plugin data-plugin-css>` tags, the
 *   same convention DSH's own client bundles use.
 */
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'
import { transform } from 'lightningcss'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PLUGIN = join(ROOT, 'dsh-plugin')
const LIB = join(PLUGIN, 'lib')
const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const PACKAGE_ID = manifest.name

/** Modules DSH's web shell supplies to plugin bundles (rc.5 module table). */
const CLIENT_EXTERNALS = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', 'zod',
  '@tanstack/react-virtual', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
])
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)])

/** Compile `*.module.css` into a class map plus a one-time style tag. */
function cssModules() {
  return {
    name: 'bead-atlas-css-modules',
    async load(id) {
      if (!id.endsWith('.module.css')) return null
      const source = await readFile(id)
      const tagId = `${PACKAGE_ID}/${relative(PLUGIN, id).split('\\').join('/')}`
      const result = transform({
        filename: id,
        code: source,
        minify: true,
        cssModules: { pattern: 'ba_[local]_[hash]' },
        targets: { chrome: 110 << 16, safari: 16 << 16, firefox: 110 << 16 },
      })
      const classes = Object.fromEntries(Object.entries(result.exports ?? {}).map(([key, value]) => [
        key,
        [value.name, ...value.composes.map(item => item.name)].join(' '),
      ]))
      const css = result.code.toString()
      return {
        moduleType: 'js',
        code: [
          `const css = ${JSON.stringify(css)};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
          `  const tag = document.createElement('style');`,
          `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_ID)};`,
          `  tag.dataset.pluginCss = tagId;`,
          `  tag.textContent = css;`,
          `  document.head.appendChild(tag);`,
          `}`,
          `export default ${JSON.stringify(classes)};`,
        ].join('\n'),
      }
    },
  }
}

async function buildHost() {
  const bundle = await rolldown({
    input: join(PLUGIN, 'src/host/index.ts'),
    platform: 'node',
    external: id => NODE_BUILTINS.has(id) || id.startsWith('@deepseek-ai/'),
  })
  await bundle.write({ file: join(LIB, 'index.js'), format: 'esm', sourcemap: false })
  await bundle.close()
}

async function buildClient() {
  const bundle = await rolldown({
    input: join(PLUGIN, 'src/client/index.ts'),
    platform: 'browser',
    external: id => CLIENT_EXTERNALS.has(id),
    plugins: [cssModules()],
    transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"production"' } },
  })
  const { output } = await bundle.generate({ format: 'cjs', minify: false, sourcemap: false })
  await bundle.close()
  const chunk = output.find(item => item.type === 'chunk' && item.isEntry)
  if (chunk === undefined || output.filter(item => item.type === 'chunk').length !== 1) {
    throw new Error('client build must produce exactly one chunk')
  }
  for (const id of chunk.imports) {
    if (!CLIENT_EXTERNALS.has(id)) throw new Error(`client bundle imports a module DSH does not provide: ${id}`)
  }
  const wrapped = `window.__ModuleLoader__.load({id:${JSON.stringify(PACKAGE_ID)},factory:require=>{var module={exports:{}};var exports=module.exports;\n${chunk.code}\nreturn module.exports}});\n`
  await writeFile(join(LIB, 'client.js'), wrapped)
}

await rm(LIB, { recursive: true, force: true })
await mkdir(LIB, { recursive: true })
await buildHost()
await buildClient()
console.log(`built ${relative(ROOT, join(LIB, 'index.js'))} and ${relative(ROOT, join(LIB, 'client.js'))} for ${PACKAGE_ID}`)

