import assert from 'node:assert/strict'

export const REPO = 'TicTacTris/pokemog-data'
export const limits = { api: 2 * 1024 * 1024, master: 32 * 1024 * 1024, source: 2 * 1024 * 1024, license: 64 * 1024, data: 8 * 1024 * 1024, manifest: 64 * 1024 }
const hosts = new Set(['api.github.com', 'raw.githubusercontent.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
function trusted(url) {
  assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.has(url.hostname), 'Untrusted download URL')
}
export function initialUrl(input) {
  const url = new URL(input)
  trusted(url)
  const path = url.pathname
  assert.ok(!/%|\\|\/\//.test(path), 'Encoded or ambiguous download path')
  assert.ok((url.hostname === 'api.github.com' && [REPO, 'pvpoke/pvpoke'].some(repo => path === `/repos/${repo}` || path.startsWith(`/repos/${repo}/`))) ||
    (url.hostname === 'raw.githubusercontent.com' && /^\/pvpoke\/pvpoke\/[a-f0-9]{40}\/(?:src\/data\/gamemaster\.json|src\/js\/pokemon\/Pokemon\.js|LICENSE)$/.test(path)) ||
    (url.hostname === 'github.com' && path.startsWith(`/${REPO}/releases/download/`)), 'Unexpected initial repository URL')
  return url
}

export async function download(input, { limit, token, accept = 'application/vnd.github+json', allowMissing = false, fetcher = fetch, timeout = 120_000 } = {}) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0)
  let url = initialUrl(input)
  const signal = AbortSignal.timeout(timeout)
  let authorization = url.hostname === 'api.github.com' && token ? `Bearer ${token}` : undefined
  for (let redirects = 0; ; redirects++) {
    const response = await fetcher(url.href, { redirect: 'manual', signal, headers: { Accept: accept, ...(authorization ? { Authorization: authorization } : {}) } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      assert.ok(redirects < 4, 'Redirect limit')
      const location = response.headers.get('location')
      assert.ok(location, 'Missing redirect location')
      const next = new URL(location, url)
      trusted(next)
      if (next.hostname !== url.hostname) authorization = undefined
      url = next
      continue
    }
    if (allowMissing && response.status === 404) { await response.body?.cancel(); return null }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Download HTTP ${response.status}`) }
    const length = response.headers.get('content-length')
    if (length !== null && (!/^[0-9]+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > limit)) {
      await response.body?.cancel(); throw new Error('Download Content-Length exceeds limit')
    }
    assert.ok(response.body, 'Missing response body')
    const reader = response.body.getReader(), chunks = []
    let size = 0
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        assert.ok(size <= limit, 'Download body exceeds limit')
        chunks.push(Buffer.from(value))
      }
      signal.throwIfAborted()
      return Buffer.concat(chunks, size)
    } finally { await reader.cancel(); reader.releaseLock() }
  }
}
