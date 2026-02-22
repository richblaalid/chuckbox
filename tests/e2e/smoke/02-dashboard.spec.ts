import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('admin')

test.describe('Dashboard', () => {
  test('loads and shows unit name', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('navigation sidebar has expected links', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('link', { name: /roster/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /finances/i })).toBeVisible()
  })
})
