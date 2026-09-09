import test from 'node:test'
import assert from 'node:assert/strict'
import { download, initialUrl, REPO } from '../tools/download.mjs'
const api = `https://api.github.com/repos/${REPO}/releases/assets/1`
test('initial download requires HTTPS and exact expected repository', () => {
  for (const url of ['http://api.github.com/repos/' + REPO, 'https://api.github.com/repos/other/repo', 'https://github.com/other/repo/releases/download/x/a', 'https://objects.githubusercontent.com/a', 'https://api.github.com.evil.test/repos/' + REPO, 'https://user@api.github.com/repos/' + REPO, 'https://api.github.com/repos/' + REPO + '/%2e%2e/other']) assert.throws(() => initialUrl(url))
  initialUrl(api)
})
test('draft API redirects preserve accept, strip authorization permanently and share deadline', async () => {
  const calls = []
  const bytes = await download(api, { limit: 10, token: 'test-only', accept: 'application/octet-stream', fetcher: async (url, options) => {
    calls.push({ url, options })
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/test' } })
    if (calls.length === 2) return new Response(null, { status: 302, headers: { location: api } })
    return new Response('ok')
  } })
  assert.equal(bytes.toString(), 'ok')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only')
  for (const { options } of calls.slice(1)) { assert.equal(options.headers.Authorization, undefined); assert.equal(options.signal, calls[0].options.signal); assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Accept, 'application/octet-stream') }
})
test('redirect destinations and hop count are bounded', async () => {
  for (const location of ['http://github.com/a', 'https://evil.test/a', 'https://github.com:444/a', 'https://user@github.com/a']) await assert.rejects(download(api, { limit: 10, fetcher: async () => new Response(null, { status: 302, headers: { location } }) }))
  let calls = 0
  await assert.rejects(download(api, { limit: 10, fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { location: api } }) } }), /Redirect limit/)
  assert.equal(calls, 5)
})
test('streamed actual bytes, declared size and missing response handling', async () => {
  await assert.rejects(download(api, { limit: 2, fetcher: async () => new Response('abc') }), /body exceeds/)
  await assert.rejects(download(api, { limit: 2, fetcher: async () => new Response('a', { headers: { 'content-length': '3' } }) }), /Content-Length/)
  assert.equal((await download(api, { limit: 2, fetcher: async () => new Response('ab') })).length, 2)
  assert.equal(await download(api, { limit: 2, allowMissing: true, fetcher: async () => new Response(null, { status: 404 }) }), null)
  await assert.rejects(download(api, { limit: 2, fetcher: async () => new Response(null, { status: 404 }) }), /HTTP 404/)
})
test('deadline interrupts a stalled body through fetch AbortSignal', async () => {
  await assert.rejects(download(api, { limit: 2, timeout: 10, fetcher: async (_, { signal }) => new Response(new ReadableStream({ start(controller) { const timer = setTimeout(() => controller.close(), 1000); signal.addEventListener('abort', () => { clearTimeout(timer); controller.error(signal.reason) }, { once: true }) } })) }), /timeout|aborted/i)
})
