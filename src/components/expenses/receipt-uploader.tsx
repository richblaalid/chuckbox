'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { RECEIPT_UPLOAD } from '@/lib/expenses/constants'
import { cn } from '@/lib/utils'

interface ReceiptUploaderProps {
  unitId: string
  onUploadComplete: (data: {
    receiptUrl: string
    receiptFilename: string
    filePath: string
  }) => void
  onUploadError?: (error: string) => void
  currentReceipt?: {
    url: string
    filename: string
  } | null
  onRemove?: () => void
  disabled?: boolean
}

export function ReceiptUploader({
  unitId,
  onUploadComplete,
  onUploadError,
  currentReceipt,
  onRemove,
  disabled = false,
}: ReceiptUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const validateFile = useCallback((file: File): string | null => {
    if (!RECEIPT_UPLOAD.acceptedTypes.includes(file.type)) {
      return `Invalid file type. Accepted: ${RECEIPT_UPLOAD.acceptedExtensions.join(', ')}`
    }
    if (file.size > RECEIPT_UPLOAD.maxSize) {
      return `File too large. Maximum size is ${RECEIPT_UPLOAD.maxSizeLabel}.`
    }
    return null
  }, [])

  const uploadFile = useCallback(async (file: File) => {
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      onUploadError?.(validationError)
      return
    }

    setError(null)
    setIsUploading(true)

    // Show preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => setPreviewUrl(reader.result as string)
      reader.readAsDataURL(file)
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('unitId', unitId)

    try {
      const response = await fetch('/api/expenses/receipt', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload receipt')
      }

      onUploadComplete({
        receiptUrl: result.receiptUrl,
        receiptFilename: result.receiptFilename,
        filePath: result.filePath,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Upload failed'
      setError(errorMsg)
      setPreviewUrl(null)
      onUploadError?.(errorMsg)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [unitId, validateFile, onUploadComplete, onUploadError])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      uploadFile(file)
    }
  }, [uploadFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled && !isUploading) {
      setIsDragOver(true)
    }
  }, [disabled, isUploading])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (disabled || isUploading) return

    const file = e.dataTransfer.files[0]
    if (file) {
      uploadFile(file)
    }
  }, [disabled, isUploading, uploadFile])

  const handleRemove = useCallback(() => {
    setPreviewUrl(null)
    setError(null)
    onRemove?.()
  }, [onRemove])

  const isPDF = currentReceipt?.filename?.toLowerCase().endsWith('.pdf')
  const hasReceipt = currentReceipt?.url || previewUrl

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg bg-error-light p-3 text-sm text-error">
          {error}
        </div>
      )}

      {hasReceipt ? (
        <div className="flex items-center gap-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
          {/* Preview or icon */}
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-white border border-stone-200">
            {isPDF ? (
              <svg className="h-8 w-8 text-error" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ) : previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Receipt preview"
                className="h-full w-full object-contain rounded-lg"
              />
            ) : currentReceipt?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentReceipt.url}
                alt="Receipt"
                className="h-full w-full object-contain rounded-lg"
              />
            ) : (
              <svg className="h-8 w-8 text-stone-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
          </div>

          {/* File info */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-stone-900 truncate">
              {currentReceipt?.filename || 'Uploading...'}
            </p>
            {isUploading && (
              <p className="text-sm text-stone-500">Uploading...</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {currentReceipt?.url && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                asChild
              >
                <a href={currentReceipt.url} target="_blank" rel="noopener noreferrer">
                  View
                </a>
              </Button>
            )}
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                disabled={isUploading || disabled}
                className="text-error hover:text-error hover:bg-error-light"
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => !disabled && !isUploading && fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              if (!disabled && !isUploading) {
                fileInputRef.current?.click()
              }
            }
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer',
            isDragOver
              ? 'border-forest-500 bg-forest-50'
              : 'border-stone-300 bg-stone-50 hover:border-stone-400 hover:bg-stone-100',
            (disabled || isUploading) && 'cursor-not-allowed opacity-50'
          )}
        >
          <svg
            className={cn('h-12 w-12 mb-3', isDragOver ? 'text-forest-600' : 'text-stone-400')}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>

          <p className="text-sm font-medium text-stone-700">
            {isUploading ? 'Uploading...' : 'Drop receipt here or click to upload'}
          </p>
          <p className="text-xs text-stone-500 mt-1">
            {RECEIPT_UPLOAD.acceptedExtensions.join(', ')} up to {RECEIPT_UPLOAD.maxSizeLabel}
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={RECEIPT_UPLOAD.acceptString}
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || isUploading}
      />
    </div>
  )
}
