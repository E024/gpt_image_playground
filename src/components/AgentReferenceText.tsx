import { getAgentReferenceDisplayParts } from '../lib/agentImageReferences'

type AgentReferenceTextProps = {
  text?: string | null
  fallback?: string
  className?: string
  as?: 'p' | 'div' | 'span' | 'h3'
}

export default function AgentReferenceText({
  text,
  fallback = '',
  className = '',
  as = 'div',
}: AgentReferenceTextProps) {
  const content = text ?? ''
  const parts = content ? getAgentReferenceDisplayParts(content) : []
  const Component = as

  return (
    <Component className={className}>
      {parts.length > 0
        ? parts.map((part, index) => (
          part.type === 'reference'
            ? (
              <span
                key={`${part.text}:${index}`}
                className={`agent-reference-tag${part.removed ? ' agent-reference-tag-removed' : ''}`}
              >
                {part.text}
              </span>
            )
            : <span key={index}>{part.text}</span>
        ))
        : fallback}
    </Component>
  )
}
