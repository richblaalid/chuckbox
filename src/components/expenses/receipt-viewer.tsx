'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ReceiptViewerProps {
  receiptUrl: string
  receiptFilename?: string | null
  className?: string
}

export function ReceiptViewer({
  receiptUrl,
  receiptFilename,
  className,
}: ReceiptViewerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [imageError, setImageError] = useState(false)

  const isPDF = receiptFilename?.toLowerCase().endsWith('.pdf') ||
                receiptUrl.toLowerCase().includes('.pdf')

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = receiptUrl
    link.download = receiptFilename || 'receipt'
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (isPDF) {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex items-center gap-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white border border-stone-200">
            <svg className="h-6 w-6 text-error" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-stone-900 truncate">
              {receiptFilename || 'Receipt.pdf'}
            </p>
            <p className="text-sm text-stone-500">PDF Document</p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              asChild
            >
              <a href={receiptUrl} target="_blank" rel="noopener noreferrer">
                View
              </a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDownload}
            >
              Download
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Thumbnail */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsOpen(true)
          }
        }}
        className="group relative cursor-pointer rounded-lg border border-stone-200 overflow-hidden bg-stone-50 hover:border-stone-300 transition-colors"
      >
        {imageError ? (
          <div className="flex h-48 items-center justify-center">
            <div className="text-center text-stone-400">
              <svg className="mx-auto h-12 w-12 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p>Failed to load image</p>
            </div>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receiptUrl}
              alt={receiptFilename || 'Receipt'}
              className="w-full h-48 object-contain"
              onError={() => setImageError(true)}
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="bg-white/90 rounded-full p-2">
                  <svg className="h-5 w-5 text-stone-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                  </svg>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          disabled={imageError}
        >
          View Full Size
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDownload}
        >
          Download
        </Button>
      </div>

      {/* Full size dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
          <DialogTitle className="sr-only">
            Receipt: {receiptFilename || 'Image'}
          </DialogTitle>
          <div className="relative">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/50 to-transparent p-4">
              <span className="text-white text-sm font-medium truncate max-w-[300px]">
                {receiptFilename || 'Receipt'}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleDownload}
                  className="bg-white/20 hover:bg-white/30 text-white border-0"
                >
                  Download
                </Button>
              </div>
            </div>

            {/* Image */}
            <div className="flex items-center justify-center bg-black min-h-[400px] max-h-[80vh] overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={receiptUrl}
                alt={receiptFilename || 'Receipt'}
                className="max-w-full max-h-[80vh] object-contain"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Compact inline viewer for lists/cards
export function ReceiptViewerInline({
  receiptUrl,
  receiptFilename,
  className,
}: ReceiptViewerProps) {
  const isPDF = receiptFilename?.toLowerCase().endsWith('.pdf') ||
                receiptUrl.toLowerCase().includes('.pdf')

  return (
    <a
      href={receiptUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-2 text-sm text-forest-600 hover:text-forest-800 hover:underline',
        className
      )}
    >
      {isPDF ? (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )}
      {receiptFilename || 'View Receipt'}
    </a>
  )
}
