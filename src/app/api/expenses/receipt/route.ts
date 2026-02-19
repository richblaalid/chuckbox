import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RECEIPT_UPLOAD } from '@/lib/expenses/constants'

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

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    // Verify user has access to this unit (any active membership)
    const { data: membership } = await supabase
      .from('unit_memberships')
      .select('id')
      .eq('profile_id', profile.id)
      .eq('unit_id', unitId)
      .eq('status', 'active')
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied to this unit' }, { status: 403 })
    }

    // Validate file type
    if (!RECEIPT_UPLOAD.acceptedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Accepted: ${RECEIPT_UPLOAD.acceptedExtensions.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > RECEIPT_UPLOAD.maxSize) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${RECEIPT_UPLOAD.maxSizeLabel}.` },
        { status: 400 }
      )
    }

    // Generate unique filename: {unitId}/{profileId}_{timestamp}_{originalName}
    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const filePath = `${unitId}/${profile.id}_${timestamp}_${sanitizedName}`

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    // Use admin client for storage (bypasses RLS since we already validated access)
    const adminClient = createAdminClient()

    // Upload to Supabase Storage
    const { error: uploadError } = await adminClient.storage
      .from('expense-receipts')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload receipt' }, { status: 500 })
    }

    // Get the public URL (bucket is public with unguessable paths)
    const { data: urlData } = adminClient.storage
      .from('expense-receipts')
      .getPublicUrl(filePath)

    return NextResponse.json({
      success: true,
      receiptUrl: urlData.publicUrl,
      receiptFilename: file.name,
      filePath,
    })
  } catch (error) {
    console.error('Receipt upload error:', error)
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
    const { filePath, unitId } = await request.json()

    if (!filePath || !unitId) {
      return NextResponse.json({ error: 'Missing file path or unit ID' }, { status: 400 })
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    // Verify the file path starts with the unit ID and belongs to this user
    // File path format: {unitId}/{profileId}_{timestamp}_{filename}
    const expectedPrefix = `${unitId}/${profile.id}_`
    if (!filePath.startsWith(expectedPrefix)) {
      // Check if user is admin/treasurer (they can delete any receipt in their unit)
      const { data: membership } = await supabase
        .from('unit_memberships')
        .select('role')
        .eq('profile_id', profile.id)
        .eq('unit_id', unitId)
        .eq('status', 'active')
        .single()

      if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
        return NextResponse.json({ error: 'Cannot delete this receipt' }, { status: 403 })
      }
    }

    // Use admin client for storage (bypasses RLS since we already validated access)
    const adminClient = createAdminClient()

    // Delete from storage
    const { error: deleteError } = await adminClient.storage
      .from('expense-receipts')
      .remove([filePath])

    if (deleteError) {
      console.error('Storage delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete receipt' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Receipt delete error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
