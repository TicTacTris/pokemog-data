// One-time import of explicitly approved generated public data, never app code/data broadly.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const app = process.argv[2]
if (!app) throw new Error('Usage: node tools/bootstrap.mjs APP_ROOT')
for (const dir of ['baseline', 'test/fixtures']) await mkdir(dir, { recursive: true })
for (const name of ['pokemon.json', 'cp-multipliers.json', 'evolution-metadata.json', 'PVPoke-LICENSE.txt']) {
  await writeFile(`baseline/${name}`, await readFile(resolve(app, 'android/app/src/main/assets', name)), { flag: 'wx' })
}
for (const name of ['pokemon.tsv', 'cp-multipliers.tsv', 'stats-parity.tsv']) {
  const bytes = await readFile(resolve(app, 'android/app/src/test/resources', name))
  if (bytes.length > 1_000_000) throw new Error('Fixture too large')
  await writeFile(`test/fixtures/${name}`, bytes, { flag: 'wx' })
}
