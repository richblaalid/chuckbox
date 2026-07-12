/**
 * Structured logging utility for Chuckbox
 *
 * Provides namespaced logging that can be enabled/disabled per namespace.
 * In development, logs are shown by default. In production, only errors are shown.
 *
 * @example
 * import { logger } from '@/lib/logger'
 *
 * // Use predefined namespaces
 * logger.payment.debug('Card initialized', { cardId: '123' })
 * logger.payment.error('Payment failed', error)
 *
 * // Create custom logger
 * const log = createLogger('MyComponent')
 * log.debug('Something happened')
 */

import * as Sentry from '@sentry/nextjs'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LoggerOptions {
  /** Namespace prefix for log messages */
  namespace: string
  /** Whether to show logs (defaults to process.env.NODE_ENV !== 'production') */
  enabled?: boolean
}

interface Logger {
  debug: (message: string, data?: unknown) => void
  info: (message: string, data?: unknown) => void
  warn: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
}

const isDevelopment = process.env.NODE_ENV !== 'production'

// Log level colors for browser console
const levelColors: Record<LogLevel, string> = {
  debug: '#6b7280', // gray
  info: '#3b82f6',  // blue
  warn: '#f59e0b',  // amber
  error: '#ef4444', // red
}

function formatMessage(namespace: string, level: LogLevel, message: string): string {
  return `[${namespace}] ${message}`
}

function shouldLog(level: LogLevel, enabled: boolean): boolean {
  // Always log errors
  if (level === 'error') return true
  // Only log other levels if enabled
  return enabled
}

// Forward errors to Sentry (no-op without a configured DSN) so
// log-and-continue sites still alert in production.
function reportToSentry(namespace: string, formattedMessage: string, data?: unknown): void {
  const context = {
    level: 'error' as const,
    tags: { logger: namespace },
    extra: { message: formattedMessage, data },
  }

  if (data instanceof Error) {
    Sentry.captureException(data, context)
  } else {
    Sentry.captureMessage(formattedMessage, context)
  }
}

/**
 * Create a logger instance with a specific namespace
 */
export function createLogger(namespace: string, options?: { enabled?: boolean }): Logger {
  const enabled = options?.enabled ?? isDevelopment

  const log = (level: LogLevel, message: string, data?: unknown) => {
    if (!shouldLog(level, enabled)) return

    const formattedMessage = formatMessage(namespace, level, message)
    const color = levelColors[level]

    if (level === 'error') {
      reportToSentry(namespace, formattedMessage, data)
    }

    // Use appropriate console method
    const consoleFn = level === 'error' ? console.error :
                      level === 'warn' ? console.warn :
                      level === 'info' ? console.info :
                      console.log

    if (typeof window !== 'undefined') {
      // Browser environment - use styled logs
      if (data !== undefined) {
        consoleFn(`%c${formattedMessage}`, `color: ${color}`, data)
      } else {
        consoleFn(`%c${formattedMessage}`, `color: ${color}`)
      }
    } else {
      // Server environment - plain logs
      if (data !== undefined) {
        consoleFn(formattedMessage, data)
      } else {
        consoleFn(formattedMessage)
      }
    }
  }

  return {
    debug: (message: string, data?: unknown) => log('debug', message, data),
    info: (message: string, data?: unknown) => log('info', message, data),
    warn: (message: string, data?: unknown) => log('warn', message, data),
    error: (message: string, data?: unknown) => log('error', message, data),
  }
}

/**
 * Pre-configured loggers for common application areas
 */
export const logger = {
  /** Payment processing logs */
  payment: createLogger('Payment'),

  /** Square SDK integration logs */
  square: createLogger('Square'),

  /** Authentication and authorization logs */
  auth: createLogger('Auth'),

  /** Form submission and validation logs */
  form: createLogger('Form'),

  /** API route logs (server-side) */
  api: createLogger('API'),

  /** Supabase database operation logs */
  db: createLogger('DB'),

  /** General application logs */
  app: createLogger('App'),
}

/**
 * Disable all debug/info/warn logging (useful for tests)
 */
export function disableLogging(): void {
  Object.keys(logger).forEach(key => {
    (logger as Record<string, Logger>)[key] = createLogger(key, { enabled: false })
  })
}

/**
 * Enable all logging
 */
export function enableLogging(): void {
  Object.keys(logger).forEach(key => {
    (logger as Record<string, Logger>)[key] = createLogger(key, { enabled: true })
  })
}
