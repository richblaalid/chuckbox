import { authTest } from '../fixtures/auth'
import { expect } from '@playwright/test'

const parentTest = authTest('parent')

parentTest.describe('Parent role access', () => {
  parentTest('can view dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })

  parentTest('can view roster', async ({ page }) => {
    await page.goto('/roster')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})

const scoutTest = authTest('scout')

scoutTest.describe('Scout role access', () => {
  scoutTest('can view dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Something went wrong')
  })
})
