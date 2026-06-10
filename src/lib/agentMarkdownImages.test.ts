import { describe, expect, it } from 'vitest'
import { extractAgentMarkdownImages, stripAgentMarkdownImages } from './agentMarkdownImages'

describe('agent markdown images', () => {
  it('extracts supported markdown image urls outside code blocks', () => {
    const content = [
      '完成：![image_1](https://example.com/a.png)',
      '```md',
      '![ignored](https://example.com/b.png)',
      '```',
      '![inline](data:image/png;base64,abc=)',
    ].join('\n')

    expect(extractAgentMarkdownImages(content)).toEqual([
      { alt: 'image_1', url: 'https://example.com/a.png' },
      { alt: 'inline', url: 'data:image/png;base64,abc=' },
    ])
  })

  it('strips image tokens without touching code blocks', () => {
    const content = '完成\n\n![image_1](https://example.com/a.png)\n\n`![keep](https://example.com/b.png)`'

    expect(stripAgentMarkdownImages(content)).toBe('完成\n\n`![keep](https://example.com/b.png)`')
  })
})
