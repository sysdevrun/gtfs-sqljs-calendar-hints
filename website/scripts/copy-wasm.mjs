// Copie sql-wasm.wasm de sql.js vers public/ pour qu'il soit servi en
// statique (requis par gtfs-sqljs dans le navigateur).
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const distDir = dirname(require.resolve('sql.js'))
const dest = join(here, '..', 'public')
mkdirSync(dest, { recursive: true })
// sql.js ≥ 1.14 charge sql-wasm-browser.wasm côté navigateur ; on copie
// aussi sql-wasm.wasm par prudence.
for (const name of ['sql-wasm.wasm', 'sql-wasm-browser.wasm']) {
  copyFileSync(join(distDir, name), join(dest, name))
  console.log(`${name} copié vers ${dest}`)
}
