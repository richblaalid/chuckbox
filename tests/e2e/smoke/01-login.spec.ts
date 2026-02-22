import { test, expect } from '@playwright/test'

test.describe('Login flow', () => {
  test('shows login page with email form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(
      page.getByRole('button', { name: /send magic link/i })
    ).toBeVisible()
  })

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/roster')
    await page.waitForURL('**/login**')
    await expect(page).toHaveURL(/\/login/)
  })
})
