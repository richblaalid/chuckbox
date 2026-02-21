import type { ReactNode } from 'react'
import { FileText, Globe, Video } from 'lucide-react'

interface Resource {
  name: string
  url: string
  resource_type: string
}

interface RequirementResourcesProps {
  resources: Resource[] | undefined | null
}

const ICON_CLASS = 'h-3.5 w-3.5 shrink-0'

function ResourceIcon({ type }: { type: string }): ReactNode {
  switch (type) {
    case 'video':
      return <Video className={ICON_CLASS} />
    case 'pdf':
      return <FileText className={ICON_CLASS} />
    default:
      return <Globe className={ICON_CLASS} />
  }
}

export function RequirementResources({ resources }: RequirementResourcesProps): ReactNode {
  if (!resources || resources.length === 0) return null

  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      {resources.map((resource) => (
        <a
          key={resource.url}
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          <ResourceIcon type={resource.resource_type} />
          {resource.name}
        </a>
      ))}
    </div>
  )
}
