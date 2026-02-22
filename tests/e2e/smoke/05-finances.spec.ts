import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('treasurer')

test.describe('Finances', () => {
  test('finances page loads', async ({ page }) => {
    await page.goto('/finances')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('accounts page loads', async ({ page }) => {
    await page.goto('/finances/accounts')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('reports page loads', async ({ page }) => {
    await page.goto('/finances/reports')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
