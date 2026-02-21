import type { ReactNode } from 'react'
import { Video, Globe, FileText } from 'lucide-react'

interface Resource {
  name: string
  url: string
  resource_type: string
}

interface RequirementResourcesProps {
  resources: Resource[] | undefined | null
}

function ResourceIcon({ type }: { type: string }): ReactNode {
  switch (type) {
    case 'video':
      return <Video className="h-3.5 w-3.5 shrink-0" />
    case 'pdf':
      return <FileText className="h-3.5 w-3.5 shrink-0" />
    default:
      return <Globe className="h-3.5 w-3.5 shrink-0" />
  }
}

export function RequirementResources({ resources }: RequirementResourcesProps): ReactNode {
  if (!resources || resources.length === 0) return null

  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      {resources.map((resource, i) => (
        <a
          key={i}
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
