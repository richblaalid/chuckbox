# Background Import Jobs

## Overview

Convert troop advancement import from synchronous server action to background job pattern to prevent timeouts on large imports.

## Problem

- Large imports (50+ scouts, 27k+ requirements) take several minutes
- Vercel server actions timeout before completion
- UI shows no progress, user doesn't know if it's working
- HTTP connection drops but server continues processing

## Solution

Background job pattern:
1. User uploads CSV → Server creates job record → Returns job ID immediately
2. Server processes import in background, updating job progress
3. Client polls job status → Shows real-time progress → Completes when done

## Database Changes

### New table: `import_jobs`

```sql
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  type TEXT NOT NULL, -- 'troop_advancement', 'scout_history'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'

  -- Progress tracking
  total_scouts INTEGER DEFAULT 0,
  processed_scouts INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,

  -- Results (populated on completion)
  result JSONB, -- TroopAdvancementImportResult
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Store staged data for processing
  staged_data JSONB NOT NULL
);

-- RLS: Users can only see their unit's jobs
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their unit's import jobs"
  ON import_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = import_jobs.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
    )
  );
```

## Implementation

### Phase 1: Database Setup

- [ ] 1.1 Create migration for `import_jobs` table
- [ ] 1.2 Add RLS policies
- [ ] 1.3 Update database types

### Phase 2: Server Actions

- [ ] 2.1 Create `startImportJob` action
  - Creates job record with staged data
  - Returns job ID immediately

- [ ] 2.2 Create `processImportJob` action
  - Called after job created
  - Processes in chunks, updates progress
  - Uses `waitUntil` or similar for background execution

- [ ] 2.3 Create `getImportJobStatus` action
  - Returns job status and progress
  - Used for polling

### Phase 3: Background Processing

Option A: Use Vercel's `waitUntil` (if available)
Option B: Use edge function with streaming
Option C: Use separate API route with longer timeout

- [ ] 3.1 Implement background processor
- [ ] 3.2 Add progress updates during processing
- [ ] 3.3 Handle errors gracefully

### Phase 4: UI Updates

- [ ] 4.1 Update `troop-advancement-preview.tsx`
  - On import, call `startImportJob`
  - Transition to progress view

- [ ] 4.2 Create `ImportJobProgress` component
  - Polls job status every 2 seconds
  - Shows progress bar and stats
  - Handles completion/failure states

- [ ] 4.3 Update result display
  - Show final results when job completes
  - Allow retry on failure

## Files to Create

1. `supabase/migrations/2026XXXX_import_jobs.sql`
2. `src/app/actions/import-jobs.ts`
3. `src/components/import/import-job-progress.tsx`

## Files to Modify

1. `src/app/actions/troop-advancement-import.ts` - Refactor to use job pattern
2. `src/components/import/troop-advancement-preview.tsx` - Use new flow
3. `src/types/database.ts` - Add new table types

## Testing

1. Upload small file (< 10 scouts) - should complete quickly
2. Upload large file (50+ scouts) - should show progress, complete without timeout
3. Navigate away and back - should resume showing progress
4. Simulate failure - should show error state
