// Monkey-patch global fetch to log outgoing Responses API headers
const originalFetch = globalThis.fetch
globalThis.fetch = async function (url, options) {
  if (typeof url === 'string' && url.includes('/responses')) {
    console.log('\n=== Outgoing Responses API request ===')
    console.log('URL:', url)
    const headers = {}
    if (options?.headers) {
      if (options.headers instanceof Headers) {
        for (const [k, v] of options.headers.entries()) headers[k] = v
      } else if (Array.isArray(options.headers)) {
        for (let i = 0; i < options.headers.length; i += 2) headers[options.headers[i]] = options.headers[i + 1]
      } else {
        Object.assign(headers, options.headers)
      }
    }
    const relevantHeaders = {}
    for (const k of ['user-agent', 'originator', 'session-id', 'thread-id', 'x-client-request-id', 'x-codex-window-id', 'x-codex-beta-features', 'authorization', 'accept', 'content-type']) {
      if (headers[k]) relevantHeaders[k] = k === 'authorization' ? headers[k].slice(0, 16) + '...' : headers[k]
    }
    console.log('Headers:', JSON.stringify(relevantHeaders, null, 2))
    if (options?.body && typeof options.body === 'string' && options.body.length < 2000) {
      try {
        const body = JSON.parse(options.body)
        console.log('Body keys:', Object.keys(body).join(', '))
        if (body.prompt_cache_key) console.log('  prompt_cache_key:', body.prompt_cache_key)
        if (body.client_metadata) console.log('  client_metadata:', JSON.stringify(body.client_metadata))
      } catch {}
    }
  }
  return originalFetch.call(this, url, options)
}

await import('./scripts/backend-api.mjs')
