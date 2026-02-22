import { test as base } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

type Role = 'admin' | 'treasurer' | 'leader' | 'parent' | 'scout'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = path.join(__dirname, '..', '.auth')

export function authTest(role: Role) {
  return base.extend({
    storageState: path.join(AUTH_DIR, `${role}.json`),
  })
}
