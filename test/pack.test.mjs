import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { PIN, readPack, validate, transform, relevantHash, json } from '../tools/pack.mjs'
const baseline = await readPack('baseline')
const original = validate(baseline)
const changed = (name, change) => {
  const value = JSON.parse(baseline[name])
  change(value)
  return { ...baseline, [name]: json(value) }
}
test('baseline pin and Toxel branches match the shipped Android model', () => {
  assert.equal(original.report.commit, PIN)
  assert.deepEqual(original.pokemon.find(p => p.id === 'toxel').evolutions, ['toxtricity_amped', 'toxtricity_low_key'])
  assert.ok(original.pokemon.every(p => !('form' in p)))
})
test('strict numeric, ID, graph, count and license validation', () => {
  for (const n of [null, 0, -1, 1.5, 1001, '118']) {
    assert.throws(() => validate(changed('pokemon.json', p => { p[0].attack = n })))
  }
  for (const n of [null, 0, 1, -1, '0.1']) {
    assert.throws(() => validate(changed('cp-multipliers.json', c => { c[0] = n })))
  }
  assert.throws(() => validate(changed('cp-multipliers.json', c => c.pop())))
  assert.throws(() => validate(changed('cp-multipliers.json', c => { c[1] = c[0] })))
  assert.throws(() => validate(changed('pokemon.json', p => { p[1].id = p[0].id })))
  assert.throws(() => validate(changed('pokemon.json', p => { p[0].name = ' ' })))
  assert.throws(() => validate(changed('pokemon.json', p => { p[0].evolutions = ['missing'] })))
  assert.throws(() => validate(changed('pokemon.json', p => { p[0].evolutions = [p[0].id] })))
  assert.throws(() => validate(changed('pokemon.json', p => { p[0].shadowId = 'wrong' })))
  assert.throws(() => validate(baseline, original.pokemon.length + 1))
  assert.throws(() => validate({ ...baseline, 'PVPoke-LICENSE.txt': Buffer.from('bad') }))
  assert.throws(() => validate(changed('evolution-metadata.json', r => { r.commit = 'invalid' })))
  // Legitimate stat/CPM changes are allowed, not compared against stale fixture stats.
  validate(changed('pokemon.json', p => { p[0].attack += 1 }))
  validate(changed('cp-multipliers.json', c => { c[0] *= 0.999 }))
})
test('only provenance commit is ignored for relevance', () => {
  assert.equal(relevantHash(baseline), relevantHash(changed('evolution-metadata.json', r => { r.commit = 'a'.repeat(40) })))
  assert.notEqual(relevantHash(baseline), relevantHash(changed('pokemon.json', p => { p[0].attack++ })))
  assert.notEqual(relevantHash(baseline), relevantHash(changed('evolution-metadata.json', r => { r.correctedEdges.push(['x', 'y', 'z']) })))
  assert.notEqual(relevantHash(baseline), relevantHash({ ...baseline, 'PVPoke-LICENSE.txt': Buffer.concat([baseline['PVPoke-LICENSE.txt'], Buffer.from('\n')]) }))
})
const species = (id, edges = [], tags = []) => ({ speciesId: id, speciesName: id, baseStats: { atk: 100, def: 100, hp: 100 }, family: { evolutions: edges }, tags })
const run = pokemon => transform({ pokemon }, `var cpms = ${JSON.stringify(original.cpms)};`, baseline['PVPoke-LICENSE.txt'], PIN)
test('synthetic filters, typo correction and shadow remapping', () => {
  const pack = run([species('rockruff', ['lycranroc_dusk']), species('lycanroc_dusk'), species('a', ['b']), species('b'), species('a_shadow', ['b']), species('b_shadow'), species('x_mega'), species('x_primal'), species('x', [], ['supermega'])])
  const { pokemon, report } = validate(pack, 1)
  assert.equal(pokemon.length, 6)
  assert.deepEqual(pokemon.find(p => p.id === 'rockruff').evolutions, ['lycanroc_dusk'])
  assert.deepEqual(pokemon.find(p => p.id === 'a_shadow').evolutions, ['b_shadow'])
  assert.equal(report.correctedEdges.length, 1)
  assert.equal(report.remappedShadowEdges.length, 1)
})
test('known unavailable edges recover when upstream adds the target', () => {
  const source = species('scyther_shadow', ['kleavor_shadow'])
  assert.deepEqual(validate(run([source]), 1).pokemon[0].evolutions, [])
  assert.deepEqual(validate(run([source, species('kleavor_shadow')]), 1).pokemon[0].evolutions, ['kleavor_shadow'])
  assert.deepEqual(validate(run([species('a_shadow', ['b']), species('b')]), 1).pokemon[0].evolutions, [])
})
test('transform fails malformed source, missing edges, cycles and lost branches', () => {
  assert.throws(() => run([species('a', ['missing'])]))
  assert.throws(() => run([species('a', ['b']), species('b', ['a'])]))
  assert.throws(() => run([species('a'), species('a')]))
  assert.throws(() => run([species('eevee')]))
  for (const n of [NaN, Infinity, -1, 1.5]) {
    const p = species('a'); p.baseStats.atk = n
    assert.throws(() => run([p]))
  }
  assert.throws(() => validate(transform({ pokemon: [species('a')] }, 'no table', baseline['PVPoke-LICENSE.txt'], PIN), 1))
})
test('147 frozen cross-platform mathematical contract rows, independent of candidate data', async () => {
  const rows = async name => {
    assert.ok((await stat(`test/fixtures/${name}`)).size < 1_000_000)
    return (await readFile(`test/fixtures/${name}`, 'utf8')).trim().split('\n').map(row => row.split('\t'))
  }
  const pokemon = new Map((await rows('pokemon.tsv')).map(([id, name, a, d, s]) => [id, [+a, +d, +s]]))
  const cpms = (await rows('cp-multipliers.tsv')).map(([n]) => +n)
  const oracle = await rows('stats-parity.tsv')
  assert.equal(oracle.length, 147)
  for (const [id, ...columns] of oracle) {
    const [ia, idf, is, level, ...expected] = columns.map(Number)
    const base = pokemon.get(id), m = cpms[(level - 1) * 2]
    const a = base[0] + ia, d = base[1] + idf, s = base[2] + is
    // A test-only statement of contract 1, not a production/ranking engine fork.
    const hp = /^shedinja(?:_|$)/.test(id) ? 10 : Math.max(10, Math.floor(s * m))
    const actual = [Math.max(10, Math.floor(a * Math.sqrt(d) * Math.sqrt(s) * m ** 2 / 10)), hp, a * m, d * m, (a * m) * (d * m) * hp]
    actual.forEach((value, i) => assert.ok(Number.isFinite(value) && Math.abs(value - expected[i]) <= Math.max(1e-9, Math.abs(expected[i]) * 1e-12), `${id} level ${level} column ${i}`))
  }
})
