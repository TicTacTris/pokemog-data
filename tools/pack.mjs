import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { evolutionMetadata } from './evolution-metadata.mjs'
export const PIN = '04ee0835e80f30c45376415725c0039cbdd12c5e'
export const names = ['pokemon.json', 'cp-multipliers.json', 'evolution-metadata.json', 'PVPoke-LICENSE.txt']
export const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export async function readPack(dir) {
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(`${dir}/${name}`)])))
}
export function validate(pack, minimum = 1000) {
  const pokemon = JSON.parse(pack['pokemon.json'])
  const cpms = JSON.parse(pack['cp-multipliers.json'])
  const report = JSON.parse(pack['evolution-metadata.json'])
  assert.match(report.commit, /^[a-f0-9]{40}$/)
  for (const key of ['missingFamilyMetadata', 'terminalWithFamilyMetadata', 'remappedShadowEdges', 'omittedShadowEdges', 'correctedEdges']) assert.ok(Array.isArray(report[key]), key)
  assert.ok(Array.isArray(cpms) && cpms.length === 101, '101 multipliers required')
  assert.ok(cpms.every((n, i) => Number.isFinite(n) && n > 0 && n < 1 && (!i || n > cpms[i - 1])), 'Invalid multipliers')
  assert.ok(Array.isArray(pokemon) && pokemon.length >= minimum, 'Pokemon count decrease guard')
  const byId = new Map(pokemon.map(p => [p.id, p]))
  assert.equal(byId.size, pokemon.length, 'Duplicate IDs')
  for (const p of pokemon) {
    assert.match(p.id, /^[a-z0-9_]+$/)
    assert.ok(typeof p.name === 'string' && p.name.trim().length > 0)
    assert.ok([p.attack, p.defense, p.stamina].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000), 'Invalid stats')
    assert.ok(Array.isArray(p.evolutions) && new Set(p.evolutions).size === p.evolutions.length)
    for (const id of p.evolutions) assert.ok(byId.has(id), `Unresolved evolution: ${id}`)
    if (p.normalId !== undefined) {
      assert.equal(p.id, `${p.normalId}_shadow`)
      assert.equal(byId.get(p.normalId)?.shadowId, p.id)
    }
    if (p.shadowId !== undefined) {
      assert.equal(p.shadowId, `${p.id}_shadow`)
      assert.equal(byId.get(p.shadowId)?.normalId, p.id)
    }
  }
  const done = new Set(), active = new Set()
  function visit(id) {
    assert.ok(!active.has(id), `Evolution cycle: ${id}`)
    if (done.has(id)) return
    active.add(id)
    byId.get(id).evolutions.forEach(visit)
    active.delete(id)
    done.add(id)
  }
  pokemon.forEach(p => visit(p.id))
  const license = pack['PVPoke-LICENSE.txt'].toString()
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
  const datasetVersion = Math.max(Date.now(), previousVersion + 1)
  assert.ok(Number.isSafeInteger(datasetVersion) && datasetVersion > 0)
  const manifest = { schemaVersion: 1, calculationContract: 1, datasetVersion, sourceCommit: report.commit, publishedAt: new Date().toISOString(), files: Object.fromEntries(names.map(name => [name, { size: pack[name].length, sha256: digest(pack[name]) }])) }
  await mkdir('dist', { recursive: true })
  for (const name of names) await writeFile(`dist/${name}`, pack[name])
  await writeFile('dist/manifest.json', json(manifest))
  return manifest
}
