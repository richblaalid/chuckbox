import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('treasurer')

test.describe('Reports & Expenses', () => {
  test('expenses page loads', async ({ page }) => {
    await page.goto('/expenses')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
