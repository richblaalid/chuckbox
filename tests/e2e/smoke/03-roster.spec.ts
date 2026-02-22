import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('admin')

test.describe('Roster', () => {
  test('scout list loads without errors', async ({ page }) => {
    await page.goto('/roster')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
