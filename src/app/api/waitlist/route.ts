import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

// Use service role for inserting without RLS issues.
// Created lazily inside the handler — module-scope creation crashes
// `next build` page-data collection when the key is absent (e.g. CI).
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Zod schema for waitlist submission validation
const waitlistSchema = z.object({
  email: z.string().email('Invalid email address').max(255, 'Email too long'),
  name: z.string().max(100, 'Name too long').optional(),
  unit_type: z.string().max(50, 'Unit type too long').optional(),
  unit_size: z.string().max(20, 'Unit size too long').optional(),
  current_software: z.array(z.string().max(50)).max(10).optional(),
  current_payment_platform: z.array(z.string().max(50)).max(10).optional(),
  biggest_pain_point: z.string().max(1000, 'Pain point description too long').optional(),
  additional_info: z.string().max(2000, 'Additional info too long').optional(),
  referral_source: z.string().max(100, 'Referral source too long').optional(),
})

type WaitlistSubmission = z.infer<typeof waitlistSchema>

async function sendSlackNotification(data: WaitlistSubmission) {
  const webhookUrl = process.env.SLACK_WAITLIST_WEBHOOK_URL

  if (!webhookUrl) {
    console.warn('SLACK_WAITLIST_WEBHOOK_URL not configured, skipping notification')
    return
  }

  const message = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🎉 New ChuckBox Waitlist Signup!',
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Email:*\n${data.email}`
          },
          {
            type: 'mrkdwn',
            text: `*Name:*\n${data.name || 'Not provided'}`
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Unit Type:*\n${data.unit_type || 'Not provided'}`
          },
          {
            type: 'mrkdwn',
            text: `*Unit Size:*\n${data.unit_size || 'Not provided'}`
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Current Software:*\n${data.current_software?.length ? data.current_software.join(', ') : 'Not provided'}`
          },
          {
            type: 'mrkdwn',
            text: `*Payment Platform:*\n${data.current_payment_platform?.length ? data.current_payment_platform.join(', ') : 'Not provided'}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Biggest Pain Point:*\n${data.biggest_pain_point || 'Not provided'}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Additional Info:*\n${data.additional_info || 'Not provided'}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Referral: ${data.referral_source || 'Direct'}`
          }
        ]
      }
    ]
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    })
  } catch (error) {
    console.error('Failed to send Slack notification:', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const rawBody = await request.json()
    const parseResult = waitlistSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstError?.message || 'Invalid request data' },
        { status: 400 }
      )
    }

    const body = parseResult.data

    // Get IP and user agent for analytics
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Insert into database (convert arrays to comma-separated strings)
    const { error } = await getServiceClient()
      .from('waitlist')
      .insert({
        email: body.email.toLowerCase().trim(),
        name: body.name?.trim() || null,
        unit_type: body.unit_type || null,
        unit_size: body.unit_size || null,
        current_software: body.current_software?.length ? body.current_software.join(', ') : null,
        current_payment_platform: body.current_payment_platform?.length ? body.current_payment_platform.join(', ') : null,
        biggest_pain_point: body.biggest_pain_point?.trim() || null,
        additional_info: body.additional_info?.trim() || null,
        referral_source: body.referral_source || null,
        ip_address: ip,
        user_agent: userAgent
      })

    if (error) {
      console.error('Waitlist insert error:', error)
      return NextResponse.json(
        { error: 'Failed to save submission' },
        { status: 500 }
      )
    }

    // Send Slack notification (don't await - fire and forget)
    sendSlackNotification(body)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Waitlist API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
