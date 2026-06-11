// Test if gpt-5.5 supports image_generation tool
const KEY = 'sk-b60SS89dVsBvU35rIrETHH7vTAL72PVOa4Fl5eqksgVIwQcl'
const BASE = 'https://testtest.rqey.com/v1'
const sessionId = crypto.randomUUID()

const body = {
  model: 'gpt-5.5',
  instructions: 'You are an image-generation assistant. Use the image_generation tool to generate images.',
  input: [{ role: 'user', content: [{ type: 'input_text', text: '生成一幅画' }] }],
  tools: [{ type: 'image_generation', size: 'auto' }],
  tool_choice: 'auto',
  parallel_tool_calls: true,
  store: false,
  stream: true,
  reasoning: { effort: 'medium' },
  include: ['reasoning.encrypted_content'],
  text: { verbosity: 'low' },
  prompt_cache_key: sessionId,
  client_metadata: {
    'x-codex-installation-id': crypto.randomUUID(),
    'x-codex-window-id': `${sessionId}:0`,
  },
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Accept: 'text/event-stream',
  'User-Agent': 'codex_cli_rs/0.139.0 (Windows 10.0.19045; x86_64) WindowsTerminal (codex_cli_rs; 0.139.0)',
  originator: 'codex_cli_rs',
  'session-id': sessionId,
  'thread-id': sessionId,
  'x-client-request-id': sessionId,
  'x-codex-window-id': `${sessionId}:0`,
  'x-codex-beta-features': 'terminal_resize_reflow',
}

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 90_000)
try {
  const res = await fetch(`${BASE}/responses`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && text.length < 8000) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (text.includes('response.completed') || text.includes('image_generation_call')) break
  }
  controller.abort()
  console.log('HTTP', res.status)
  console.log(text.slice(0, 3000))
  if (text.includes('image_generation_call')) {
    console.log('\n✓ 模型调用了 image_generation 工具')
  } else if (text.includes('output_text')) {
    console.log('\n✗ 模型只返回文本，没调用工具（可能不支持或权限不足）')
  }
} catch (err) {
  console.error('ERROR', err.message)
} finally {
  clearTimeout(timer)
}
