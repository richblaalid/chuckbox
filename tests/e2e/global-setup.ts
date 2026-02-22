import { test as setup } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TEST_USERS = {
  admin: 'richard.blaalid+admin@withcaldera.com',
  treasurer: 'richard.blaalid+treasurer@withcaldera.com',
  leader: 'richard.blaalid+leader@withcaldera.com',
  parent: 'richard.blaalid+parent@withcaldera.com',
  scout: 'richard.blaalid+scout@withcaldera.com',
} as const

const PASSWORD = 'testpassword123'
const AUTH_DIR = path.join(__dirname, '.auth')

for (const [role, email] of Object.entries(TEST_USERS)) {
  setup(`authenticate as ${role}`, async ({ page, context }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
      )
    }

    // Authenticate via Supabase REST API (Node-side fetch)
    const response = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({ email, password: PASSWORD }),
      }
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Auth failed for ${role} (${response.status}): ${body}`
      )
    }

    const session = await response.json()

    // @supabase/ssr stores auth in chunked cookies, not localStorage.
    // The middleware reads these cookies to validate the session server-side.
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
    const cookieName = `sb-${projectRef}-auth-token`
    const sessionJson = JSON.stringify(session)

    // Supabase SSR chunks cookies at ~3180 chars to stay under browser limits
    const CHUNK_SIZE = 3180
    const chunks: string[] = []
    for (let i = 0; i < sessionJson.length; i += CHUNK_SIZE) {
      chunks.push(sessionJson.slice(i, i + CHUNK_SIZE))
    }

    const cookies = chunks.map((chunk, i) => ({
      name: chunks.length === 1 ? cookieName : `${cookieName}.${i}`,
      value: chunk,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    }))

    // Set the auth cookies on the browser context
    await context.addCookies(cookies)

    // Also set localStorage for client-side Supabase reads
    await page.goto('/login')
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, JSON.stringify(value))
      },
      { key: cookieName, value: session }
    )

    // Verify auth works by navigating to a protected page.
    // The middleware redirect can cause ERR_ABORTED, so we catch and check the final URL.
    try {
      await page.goto('/scouts')
    } catch {
      // ERR_ABORTED is expected from middleware redirects — check where we landed
    }
    await page.waitForLoadState('domcontentloaded')

    if (page.url().includes('/login')) {
      throw new Error(`Auth verification failed for ${role}: redirected to login`)
    }

    // Save the authenticated browser state for reuse in tests
    await page.context().storageState({
      path: path.join(AUTH_DIR, `${role}.json`),
    })
  })
}
