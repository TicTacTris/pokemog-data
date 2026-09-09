import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PIN, json, digest, names, validate, validateManifest, readPack } from '../tools/pack.mjs'
import { PACK_LIMIT, MANIFEST_LIMIT, strictJson, validateGraph } from '../tools/contract.mjs'
import { evolutionMetadata } from '../tools/evolution-metadata.mjs'
const baseline = await readPack('baseline')
const fixtures = JSON.parse(await readFile('test/fixtures/contract-fixtures.json', 'utf8'))
const row = (id, evolutions = []) => ({ id, name: 'Test', attack: 100, defense: 100, stamina: 100, evolutions })
function packFor(pokemon = [row('a')]) {
  return { ...baseline, 'pokemon.json': json(pokemon), 'evolution-metadata.json': json({ commit: PIN, missingFamilyMetadata: [], terminalWithFamilyMetadata: pokemon.filter(p => !p.evolutions.length).map(p => p.id), remappedShadowEdges: [], omittedShadowEdges: [], correctedEdges: [] }) }
}
for (const fixture of fixtures.cases) test(`contract: ${fixture.name}`, () => {
  let pokemon = Array.from({ length: fixture.count || 1 }, (_, i) => row(`p${i}`))
  if (fixture.graph === 'chain') pokemon.forEach((p, i) => { if (i + 1 < pokemon.length) p.evolutions = [pokemon[i + 1].id] })
  if (fixture.graph === 'star') pokemon[0].evolutions = pokemon.slice(1).map(p => p.id)
  if (fixture.field) pokemon[0][fixture.field] = fixture.value
  if (fixture.mutation) {
    pokemon = [{ ...row('a'), shadowId: 'a_shadow' }, { ...row('a_shadow'), normalId: 'a' }]
    if (fixture.mutation === 'counterpartStat') pokemon[1].attack++
    if (fixture.mutation === 'counterpartLink') delete pokemon[1].normalId
    if (fixture.mutation === 'category') pokemon[0].evolutions = ['a_shadow']
  }
  const run = () => validate(packFor(pokemon), 1)
  if (fixture.accepted) assert.doesNotThrow(run)
  else assert.throws(run)
})
test('ID and name length boundaries', () => {
  for (const [field, length, accepted] of [['id', 128, true], ['id', 129, false], ['name', 160, true], ['name', 161, false]]) {
    const p = row('a'); p[field] = 'a'.repeat(length)
    if (accepted) validate(packFor([p]), 1)
    else assert.throws(() => validate(packFor([p]), 1))
  }
})
test('exact JSON grammar, UTF-8, duplicate keys and integer tokens', () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":1.0}', '{"a":1e0}', '{"a":01}', '{"a":true,}', '/*x*/{}', '\ufeff{}', '['.repeat(34) + ']'.repeat(34)]) assert.throws(() => strictJson(Buffer.from(text)))
  assert.throws(() => strictJson(Buffer.from([0xff])))
  assert.deepEqual(strictJson(Buffer.from('[1e-1]'), false), [0.1])
})
test('metadata exact fields, partition, row types, omissions and duplicates', () => {
  const pack = packFor()
  for (const change of [r => { r.extra = [] }, r => { r.terminalWithFamilyMetadata = [] }, r => { r.missingFamilyMetadata = ['a'] }, r => { r.terminalWithFamilyMetadata.push('a') }, r => { r.correctedEdges = [['a', 'b', 'c']] }, r => { r.omittedShadowEdges = [['a', 'b']] }, r => { r.remappedShadowEdges = [true] }]) {
    const report = JSON.parse(pack['evolution-metadata.json']); change(report)
    assert.throws(() => validate({ ...pack, 'evolution-metadata.json': json(report) }, 1))
  }
  const omitted = packFor([row('a_shadow')]), report = JSON.parse(omitted['evolution-metadata.json'])
  report.terminalWithFamilyMetadata = []; report.omittedShadowEdges = [['a_shadow', 'b']]
  validate({ ...omitted, 'evolution-metadata.json': json(report) }, 1)
})
const manifestFor = pack => ({ schemaVersion: 1, calculationContract: 1, datasetVersion: 1, sourceCommit: PIN, publishedAt: '2026-09-09T00:00:00Z', files: Object.fromEntries(names.map(name => [name, { size: pack[name].length, sha256: digest(pack[name]) }])) })
test('manifest exact types, fields, safe version and positive bounded sizes', () => {
  const original = manifestFor(packFor())
  validateManifest(json(original))
  for (const change of [m => { m.extra = 1 }, m => { m.files.extra = m.files['pokemon.json'] }, m => { m.files['pokemon.json'].extra = 1 }, ...[0, -1, true, '1', 1.5, Number.MAX_SAFE_INTEGER + 1].map(n => m => { m.datasetVersion = n }), ...[0, -1, true, '1', PACK_LIMIT + 1].map(n => m => { m.files['pokemon.json'].size = n }), m => { m.files['pokemon.json'].size = PACK_LIMIT }, m => { m.publishedAt = 1 }, m => { m.sourceCommit = 'no' }]) {
    const manifest = structuredClone(original); change(manifest)
    assert.throws(() => validateManifest(json(manifest)))
  }
  assert.throws(() => validateManifest(Buffer.alloc(MANIFEST_LIMIT + 1, 32)))
  assert.throws(() => validateManifest(Buffer.from(JSON.stringify(original).replace('"datasetVersion":1', '"datasetVersion":1.0'))))
  assert.throws(() => validateManifest(json({ ...original, publishedAt: '2026-02-30T00:00:00Z' })))
  validateManifest(json({ ...original, datasetVersion: Number.MAX_SAFE_INTEGER }))
})
test('actual total byte limit, individual positive size, license limit', () => {
  const pack = packFor()
  assert.throws(() => validate({ ...pack, 'PVPoke-LICENSE.txt': Buffer.alloc(0) }, 1))
  assert.throws(() => validate({ ...pack, 'PVPoke-LICENSE.txt': Buffer.alloc(MANIFEST_LIMIT + 1, 65) }, 1))
  const oversized = { ...pack, 'pokemon.json': Buffer.concat([pack['pokemon.json'], Buffer.alloc(PACK_LIMIT - pack['pokemon.json'].length, 32)]) }
  assert.throws(() => validate(oversized, 1))
})
test('iterative transform rejects deep graph without stack overflow; DAG sharing counts unique nodes', () => {
  const base = Array.from({ length: 20000 }, (_, i) => row(`p${i}`, i < 19999 ? [`p${i + 1}`] : []))
  const master = { pokemon: base.map(p => ({ speciesId: p.id, baseStats: { atk: p.attack, def: p.defense, hp: p.stamina }, family: { evolutions: p.evolutions } })) }
  assert.throws(() => evolutionMetadata(base, master, PIN), error => !(error instanceof RangeError) && /depth limit/.test(error.message))
  validateGraph([row('a', ['b', 'c']), row('b', ['d']), row('c', ['d']), row('d')])
  assert.throws(() => validateGraph([row('a', ['b']), row('b', ['a'])]), /cycle/)
})
