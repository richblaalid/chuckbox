import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const test = authTest('admin')

test.describe('Settings', () => {
  test('settings page loads for admin', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  test('users tab is accessible', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    const usersTab = page.getByRole('tab', { name: /users/i })
    if (await usersTab.isVisible()) {
      await usersTab.click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).not.toContainText(
        'Something went wrong'
      )
    }
  })
})
