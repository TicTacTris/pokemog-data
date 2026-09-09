import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { PIN, names, readPack, validate, transform, relevantHash, writePack, digest } from './pack.mjs'

const repo = 'TicTacTris/pokemog-data'
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
async function request(url, accept = 'application/vnd.github+json', allowMissing = false) {
  const response = await fetch(url, { headers: { Accept: accept, ...(url.startsWith('https://api.github.com/') ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(120_000) })
  if (allowMissing && response.status === 404) return null
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}
async function api(path, allowMissing = false) { return (await request(`https://api.github.com/${path}`, undefined, allowMissing))?.json() }
const gh = args => execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] })
const initial = process.argv.includes('--initial')
const publish = process.argv.includes('--publish')
const baseline = await readPack('baseline')
const baselineData = validate(baseline)
const latestRelease = await api(`repos/${repo}/releases/latest`, initial)
let previous = baseline, previousVersion = 0
if (latestRelease) {
  // A missing/broken latest release must fail closed, not silently reset the baseline.
  const latest = latestRelease
  const manifest = await (await request(latest.assets.find(a => a.name === 'manifest.json').browser_download_url)).json()
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.calculationContract, 1)
  assert.ok(Number.isSafeInteger(manifest.datasetVersion) && manifest.datasetVersion > 0)
  assert.equal(latest.tag_name, `data-${manifest.datasetVersion}`)
  previousVersion = manifest.datasetVersion
  previous = Object.fromEntries(await Promise.all(names.map(async name => {
    const bytes = Buffer.from(await (await request(latest.assets.find(a => a.name === name).browser_download_url)).arrayBuffer())
    assert.equal(bytes.length, manifest.files[name].size)
    assert.equal(digest(bytes), manifest.files[name].sha256)
    return [name, bytes]
  })))
  assert.equal(validate(previous).report.commit, manifest.sourceCommit)
}
if (initial && previousVersion) throw new Error('Initial release already exists')
let commit = PIN
if (!initial) {
  const upstream = await api('repos/pvpoke/pvpoke')
  commit = (await api(`repos/pvpoke/pvpoke/commits/${encodeURIComponent(upstream.default_branch)}`)).sha
}
assert.match(commit, /^[a-f0-9]{40}$/)
const upstreamBase = `https://raw.githubusercontent.com/pvpoke/pvpoke/${commit}/`
const [master, source, license] = await Promise.all(['src/data/gamemaster.json', 'src/js/pokemon/Pokemon.js', 'LICENSE'].map(async path => (await request(upstreamBase + path)).text()))
let candidate = transform(JSON.parse(master), source, license, commit)
const minimum = Math.max(1000, Math.ceil(baselineData.pokemon.length * 0.98), Math.ceil(validate(previous).pokemon.length * 0.98))
const result = validate(candidate, minimum)
if (initial) {
  for (const name of names) assert.deepEqual(candidate[name], baseline[name], `Pinned byte parity: ${name}`)
  candidate = baseline
} else if (relevantHash(candidate) === relevantHash(previous)) {
  console.log(`No relevant output change at ${commit}; no release.`)
  process.exit(0)
}
const manifest = await writePack(candidate, previousVersion)
console.log(JSON.stringify(manifest, null, 2))
if (!publish) process.exit(0)
const tag = `data-${manifest.datasetVersion}`
const body = `PvPoke source: https://github.com/pvpoke/pvpoke/commit/${commit}\n\nSchema 1; calculation contract 1; ${result.pokemon.length} Pokemon; 101 multipliers (levels 1-51).\n\nWarnings/corrections:\n${JSON.stringify(Object.fromEntries(Object.entries(result.report).filter(([key]) => key !== 'commit').map(([key, value]) => [key, value.length])), null, 2)}\n\nFull report: evolution-metadata.json. All four data assets verified by SHA-256 before publication.`
// Never replace a published tag or asset. Incomplete drafts are retained for diagnosis.
const target = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
gh(['release', 'create', tag, '--repo', repo, '--target', target, '--draft', '--title', `PokeMog data ${manifest.datasetVersion}`, '--notes', body])
gh(['release', 'upload', tag, '--repo', repo, ...['manifest.json', ...names].map(name => `dist/${name}`)])
// GitHub's release-by-tag endpoint excludes drafts; the CLI resolves drafts too.
const { apiUrl } = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'apiUrl']))
const draft = await (await request(apiUrl)).json()
assert.equal(draft.draft, true)
assert.deepEqual(draft.assets.map(a => a.name).sort(), ['manifest.json', ...names].sort())
for (const asset of draft.assets) {
  const bytes = Buffer.from(await (await request(asset.url, 'application/octet-stream')).arrayBuffer())
  if (asset.name === 'manifest.json') assert.deepEqual(JSON.parse(bytes), manifest)
  else {
    assert.equal(bytes.length, manifest.files[asset.name].size)
    assert.equal(digest(bytes), manifest.files[asset.name].sha256)
  }
}
gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest'])
const latest = await api(`repos/${repo}/releases/latest`)
assert.equal(latest.tag_name, tag)
console.log(`Published ${latest.html_url}`)
