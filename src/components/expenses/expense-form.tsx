'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { ReceiptUploader } from './receipt-uploader'
import { ReceiptViewer } from './receipt-viewer'
import {
  createExpenseReimbursement,
  updateExpenseReimbursement,
} from '@/app/actions/expenses'
import { EXPENSE_CATEGORIES, CATEGORY_OPTIONS } from '@/lib/expenses/constants'
import type { ExpenseCategory, ExpenseReimbursement } from '@/lib/expenses/types'

interface ExpenseFormProps {
  unitId: string
  expense?: ExpenseReimbursement | null
  mode?: 'create' | 'edit'
}

export function ExpenseReimbursementForm({
  unitId,
  expense,
  mode = 'create',
}: ExpenseFormProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [description, setDescription] = useState(expense?.description || '')
  const [amount, setAmount] = useState(expense?.amount?.toString() || '')
  const [expenseDate, setExpenseDate] = useState(
    expense?.expense_date || new Date().toISOString().split('T')[0]
  )
  const [category, setCategory] = useState<ExpenseCategory | ''>(
    expense?.category || ''
  )
  const [vendor, setVendor] = useState(expense?.vendor || '')
  const [receiptUrl, setReceiptUrl] = useState(expense?.receipt_url || '')
  const [receiptFilename, setReceiptFilename] = useState(
    expense?.receipt_filename || ''
  )
  const [filePath, setFilePath] = useState('')

  // Extract data from receipt using AI
  const handleExtractFromReceipt = async () => {
    if (!receiptUrl) {
      setError('Please upload a receipt first')
      return
    }

    setIsExtracting(true)
    setError(null)

    try {
      const response = await fetch('/api/expenses/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptUrl, unitId }),
      })

      const result = await response.json()

      if (!result.success) {
        setError(result.error || 'Failed to extract receipt data')
        return
      }

      const data = result.data

      // Update form fields with extracted data (user confirms)
      if (data.amount && !amount) {
        setAmount(data.amount.toString())
      }
      if (data.vendor && !vendor) {
        setVendor(data.vendor)
      }
      if (data.date && !expenseDate) {
        setExpenseDate(data.date)
      }
      if (data.description && !description) {
        setDescription(data.description)
      }

      addToast({
        variant: 'success',
        title: 'Receipt analyzed',
        description:
          data.confidence === 'high'
            ? 'Data extracted successfully. Please verify the details.'
            : 'Some data extracted. Please review and complete the form.',
      })
    } catch (err) {
      setError('Failed to analyze receipt')
    } finally {
      setIsExtracting(false)
    }
  }

  // Handle receipt upload
  const handleReceiptUpload = (data: {
    receiptUrl: string
    receiptFilename: string
    filePath: string
  }) => {
    setReceiptUrl(data.receiptUrl)
    setReceiptFilename(data.receiptFilename)
    setFilePath(data.filePath)
    setError(null)
  }

  // Handle receipt remove
  const handleReceiptRemove = () => {
    setReceiptUrl('')
    setReceiptFilename('')
    setFilePath('')
  }

  // Submit form
  const handleSubmit = async (saveAsDraft: boolean = false) => {
    setIsLoading(true)
    setError(null)

    // Validate required fields
    if (!description.trim()) {
      setError('Description is required')
      setIsLoading(false)
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Amount must be greater than 0')
      setIsLoading(false)
      return
    }

    if (!expenseDate) {
      setError('Date is required')
      setIsLoading(false)
      return
    }

    if (!category) {
      setError('Category is required')
      setIsLoading(false)
      return
    }

    const formData = {
      description: description.trim(),
      amount: parseFloat(amount),
      expense_date: expenseDate,
      category: category,
      vendor: vendor.trim() || undefined,
      receipt_url: receiptUrl || undefined,
      receipt_filename: receiptFilename || undefined,
      submit: !saveAsDraft,
    }

    try {
      let result

      if (mode === 'edit' && expense) {
        result = await updateExpenseReimbursement(expense.id, formData)
      } else {
        result = await createExpenseReimbursement(unitId, formData)
      }

      if (result.success) {
        addToast({
          variant: 'success',
          title: saveAsDraft ? 'Draft saved' : 'Expense submitted',
          description: saveAsDraft
            ? 'Your expense has been saved as a draft.'
            : 'Your expense has been submitted for review.',
        })
        router.push('/expenses')
        router.refresh()
      } else {
        setError(result.error || 'Failed to save expense')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-error-light border border-error p-4 text-error">
          {error}
        </div>
      )}

      {/* Receipt Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Receipt</CardTitle>
          <CardDescription>
            Upload a photo or PDF of your receipt for this expense
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {receiptUrl ? (
            <div className="space-y-4">
              <ReceiptViewer
                receiptUrl={receiptUrl}
                receiptFilename={receiptFilename}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleExtractFromReceipt}
                  disabled={isExtracting || isLoading}
                >
                  {isExtracting ? 'Analyzing...' : 'Extract from Receipt'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleReceiptRemove}
                  disabled={isLoading}
                  className="text-error hover:text-error hover:bg-error-light"
                >
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <ReceiptUploader
              unitId={unitId}
              onUploadComplete={handleReceiptUpload}
              onUploadError={(err) => setError(err)}
              disabled={isLoading}
            />
          )}
        </CardContent>
      </Card>

      {/* Expense Details */}
      <Card>
        <CardHeader>
          <CardTitle>Expense Details</CardTitle>
          <CardDescription>
            Enter the details of your expense. All fields except vendor are
            required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What was this expense for?"
                rows={3}
                disabled={isLoading}
              />
            </div>

            {/* Amount and Date */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">
                    $
                  </span>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="pl-7"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="expense_date">Date of Expense *</Label>
                <Input
                  id="expense_date"
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Category and Vendor */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category">Category *</Label>
                <Select
                  value={category}
                  onValueChange={(value) =>
                    setCategory(value as ExpenseCategory)
                  }
                  disabled={isLoading}
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {category && (
                  <p className="text-xs text-stone-500">
                    {EXPENSE_CATEGORIES[category].description}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                <Input
                  id="vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="Store or business name"
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleSubmit(true)}
          disabled={isLoading}
        >
          {isLoading ? 'Saving...' : 'Save as Draft'}
        </Button>
        <Button
          type="button"
          onClick={() => handleSubmit(false)}
          disabled={isLoading}
        >
          {isLoading ? 'Submitting...' : 'Submit for Review'}
        </Button>
      </div>
    </div>
  )
}
