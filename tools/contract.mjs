import assert from 'node:assert/strict'

export const PACK_LIMIT = 8 * 1024 * 1024
export const MANIFEST_LIMIT = 64 * 1024
export const id = value => { assert.equal(typeof value, 'string'); assert.match(value, /^[a-z0-9][a-z0-9_]{0,127}$/); return value }
export const integer = (value, max = Number.MAX_SAFE_INTEGER) => { assert.ok(Number.isSafeInteger(value) && value > 0 && value <= max, 'Invalid positive integer'); return value }
export function keys(value, expected) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort())
}
export function ids(values) {
  assert.ok(Array.isArray(values))
  values.forEach(id)
  assert.equal(new Set(values).size, values.length)
  return values
}
export const utf8 = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)

// JSON.parse alone loses duplicate keys and integer-token distinctions.
export function strictJson(bytes, integerTokens = true) {
  const text = utf8(bytes)
  let at = 0
  const space = () => { while (at < text.length && /[ \r\n\t]/.test(text[at])) at++ }
  function string() {
    const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(text.slice(at))
    assert.ok(match, 'Invalid JSON string')
    at += match[0].length
    return JSON.parse(match[0])
  }
  function value(depth) {
    assert.ok(depth <= 32, 'JSON nesting limit')
    space()
    if (text[at] === '{' || text[at] === '[') {
      const object = text[at++] === '{', end = object ? '}' : ']'
      const seen = new Set()
      space()
      if (text[at] === end) { at++; return }
      while (true) {
        space()
        if (object) {
          const key = string()
          assert.ok(!seen.has(key), 'Duplicate JSON key'); seen.add(key)
          space(); assert.equal(text[at++], ':')
        }
        value(depth + 1); space()
        const next = text[at++]
        if (next === end) return
        assert.equal(next, ',')
      }
    } else if (text[at] === '"') string()
    else {
      const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at))
      assert.ok(match, 'Invalid JSON token')
      if (integerTokens && /^-?[0-9]/.test(match[0])) assert.match(match[0], /^-?(?:0|[1-9][0-9]*)$/, 'Expected integer token')
      at += match[0].length
    }
  }
  value(0); space(); assert.equal(at, text.length)
  const result = JSON.parse(text)
  assert.ok(result && typeof result === 'object')
  return result
}

export function validateGraph(pokemon) {
  const byId = new Map(pokemon.map(p => [p.id, p]))
  const incoming = new Map(pokemon.map(p => [p.id, 0]))
  for (const p of pokemon) {
    assert.ok(p.evolutions.length <= 32, 'Evolution outdegree limit')
    for (const target of p.evolutions) {
      assert.ok(byId.has(target), 'Unresolved evolution')
      incoming.set(target, incoming.get(target) + 1)
    }
  }
  const pending = pokemon.filter(p => incoming.get(p.id) === 0).map(p => p.id)
  for (let i = 0; i < pending.length; i++) {
    for (const target of byId.get(pending[i]).evolutions) {
      incoming.set(target, incoming.get(target) - 1)
      if (incoming.get(target) === 0) pending.push(target)
    }
  }
  assert.equal(pending.length, pokemon.length, 'Evolution cycle')
  const depths = new Map(), reachable = new Map()
  for (const key of pending.reverse()) {
    let depth = 1
    const reached = new Set([key])
    for (const target of byId.get(key).evolutions) {
      depth = Math.max(depth, 1 + depths.get(target))
      for (const descendant of reachable.get(target)) reached.add(descendant)
      assert.ok(reached.size <= 32, 'Evolution reachable limit (including root)')
    }
    assert.ok(depth <= 16, 'Evolution depth limit (root depth 1)')
    depths.set(key, depth); reachable.set(key, reached)
  }
}
