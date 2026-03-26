'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AdultForm } from './adult-form'
import { Pencil } from 'lucide-react'

interface EditAdultButtonProps {
  unitId: string
  adult: {
    id: string
    user_id: string | null
    first_name: string | null
    last_name: string | null
    email: string | null
    email_secondary: string | null
    phone_home: string | null
    phone_mobile: string | null
    address_street: string | null
    address_city: string | null
    address_state: string | null
    address_zip: string | null
    member_type: string | null
    position: string | null
    position_2: string | null
    bsa_member_id: string | null
    is_active: boolean | null
  }
}

export function EditAdultButton({ unitId, adult }: EditAdultButtonProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="outline">
        <Pencil className="mr-2 h-4 w-4" />
        Edit
      </Button>
      {isOpen && (
        <AdultForm
          unitId={unitId}
          adult={adult}
          onClose={() => setIsOpen(false)}
          onSuccess={() => {
            setIsOpen(false)
            router.refresh()
          }}
        />
      )}
    </>
  )
}
