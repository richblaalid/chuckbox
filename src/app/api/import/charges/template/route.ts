import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
  }

  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get active scouts in the unit
  const { data: scouts } = await supabase
    .from('scouts')
    .select('first_name, last_name, bsa_member_id')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .order('last_name')
    .order('first_name')

  // Build CSV content
  const headers = ['First Name', 'Last Name', 'Amount', 'Description', 'Date', 'BSA ID', 'Reference', 'Memo']
  const rows = (scouts || []).map((scout) =>
    [
      scout.first_name,
      scout.last_name,
      '', // Amount - to be filled in
      '', // Description - to be filled in
      '', // Date - to be filled in
      scout.bsa_member_id || '',
      '', // Reference
      '', // Memo
    ]
      .map((field) => {
        // Escape fields that contain commas or quotes
        if (field.includes(',') || field.includes('"')) {
          return `"${field.replace(/"/g, '""')}"`
        }
        return field
      })
      .join(',')
  )

  const csvContent = [headers.join(','), ...rows].join('\n')

  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="billing-charges-template.csv"',
    },
  })
}
