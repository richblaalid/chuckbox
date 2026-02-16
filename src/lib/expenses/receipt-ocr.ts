/**
 * Receipt OCR using Claude Vision
 *
 * Extracts structured data from receipt images using Claude's vision capabilities.
 * Results are suggestions that users should confirm before submitting.
 */

import Anthropic from '@anthropic-ai/sdk'

export interface ReceiptExtractionResult {
  success: boolean
  data?: {
    amount: number | null
    vendor: string | null
    date: string | null
    description: string | null
    confidence: 'high' | 'medium' | 'low'
  }
  error?: string
}

const SYSTEM_PROMPT = `You are a receipt data extraction specialist. Extract structured information from receipt images.

Extract the following fields if visible:
- amount: The total amount paid (as a number, no currency symbol). Look for "Total", "Grand Total", "Amount Due", or the largest/final amount.
- vendor: The store/business name (usually at the top of the receipt)
- date: The transaction date in YYYY-MM-DD format
- description: A brief description of the purchase (e.g., "Office supplies", "Groceries", "Camping gear")

Return ONLY a valid JSON object with these fields. Use null for any field you cannot determine with confidence.

Example response:
{
  "amount": 47.23,
  "vendor": "Home Depot",
  "date": "2026-02-15",
  "description": "Camping supplies",
  "confidence": "high"
}

Set confidence to:
- "high": All fields clearly visible and readable
- "medium": Some fields unclear or partially visible
- "low": Receipt is blurry, cut off, or hard to read

Never include markdown formatting, explanations, or additional text. Return only the JSON object.`

/**
 * Fetch an image from URL and convert to base64
 */
async function fetchImageAsBase64(url: string): Promise<{ base64: string; mediaType: string }> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const arrayBuffer = await response.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')

  // Map content type to Anthropic's expected media types
  let mediaType = contentType.split(';')[0].trim()
  if (mediaType === 'image/jpg') {
    mediaType = 'image/jpeg'
  }

  return { base64, mediaType }
}

/**
 * Extract receipt data from an image URL using Claude Vision
 */
export async function extractReceiptData(
  imageUrl: string
): Promise<ReceiptExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.warn('[Receipt OCR] ANTHROPIC_API_KEY not set')
    return {
      success: false,
      error: 'Receipt extraction is not configured. Please enter details manually.',
    }
  }

  try {
    // Fetch and convert image to base64
    const { base64, mediaType } = await fetchImageAsBase64(imageUrl)

    // Validate media type
    const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!supportedTypes.includes(mediaType)) {
      // For PDFs and other unsupported types, return a helpful message
      if (mediaType === 'application/pdf') {
        return {
          success: false,
          error: 'PDF receipt extraction is not supported. Please enter details manually.',
        }
      }
      return {
        success: false,
        error: `Unsupported image type: ${mediaType}. Please use JPEG, PNG, or WebP.`,
      }
    }

    const anthropic = new Anthropic({ apiKey })

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64,
              },
            },
            {
              type: 'text',
              text: 'Extract the receipt information from this image.',
            },
          ],
        },
      ],
    })

    // Extract text response
    const textContent = message.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return {
        success: false,
        error: 'No response from image analysis',
      }
    }

    // Parse JSON response
    let jsonText = textContent.text.trim()
    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const parsed = JSON.parse(jsonText)

    // Validate and normalize the response
    const amount = typeof parsed.amount === 'number' ? parsed.amount : null
    const vendor = typeof parsed.vendor === 'string' && parsed.vendor.length > 0 ? parsed.vendor : null
    const date = typeof parsed.date === 'string' && parsed.date.length > 0 ? parsed.date : null
    const description = typeof parsed.description === 'string' && parsed.description.length > 0 ? parsed.description : null
    const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low'

    return {
      success: true,
      data: {
        amount,
        vendor,
        date,
        description,
        confidence,
      },
    }
  } catch (error) {
    console.error('[Receipt OCR] Error:', error)

    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: 'Could not parse receipt data. Please enter details manually.',
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to analyze receipt',
    }
  }
}

/**
 * Extract receipt data from base64 image data directly
 */
export async function extractReceiptDataFromBase64(
  base64Data: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
): Promise<ReceiptExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.warn('[Receipt OCR] ANTHROPIC_API_KEY not set')
    return {
      success: false,
      error: 'Receipt extraction is not configured. Please enter details manually.',
    }
  }

  try {
    const anthropic = new Anthropic({ apiKey })

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: 'Extract the receipt information from this image.',
            },
          ],
        },
      ],
    })

    // Extract text response
    const textContent = message.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return {
        success: false,
        error: 'No response from image analysis',
      }
    }

    // Parse JSON response
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const parsed = JSON.parse(jsonText)

    const amount = typeof parsed.amount === 'number' ? parsed.amount : null
    const vendor = typeof parsed.vendor === 'string' && parsed.vendor.length > 0 ? parsed.vendor : null
    const date = typeof parsed.date === 'string' && parsed.date.length > 0 ? parsed.date : null
    const description = typeof parsed.description === 'string' && parsed.description.length > 0 ? parsed.description : null
    const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low'

    return {
      success: true,
      data: {
        amount,
        vendor,
        date,
        description,
        confidence,
      },
    }
  } catch (error) {
    console.error('[Receipt OCR] Error:', error)

    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: 'Could not parse receipt data. Please enter details manually.',
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to analyze receipt',
    }
  }
}
