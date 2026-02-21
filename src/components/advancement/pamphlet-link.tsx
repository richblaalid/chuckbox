import type { ReactNode } from 'react'
import { ExternalLink, FileText } from 'lucide-react'

interface PamphletLinkProps {
  url: string | null | undefined
}

export function PamphletLink({ url }: PamphletLinkProps): ReactNode {
  if (!url) return null

  return (
    <div className="mt-3">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg border border-forest-200 bg-forest-50 px-3 py-2 text-sm font-medium text-forest-700 transition-colors hover:bg-forest-100"
      >
        <FileText className="h-4 w-4" />
        Official BSA Pamphlet
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}
