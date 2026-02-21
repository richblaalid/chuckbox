import type { ReactNode } from 'react'

/** Matches URLs starting with http://, https://, or www. Negative lookbehind prevents matching email addresses. */
const URL_PATTERN = /(?<![@\w])(?:https?:\/\/|www\.)[^\s<>)"']+/g

interface LinkifiedTextProps {
  text: string
  className?: string
}

export function LinkifiedText({ text, className }: LinkifiedTextProps): ReactNode {
  if (!text) return null

  const matches = Array.from(text.matchAll(URL_PATTERN))

  if (matches.length === 0) {
    return <span className={className}>{text}</span>
  }

  const parts: ReactNode[] = []
  let lastIndex = 0

  for (const match of matches) {
    const url = match[0]
    const index = match.index!

    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index))
    }

    const href = url.startsWith('www.') ? `https://${url}` : url
    parts.push(
      <a
        key={index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline"
      >
        {url}
      </a>
    )

    lastIndex = index + url.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <span className={className}>{parts}</span>
}
