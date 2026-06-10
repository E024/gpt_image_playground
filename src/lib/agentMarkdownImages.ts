export interface AgentMarkdownImage {
  alt: string
  url: string
}

const FENCED_CODE_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)]\(([^)\n]+)\)/g

function normalizeMarkdownImageUrl(value: string) {
  let url = value.trim()

  while (
    (url.startsWith('<') && url.endsWith('>')) ||
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim()
  }

  return url
}

function isSupportedMarkdownImageUrl(url: string) {
  return /^(?:https?:\/\/|data:image\/)/i.test(url)
}

export function extractAgentMarkdownImages(content: string): AgentMarkdownImage[] {
  const images: AgentMarkdownImage[] = []
  const segments = content.split(FENCED_CODE_PATTERN)

  for (let index = 0; index < segments.length; index++) {
    if (index % 2 === 1) continue

    for (const match of segments[index].matchAll(MARKDOWN_IMAGE_PATTERN)) {
      const url = normalizeMarkdownImageUrl(match[2] ?? '')
      if (!isSupportedMarkdownImageUrl(url)) continue
      images.push({
        alt: (match[1] ?? '').trim(),
        url,
      })
    }
  }

  return images
}

export function stripAgentMarkdownImages(content: string) {
  return content
    .split(FENCED_CODE_PATTERN)
    .map((segment, index) => index % 2 === 1 ? segment : segment.replace(MARKDOWN_IMAGE_PATTERN, ''))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
