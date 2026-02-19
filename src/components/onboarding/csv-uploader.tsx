'use client'

import { useState, useCallback } from 'react'
import { Upload, FileText, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/ui/page-transition'
import { parseRosterWithMetadata, type ParsedRoster } from '@/lib/import/bsa-roster-parser'
import { RosterPreview } from './roster-preview'

interface CSVUploaderProps {
  /** Called when CSV is successfully parsed */
  onParsed: (roster: ParsedRoster) => void
  /** Called when import is confirmed */
  onImport: (roster: ParsedRoster) => Promise<void>
  /** Called when user cancels or clears the file */
  onCancel?: () => void
  /** Whether import is in progress */
  importing?: boolean
  /** Custom instruction text */
  instructions?: string
}

export function CSVUploader({
  onParsed,
  onImport,
  onCancel,
  importing = false,
  instructions,
}: CSVUploaderProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsedRoster, setParsedRoster] = useState<ParsedRoster | null>(null)

  const processFile = useCallback(async (uploadedFile: File) => {
    if (!uploadedFile.name.endsWith('.csv')) {
      setError('Please upload a CSV file')
      return
    }

    setFile(uploadedFile)
    setIsParsing(true)
    setError(null)

    try {
      const content = await uploadedFile.text()
      const roster = parseRosterWithMetadata(content)

      if (roster.scouts.length === 0 && roster.adults.length === 0) {
        setError('Could not find any scouts or adults in the CSV file. Please ensure this is a valid BSA roster export.')
        setFile(null)
        setIsParsing(false)
        return
      }

      setParsedRoster(roster)
      onParsed(roster)
      setIsParsing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file')
      setFile(null)
      setIsParsing(false)
    }
  }, [onParsed])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      processFile(droppedFile)
    }
  }, [processFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      processFile(selectedFile)
    }
  }, [processFile])

  const clearFile = useCallback(() => {
    setFile(null)
    setParsedRoster(null)
    setError(null)
    onCancel?.()
  }, [onCancel])

  const handleImport = useCallback(async () => {
    if (!parsedRoster) return
    await onImport(parsedRoster)
  }, [parsedRoster, onImport])

  // Show preview if file is parsed
  if (parsedRoster && file) {
    return (
      <FadeIn className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 p-4">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-forest-600" />
            <div>
              <p className="font-medium text-stone-900 dark:text-stone-100">{file.name}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                {parsedRoster.scouts.length} scouts, {parsedRoster.adults.length} adults
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={clearFile} disabled={importing}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <RosterPreview
          scouts={parsedRoster.scouts}
          adults={parsedRoster.adults}
          errors={parsedRoster.errors}
        />

        <div className="flex gap-3">
          <Button variant="outline" onClick={clearFile} className="flex-1" disabled={importing}>
            Upload Different File
          </Button>
          <Button onClick={handleImport} className="flex-1" disabled={importing}>
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              'Import Roster'
            )}
          </Button>
        </div>
      </FadeIn>
    )
  }

  // Show upload UI
  return (
    <FadeIn className="space-y-6">
      {error && (
        <div className="rounded-lg bg-error-light dark:bg-error/10 border border-error/20 p-4">
          <p className="text-sm text-error-dark dark:text-error">{error}</p>
        </div>
      )}

      {file ? (
        <div className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 p-4">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-forest-600" />
            <div>
              <p className="font-medium text-stone-900 dark:text-stone-100">{file.name}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                {isParsing ? 'Parsing roster...' : 'Ready to preview'}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={clearFile} disabled={isParsing}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
            isDragging
              ? 'border-forest-500 bg-forest-50 dark:bg-forest-900/20'
              : 'border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-800/50 hover:border-stone-400 dark:hover:border-stone-500'
          }`}
        >
          <Upload className={`h-12 w-12 ${isDragging ? 'text-forest-500' : 'text-stone-400 dark:text-stone-500'}`} />
          <p className="mt-4 text-center text-stone-600 dark:text-stone-300">
            Drag and drop your BSA roster CSV file here, or
          </p>
          <label className="mt-2 cursor-pointer">
            <span className="text-forest-600 dark:text-forest-400 hover:text-forest-700 dark:hover:text-forest-300 font-medium">
              browse to select
            </span>
            <input
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={handleFileSelect}
            />
          </label>
          {instructions ? (
            <p className="mt-4 text-sm text-stone-500 dark:text-stone-400 text-center">
              {instructions}
            </p>
          ) : (
            <div className="mt-6 text-sm text-stone-500 dark:text-stone-400 text-center">
              <p className="font-medium mb-1">How to export your roster:</p>
              <ol className="text-left list-decimal list-inside space-y-1">
                <li>Go to my.scouting.org</li>
                <li>Navigate to Roster → Unit Roster</li>
                <li>Click Export → Export All to CSV</li>
              </ol>
            </div>
          )}
        </div>
      )}
    </FadeIn>
  )
}
