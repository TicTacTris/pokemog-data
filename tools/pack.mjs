import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { evolutionMetadata } from './evolution-metadata.mjs'
import { PACK_LIMIT, MANIFEST_LIMIT, id, ids, integer, keys, utf8, strictJson, validateGraph } from './contract.mjs'
export const PIN = '04ee0835e80f30c45376415725c0039cbdd12c5e'
export const names = ['pokemon.json', 'cp-multipliers.json', 'evolution-metadata.json', 'PVPoke-LICENSE.txt']
export const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export async function readPack(dir) {
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(`${dir}/${name}`)])))
}
export function validate(pack, minimum = 1000) {
  keys(pack, names)
  for (const name of names) { assert.ok(Buffer.isBuffer(pack[name])); integer(pack[name].length, PACK_LIMIT) }
  assert.ok(names.reduce((total, name) => total + pack[name].length, 0) <= PACK_LIMIT, 'Total pack size')
  const pokemon = strictJson(pack['pokemon.json'])
  const cpms = strictJson(pack['cp-multipliers.json'], false)
  const report = strictJson(pack['evolution-metadata.json'])
  keys(report, ['commit', 'missingFamilyMetadata', 'terminalWithFamilyMetadata', 'remappedShadowEdges', 'omittedShadowEdges', 'correctedEdges'])
  assert.equal(typeof report.commit, 'string')
  assert.match(report.commit, /^[a-fA-F0-9]{40}$/)
  for (const key of ['missingFamilyMetadata', 'terminalWithFamilyMetadata', 'remappedShadowEdges', 'omittedShadowEdges', 'correctedEdges']) assert.ok(Array.isArray(report[key]), key)
  assert.ok(Array.isArray(cpms) && cpms.length === 101, '101 multipliers required')
  assert.ok(cpms.every((n, i) => Number.isFinite(n) && n > 0 && n < 1 && (!i || n > cpms[i - 1])), 'Invalid multipliers')
  integer(minimum, 20000)
  assert.ok(Array.isArray(pokemon) && pokemon.length >= minimum && pokemon.length <= 20000, 'Pokemon count decrease guard / catalog limit')
  const byId = new Map(pokemon.map(p => [p.id, p]))
  assert.equal(byId.size, pokemon.length, 'Duplicate IDs')
  for (const p of pokemon) {
    keys(p, ['id', 'name', 'attack', 'defense', 'stamina', 'evolutions', ...['normalId', 'shadowId'].filter(key => Object.hasOwn(p, key))])
    id(p.id)
    assert.ok(!p.id.includes('_mega') && !p.id.includes('_primal'))
    // Kotlin Char.isWhitespace includes these characters, but not the BOM.
    assert.ok(typeof p.name === 'string' && p.name.length <= 160 && /[^\u0009-\u000d\u001c-\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/.test(p.name) && !/[\x00-\x1f]/.test(p.name), 'Invalid name')
    for (const stat of ['attack', 'defense', 'stamina']) integer(p[stat], 10000)
    ids(p.evolutions)
    for (const target of p.evolutions) assert.ok(byId.has(target) && target.endsWith('_shadow') === p.id.endsWith('_shadow'), `Invalid evolution: ${target}`)
    const normal = p.id.endsWith('_shadow') && byId.has(p.id.slice(0, -7)) ? p.id.slice(0, -7) : undefined
    const shadow = !p.id.endsWith('_shadow') && byId.has(`${p.id}_shadow`) ? `${p.id}_shadow` : undefined
    for (const key of ['normalId', 'shadowId']) if (Object.hasOwn(p, key)) id(p[key])
    assert.equal(p.normalId, normal); assert.equal(p.shadowId, shadow)
    if (normal || shadow) for (const stat of ['attack', 'defense', 'stamina']) assert.equal(p[stat], byId.get(normal || shadow)[stat], 'Counterpart base stats')
  }
  const missing = new Set(ids(report.missingFamilyMetadata)), terminal = new Set(ids(report.terminalWithFamilyMetadata)), omitted = new Set()
  for (const key of [...missing, ...terminal]) assert.ok(byId.has(key) && !(missing.has(key) && terminal.has(key)))
  for (const field of ['remappedShadowEdges', 'omittedShadowEdges', 'correctedEdges']) {
    const seen = new Set()
    for (const row of report[field]) {
      assert.ok(Array.isArray(row) && row.length === (field === 'omittedShadowEdges' ? 2 : 3))
      row.forEach(id)
      assert.ok(!seen.has(JSON.stringify(row))); seen.add(JSON.stringify(row))
      assert.ok(byId.has(row[0]))
      const edges = byId.get(row[0]).evolutions
      if (field === 'omittedShadowEdges') {
        assert.ok(row[0].endsWith('_shadow') && !edges.includes(row[1]))
        if (row[1].endsWith('_shadow')) assert.ok(['scyther_shadow:kleavor_shadow', 'girafarig_shadow:farigiraf_shadow', 'stantler_shadow:wyrdeer_shadow'].includes(`${row[0]}:${row[1]}`) && !byId.has(row[1]))
        else assert.ok(!byId.has(`${row[1]}_shadow`))
        omitted.add(row[0])
      } else {
        assert.ok(edges.includes(row[2]))
        if (field === 'remappedShadowEdges') assert.ok(row[0].endsWith('_shadow') && !row[1].endsWith('_shadow') && row[2] === `${row[1]}_shadow`)
        else assert.deepEqual(row, ['rockruff', 'lycranroc_dusk', 'lycanroc_dusk'])
      }
    }
  }
  for (const p of pokemon) {
    if (missing.has(p.id) || terminal.has(p.id)) assert.equal(p.evolutions.length, 0)
    assert.ok(p.evolutions.length || missing.has(p.id) || terminal.has(p.id) || omitted.has(p.id), 'Metadata partition')
  }
  validateGraph(pokemon)
  for (const [source, targets] of [['eevee', ['sylveon', 'umbreon']], ['cubone', ['marowak', 'marowak_alolan']], ['slowpoke_galarian', ['slowbro_galarian', 'slowking_galarian']], ['bulbasaur_shadow', ['ivysaur_shadow']]]) {
    if (byId.has(source)) assert.ok(targets.every(target => byId.get(source).evolutions.includes(target)), 'Lost evolution branch')
  }
  const license = utf8(pack['PVPoke-LICENSE.txt'])
  assert.ok(license.length <= MANIFEST_LIMIT && !license.includes('\0'))
  assert.ok(license.startsWith('MIT License') && license.includes('Copyright (c) 2019 pvpoke'), 'Unexpected license')
  return { pokemon, cpms, report }
}
export function transform(master, source, license, commit) {
  assert.ok(Array.isArray(master.pokemon))
  assert.equal(new Set(master.pokemon.map(p => p.speciesId)).size, master.pokemon.length, 'Duplicate upstream IDs')
  const cpms = JSON.parse(source.match(/var cpms = (\[[\d.,\s]+\]);/)?.[1] ?? 'null')?.slice(0, 101)
  const base = master.pokemon
    .filter(p => !p.tags?.some(tag => ['mega', 'supermega', 'primal'].includes(tag)) && !/(?:^|_)(mega|primal)(?:_|$)/.test(p.speciesId))
    .map(p => ({ id: p.speciesId, name: p.speciesName, attack: p.baseStats.atk, defense: p.baseStats.def, stamina: p.baseStats.hp }))
  const { metadata, report } = evolutionMetadata(base, master, commit)
  const pokemon = base.map(p => {
    const { evolutions, normalId, shadowId } = metadata[p.id]
    return { ...p, evolutions, ...(normalId ? { normalId } : {}), ...(shadowId ? { shadowId } : {}) }
  })
  return { 'pokemon.json': json(pokemon), 'cp-multipliers.json': json(cpms), 'evolution-metadata.json': json(report), 'PVPoke-LICENSE.txt': Buffer.from(license) }
}
export function relevantHash(pack) {
  return digest(Buffer.concat(names.map(name => {
    if (name !== 'evolution-metadata.json') return pack[name]
    const { commit, ...warnings } = JSON.parse(pack[name])
    return json(warnings)
  })))
}
export async function writePack(pack, previousVersion = 0) {
  const { report } = validate(pack)
  assert.ok(Number.isSafeInteger(previousVersion) && previousVersion >= 0)
  const datasetVersion = Math.max(Date.now(), previousVersion + 1)
  assert.ok(Number.isSafeInteger(datasetVersion) && datasetVersion > 0)
  const manifest = { schemaVersion: 1, calculationContract: 1, datasetVersion, sourceCommit: report.commit, publishedAt: new Date().toISOString(), files: Object.fromEntries(names.map(name => [name, { size: pack[name].length, sha256: digest(pack[name]) }])) }
  validateManifest(json(manifest))
  await mkdir('dist', { recursive: true })
  for (const name of names) await writeFile(`dist/${name}`, pack[name])
  await writeFile('dist/manifest.json', json(manifest))
  return manifest
}
export function validateManifest(bytes) {
  integer(bytes.length, MANIFEST_LIMIT)
  const manifest = strictJson(bytes)
  keys(manifest, ['schemaVersion', 'calculationContract', 'datasetVersion', 'sourceCommit', 'publishedAt', 'files'])
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.calculationContract, 1)
  integer(manifest.datasetVersion)
  assert.equal(typeof manifest.sourceCommit, 'string'); assert.match(manifest.sourceCommit, /^[a-fA-F0-9]{40}$/)
  assert.equal(typeof manifest.publishedAt, 'string')
  assert.ok(manifest.publishedAt.length <= 40 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(manifest.publishedAt) && Number.isFinite(Date.parse(manifest.publishedAt)))
  // Date.parse normalizes impossible dates such as February 30; Instant rejects them.
  const [year, month, day] = manifest.publishedAt.slice(0, 10).split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  assert.ok(month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
  keys(manifest.files, names)
  for (const entry of Object.values(manifest.files)) {
    keys(entry, ['size', 'sha256']); integer(entry.size, PACK_LIMIT)
    assert.equal(typeof entry.sha256, 'string'); assert.match(entry.sha256, /^[a-fA-F0-9]{64}$/)
  }
  assert.ok(Object.values(manifest.files).reduce((total, entry) => total + entry.size, 0) <= PACK_LIMIT)
  return manifest
}
