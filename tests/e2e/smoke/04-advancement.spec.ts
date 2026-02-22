import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('leader')

test.describe('Advancement', () => {
  test('advancement page loads', async ({ page }) => {
    await page.goto('/advancement')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('can navigate to merit badges', async ({ page }) => {
    await page.goto('/advancement/merit-badges')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
