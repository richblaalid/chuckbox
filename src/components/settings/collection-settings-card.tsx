'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { AlertTriangle, Loader2 } from 'lucide-react'

interface CollectionSettings {
  overdue_threshold_days: number
  overdue_threshold_amount_cents: number
  reminder_email_subject: string
  reminder_email_template: string
}

interface CollectionSettingsCardProps {
  unitId: string
  settings: CollectionSettings
}

const DEFAULT_SETTINGS: CollectionSettings = {
  overdue_threshold_days: 30,
  overdue_threshold_amount_cents: 0,
  reminder_email_subject: 'Payment Reminder - {unit_name}',
  reminder_email_template: 'default',
}

export function CollectionSettingsCard({
  unitId,
  settings: initialSettings,
}: CollectionSettingsCardProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const settings = { ...DEFAULT_SETTINGS, ...initialSettings }

  const [thresholdDays, setThresholdDays] = useState(settings.overdue_threshold_days.toString())
  const [thresholdAmount, setThresholdAmount] = useState(
    (settings.overdue_threshold_amount_cents / 100).toString()
  )
  const [emailSubject, setEmailSubject] = useState(settings.reminder_email_subject)

  const handleSave = async () => {
    setIsLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const supabase = createClient()

      const newSettings = {
        overdue_threshold_days: parseInt(thresholdDays) || 30,
        overdue_threshold_amount_cents: Math.round((parseFloat(thresholdAmount) || 0) * 100),
        reminder_email_subject: emailSubject || DEFAULT_SETTINGS.reminder_email_subject,
        reminder_email_template: 'default',
      }

      const { error: updateError } = await supabase
        .from('units')
        .update({ collection_settings: newSettings as any })
        .eq('id', unitId)

      if (updateError) {
        throw new Error(updateError.message)
      }

      setSuccess(true)
      router.refresh()

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          Collection Settings
        </CardTitle>
        <CardDescription>
          Configure when accounts are considered overdue and how payment reminders are sent
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Threshold Days */}
          <div className="space-y-2">
            <Label htmlFor="thresholdDays">Overdue After (Days)</Label>
            <Input
              id="thresholdDays"
              type="number"
              min="1"
              max="365"
              value={thresholdDays}
              onChange={(e) => setThresholdDays(e.target.value)}
              placeholder="30"
            />
            <p className="text-xs text-stone-500">
              Accounts will be marked overdue after this many days
            </p>
          </div>

          {/* Threshold Amount */}
          <div className="space-y-2">
            <Label htmlFor="thresholdAmount">Minimum Amount ($)</Label>
            <Input
              id="thresholdAmount"
              type="number"
              min="0"
              step="0.01"
              value={thresholdAmount}
              onChange={(e) => setThresholdAmount(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-stone-500">
              Only send reminders for balances above this amount (0 = all)
            </p>
          </div>
        </div>

        {/* Email Subject */}
        <div className="space-y-2">
          <Label htmlFor="emailSubject">Reminder Email Subject</Label>
          <Input
            id="emailSubject"
            type="text"
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder="Payment Reminder - {unit_name}"
          />
          <p className="text-xs text-stone-500">
            Use {'{unit_name}'} to include your unit name in the subject
          </p>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="text-sm text-error bg-error/10 rounded-lg p-3">
            {error}
          </div>
        )}

        {success && (
          <div className="text-sm text-success bg-success/10 rounded-lg p-3">
            Settings saved successfully!
          </div>
        )}

        {/* Save Button */}
        <Button
          onClick={handleSave}
          disabled={isLoading}
          className="gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
