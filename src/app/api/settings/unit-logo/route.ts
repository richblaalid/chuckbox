import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth'

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const unitId = formData.get('unitId') as string | null

    if (!file || !unitId) {
      return NextResponse.json({ error: 'Missing file or unit ID' }, { status: 400 })
    }

    // Body-validating: caller passes unitId; verify admin membership in
    // that specific unit. Helper's fallback-to-first-membership is unsafe
    // here, so check `membership.unit_id === unitId` explicitly.
    const membership = await getCurrentMembership(supabase, unitId)
    if (!membership || membership.unit_id !== unitId || membership.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can upload logos' }, { status: 403 })
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Use PNG, JPEG, or WebP.' }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 2MB.' }, { status: 400 })
    }

    // Get file extension
    const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1]
    const fileName = `${unitId}/logo.${ext}`

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('unit-logos')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true, // Overwrite if exists
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from('unit-logos')
      .getPublicUrl(fileName)

    // Update unit with logo URL (add cache buster)
    const logoUrl = `${urlData.publicUrl}?v=${Date.now()}`
    const { error: updateError } = await supabase
      .from('units')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('id', unitId)

    if (updateError) {
      console.error('Unit update error:', updateError)
      return NextResponse.json({ error: 'Failed to save logo URL' }, { status: 500 })
    }

    return NextResponse.json({ success: true, logoUrl })
  } catch (error) {
    console.error('Logo upload error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get request body
    const { unitId } = await request.json()

    if (!unitId) {
      return NextResponse.json({ error: 'Missing unit ID' }, { status: 400 })
    }

    // Body-validating: caller passes unitId; verify admin membership.
    const membership = await getCurrentMembership(supabase, unitId)
    if (!membership || membership.unit_id !== unitId || membership.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete logos' }, { status: 403 })
    }

    // Get current logo URL to determine file path
    const { data: unit } = await supabase
      .from('units')
      .select('logo_url')
      .eq('id', unitId)
      .single()

    if (unit?.logo_url) {
      // Try to delete from storage (may fail if file doesn't exist, which is OK)
      // The file path is unit-logos/{unitId}/logo.{ext}
      const extensions = ['png', 'jpg', 'webp']
      for (const ext of extensions) {
        await supabase.storage.from('unit-logos').remove([`${unitId}/logo.${ext}`])
      }
    }

    // Clear logo URL from unit
    const { error: updateError } = await supabase
      .from('units')
      .update({ logo_url: null, updated_at: new Date().toISOString() })
      .eq('id', unitId)

    if (updateError) {
      console.error('Unit update error:', updateError)
      return NextResponse.json({ error: 'Failed to remove logo' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Logo delete error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
