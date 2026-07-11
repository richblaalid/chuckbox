/**
 * Tests for the Sentry forwarding behavior of src/lib/logger.ts
 *
 * .error() must forward to Sentry (captureException for Error payloads,
 * captureMessage otherwise) tagged with the logger namespace; other levels
 * must never reach Sentry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { createLogger, logger } from '@/lib/logger'

describe('logger Sentry forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards .error() with an Error payload to captureException', () => {
    const log = createLogger('TestNS')
    const boom = new Error('boom')

    log.error('Something failed', boom)

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({
        tags: expect.objectContaining({ logger: 'TestNS' }),
        extra: expect.objectContaining({ message: '[TestNS] Something failed' }),
      })
    )
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('forwards .error() with non-Error data to captureMessage with the data as extra', () => {
    const log = createLogger('TestNS')
    const dbError = { code: '23505', message: 'duplicate key' }

    log.error('Insert failed', dbError)

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      '[TestNS] Insert failed',
      expect.objectContaining({
        level: 'error',
        tags: expect.objectContaining({ logger: 'TestNS' }),
        extra: expect.objectContaining({ data: dbError }),
      })
    )
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('forwards .error() with no data to captureMessage', () => {
    const log = createLogger('TestNS')

    log.error('Something failed')

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      '[TestNS] Something failed',
      expect.objectContaining({ level: 'error' })
    )
  })

  it('still writes errors to the console', () => {
    const log = createLogger('TestNS')

    log.error('Something failed')

    expect(console.error).toHaveBeenCalled()
  })

  it('never forwards debug/info/warn to Sentry', () => {
    const log = createLogger('TestNS', { enabled: true })

    log.debug('d')
    log.info('i')
    log.warn('w')

    expect(Sentry.captureException).not.toHaveBeenCalled()
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('forwards errors even when the namespace logger is disabled', () => {
    const log = createLogger('Quiet', { enabled: false })

    log.error('Still important', new Error('boom'))

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('pre-configured namespace loggers carry their namespace tag', () => {
    logger.payment.error('Payment failed', new Error('declined'))

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ logger: 'Payment' }) })
    )
  })
})
