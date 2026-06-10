import type { AgentRound, TaskRecord } from '../types'
import { replaceImageMentionsForApi, stripImageMentionMarkers } from './promptImageMentions'

const AGENT_ROUND_IMAGE_REFERENCE_RE = /@(?:第)?(\d+)轮图(\d+)/g
const AGENT_REF_TAG_RE = /<ref\b[^>]*\bid=(["'])(round-(\d+)-(?:image|reference)-(\d+))\1[^>]*\/?>/g
const AGENT_REFERENCE_DISPLAY_RE = /<removed_ref\b[^>]*\bid=(["'])round-(\d+)-(?:image|reference)-(\d+)\1[^>]*\/?>|<ref\b[^>]*\bid=(["'])round-(\d+)-(image|reference)-(\d+)\4[^>]*\/?>|@第\d+轮(?:参考图|图)\d+|@已删除图片/g

export type AgentReferenceDisplayPart =
  | { type: 'text'; text: string }
  | { type: 'reference'; text: string; removed?: boolean }

export function getAgentCurrentReferenceId(round: AgentRound, index: number) {
  return `round-${round.index}-reference-${index + 1}`
}

export function getAgentGeneratedImageReferenceId(round: AgentRound, index: number) {
  return `round-${round.index}-image-${index + 1}`
}

export function getAgentReferenceTag(referenceId: string) {
  return `<ref id="${referenceId}" />`
}

export function getAgentRemovedReferenceTag(referenceId: string) {
  return `<removed_ref id="${referenceId}" />`
}

export function collectAgentRoundOutputImageSlots(round: AgentRound, tasks: TaskRecord[]) {
  const slots: Array<string | null> = []
  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task) {
      slots.push(null)
      continue
    }
    slots.push(...task.outputImages)
  }
  return slots
}

export function extractAgentReferenceIds(text: string) {
  return Array.from(text.matchAll(AGENT_REF_TAG_RE), (match) => match[2]).filter((id): id is string => Boolean(id))
}

export function formatAgentReferenceTagsForDisplay(text: string) {
  return getAgentReferenceDisplayParts(text).map((part) => part.text).join('')
}

export function getAgentReferenceDisplayParts(text: string): AgentReferenceDisplayPart[] {
  const visibleText = stripImageMentionMarkers(text)
  const parts: AgentReferenceDisplayPart[] = []
  let lastIndex = 0

  for (const match of visibleText.matchAll(AGENT_REFERENCE_DISPLAY_RE)) {
    if (match.index == null) continue
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: visibleText.slice(lastIndex, match.index) })
    }

    if (match[0].startsWith('<removed_ref')) {
      parts.push({ type: 'reference', text: '@已删除图片', removed: true })
    } else if (match[0].startsWith('<ref')) {
      const roundNumber = match[5]
      const kind = match[6]
      const imageNumber = match[7]
      parts.push({
        type: 'reference',
        text: kind === 'reference'
          ? `@第${roundNumber}轮参考图${imageNumber}`
          : `@第${roundNumber}轮图${imageNumber}`,
      })
    } else {
      parts.push({ type: 'reference', text: match[0], removed: match[0] === '@已删除图片' })
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < visibleText.length) {
    parts.push({ type: 'text', text: visibleText.slice(lastIndex) })
  }

  return parts.length > 0 ? parts : [{ type: 'text', text: visibleText }]
}

export function resolveAgentPromptImageReferences(prompt: string, rounds: AgentRound[], tasks: TaskRecord[]) {
  const refs: string[] = []
  for (const match of prompt.matchAll(AGENT_ROUND_IMAGE_REFERENCE_RE)) {
    const roundIndex = Number(match[1]) - 1
    const imageIndex = Number(match[2]) - 1
    const round = rounds[roundIndex]
    if (!round || imageIndex < 0) continue

    const imageId = collectAgentRoundOutputImageSlots(round, tasks)[imageIndex]
    if (imageId) refs.push(imageId)
  }
  return refs
}

export function replaceAgentPromptImageReferencesForApi(
  prompt: string,
  currentRound: AgentRound,
  rounds: AgentRound[],
  tasks: TaskRecord[],
) {
  const withCurrentReferences = replaceImageMentionsForApi(
    prompt,
    currentRound.inputImageIds.length,
    (index) => getAgentReferenceTag(getAgentCurrentReferenceId(currentRound, index)),
  )

  const replaceGeneratedReference = (text: string, roundNumber: string, imageNumber: string) => {
    const roundIndex = Number(roundNumber) - 1
    const imageIndex = Number(imageNumber) - 1
    const sourceRound = rounds[roundIndex]
    if (!sourceRound || imageIndex < 0) return text

    const imageId = collectAgentRoundOutputImageSlots(sourceRound, tasks)[imageIndex]
    if (!imageId) return getAgentRemovedReferenceTag(getAgentGeneratedImageReferenceId(sourceRound, imageIndex))

    const currentReferenceIndex = currentRound.inputImageIds.indexOf(imageId)
    const referenceId = currentReferenceIndex >= 0
      ? getAgentCurrentReferenceId(currentRound, currentReferenceIndex)
      : getAgentGeneratedImageReferenceId(sourceRound, imageIndex)
    return getAgentReferenceTag(referenceId)
  }
  const withAgentReferences = withCurrentReferences.replace(AGENT_ROUND_IMAGE_REFERENCE_RE, replaceGeneratedReference)
  return stripImageMentionMarkers(withAgentReferences)
}
