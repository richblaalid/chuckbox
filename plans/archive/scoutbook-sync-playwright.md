# Scoutbook Sync via agent-browser - Implementation Plan

## Overview

This plan outlines using [Vercel's agent-browser](https://github.com/vercel-labs/agent-browser) for browser automation to sync data between Chuckbox and Scoutbook Plus. Agent-browser is specifically designed for AI agent integration, using accessibility tree snapshots and ref-based element selection instead of fragile CSS selectors—making it more resilient to Scoutbook DOM changes.

**Status**: Exploration complete. Ready for implementation.

## Why agent-browser over raw Playwright?

| Aspect | Raw Playwright | agent-browser |
|--------|----------------|---------------|
| Element selection | CSS selectors (fragile) | Accessibility refs (robust) |
| DOM change resilience | Requires selector updates | Semantic labels more stable |
| Error recovery | Manual fallback logic | AI can adapt dynamically |
| LLM integration | Generic output | Optimized for AI agents |
| Session management | Manual | Daemon with persistence |
| Serverless support | Needs configuration | Built-in (`@sparticuz/chromium`) |

## Goals

### Phase 1: Read-Only Down-Sync (MVP)
- Authenticate to Scoutbook using user-provided credentials
- Navigate to unit roster and extract scout/adult member data
- Navigate to advancement pages and extract:
  - Rank progress (requirements completed, dates)
  - Merit badge progress
  - Awards and recognitions
- Store extracted data in Chuckbox database
- Use AI-assisted error recovery when page structure changes

### Phase 2: Bi-Directional Sync (Future)
- Mark requirements as completed in Scoutbook
- Record camping nights, service hours
- Handle Scoutbook's split between Legacy and Plus interfaces

---

## Discovered Page Structures (January 2026 Exploration)

### Key URLs (Scoutbook Plus)

| Page | URL Pattern | Data Available |
|------|-------------|----------------|
| **Login** | `https://advancements.scouting.org/` | Authentication (CAPTCHA required) |
| **Roster** | `https://advancements.scouting.org/roster` | Full member list with ranks, patrols |
| **Youth Profile** | `https://advancements.scouting.org/youthProfile/{internal_id}` | Individual scout details |
| **Rank Requirements** | Navigation from Youth Profile | Detailed requirement completion |
| **Calendar** | `https://advancements.scouting.org/calendar` | Events |
| **Reports** | `https://advancements.scouting.org/reports` | Various reports |
| **Activity Logs** | `https://advancements.scouting.org/activities` | Camping, hiking, service hours |

### Access Model (Important!)

Different Scoutbook roles have different data access:

| Role | Roster Access | Individual Advancement | Notes |
|------|---------------|------------------------|-------|
| Parent/Guardian | Connected scouts only | Connected scouts only | Can see detailed requirements |
| Committee Member | Full roster (read-only) | Cannot click into scouts | Good for roster sync |
| **Unit Admin** | Full roster | **Full access to all scouts** | Ideal for complete sync |
| Key 3 (SM, CC, COR) | Full roster | Full access | Same as Unit Admin |

**Recommendation**: For full sync capability, users should have **Unit Admin** role in Scoutbook.

---

## Login Page Structure

**URL**: `https://advancements.scouting.org/`

```
Login Form Elements:
┌────────────────────────────────────────┐
│ @e1: textbox "Username (my.scouting)"  │
│ @e2: textbox "Password"                │
│ @e3: button "LOGIN" [disabled]         │  <- Enabled after CAPTCHA
│ @e4: link "Forgot username/password?"  │
│ @e5: button "Sign in with Apple"       │
│ @e6: button "CREATE ACCOUNT"           │
│                                        │
│ [iframe: reCAPTCHA - requires manual]  │
└────────────────────────────────────────┘
```

**CAPTCHA Note**: The "I am not a robot" checkbox is in an iframe and requires manual user interaction. This is by design for security.

---

## Roster Page Structure (Committee Member+ View)

**URL**: `https://advancements.scouting.org/roster`

**Sample snapshot data** (Troop 9297, 72 members):

```
Navigation Menu:
├── @e1: menuitem "Roster" (current)
├── @e3: menuitem "Calendar"
├── @e5: menuitem "Profile"
├── @e7: menuitem "Reports"
├── @e9: menuitem "Activity Logs"
├── @e11: menuitem "Forum"
├── @e12: menuitem "SB Scoutbook Legacy"
├── @e13: menuitem "References"
└── @e15: menuitem "Settings"

Page Controls:
├── @e21: tab "Roster" [selected]
├── @e22: tab "Advancements"
├── @e23: textbox "Search by Name or Member ID"
├── @e24: button "Unit Quick Entry"
├── @e25: button "Quick Report"
└── @e26: button "Group/Edit Patrol"

Roster Table Columns:
├── Name
├── Member ID (BSA ID)
├── Type (YOUTH / LEADER / P 18+)
├── Age
├── Last Rank Approved
├── Patrol
├── Position
├── Renewal Status
├── Dropping (switch)
└── Expiration Date
```

**Extracted Data Model** (from actual snapshot):

```typescript
interface RosterMember {
  name: string;           // "George Anderson"
  bsaMemberId: string;    // "133456904"
  type: 'YOUTH' | 'LEADER' | 'P 18+';
  age: string;            // "15" or "(21+)"
  lastRankApproved: string; // "Life Scout", "Eagle Scout", etc.
  patrol: string;         // "Flaring Phoenix", "Blazing Bulls"
  position: string;       // "Senior Patrol Leader", "Scoutmaster"
  renewalStatus: string;  // "Current", "Eligible to Renew"
  expirationDate: string; // "8/31/2026"
}
```

**Pagination**: 10 items per page, with page navigation refs (`@e145`-`@e153`).

---

## Youth Profile Page Structure (Parent/Unit Admin View)

**URL**: `https://advancements.scouting.org/youthProfile/{internal_id}`

```
Scout Summary:
├── Name: "Ben Blaalid"
├── Status: "Current"
├── BSA ID: "141419860"
├── Unit: "Troop 9297"
├── Patrol: "Blazing Bulls"
├── Date Joined Scouts BSA: "03/17/2025"
├── Last Rank (Scouts BSA): "Tenderfoot"
└── Last Rank (Cub Scout): "Arrow of Light"

Relationships:
└── "Richard Blaalid - 141419859" (Parent)

Leadership Positions:
├── Total days: 435
├── Current: Den Chief (130 days)
├── Current: Patrol Leader (130 days)
└── Past: Assistant Patrol Leader (175 days)

Scouts BSA Ranks (expandable):
├── Scout: AWARDED, 04-14-2025, 100%
├── Tenderfoot: APPROVED, 12-01-2025, 100%
├── Second Class: 27% [View More @e19]
├── First Class: 18% [View More]
├── Star Scout: 23% [View More]
├── Life Scout: 0% [View More]
└── Eagle Scout: 11% [View More]

Merit Badges:
├── 3 Pending, 3 Approved
└── [Start New] button

Awards:
├── 0 Pending, 0 Approved
└── [Start New] button

Activity Logs:
├── Camping: 2 NIGHTS
├── Hiking: 0 MILES
└── Service Hours: 2.5 HOURS
```

**Extracted Data Model**:

```typescript
interface ScoutProfile {
  name: string;
  bsaMemberId: string;
  status: 'Current' | 'Eligible to Renew' | 'Expired';
  unit: string;
  patrol: string;
  dateJoined: string;
  lastRankScoutsBSA: string;
  lastRankCubScout?: string;

  relationships: {
    name: string;
    bsaMemberId: string;
    relationship: string;  // "Parent", "Guardian"
  }[];

  leadershipPositions: {
    position: string;
    days: number;
    current: boolean;
    dateRange: string;
  }[];

  rankProgress: {
    rankName: string;
    status: 'AWARDED' | 'APPROVED' | 'STARTED' | 'NOT_STARTED';
    completedDate?: string;
    percentComplete: number;
  }[];

  meritBadges: {
    pending: number;
    approved: number;
  };

  activityLogs: {
    campingNights: number;
    hikingMiles: number;
    serviceHours: number;
  };
}
```

---

## Rank Requirements Page Structure

**Navigation**: Click "View More" on any rank from Youth Profile page.

**Sample**: Second Class Rank (27% complete)

```
Page Header:
├── @e15: button "Ben Blaalid's Profile" (back nav)
├── Rank: "Second Class"
├── Progress: "27%"
├── Status: "STARTED"
├── @e23: textbox "Final Completion Date"
├── @e24: checkbox "Mark as Approved/Recorded" [disabled]
├── @e25: checkbox "Mark as Awarded" [disabled]
└── @e27: combobox "Requirements Version 2022 (Active)"

Requirements List (expandable tabs):
Each requirement has:
├── Requirement ID (1a, 1b, 2a, etc.)
├── Status: STARTED | APPROVED [with date]
├── Full description text
├── @eXX: textbox "Completion Date"
├── @eXX: button "Add comment (N)"
└── @eXX: button "Save" [disabled until date entered]
```

**Sample Requirements Data** (Second Class):

| Req | Status | Date | Description (truncated) |
|-----|--------|------|------------------------|
| 1a | STARTED | - | Participate in five separate troop/patrol activities... |
| 1b | STARTED | - | Recite the Leave No Trace Seven Principles... |
| 2a | APPROVED | 09/29/2025 | Explain when it is appropriate to use a fire... |
| 3c | APPROVED | 04/26/2025 | Describe some hazards or injuries... |
| 5a | APPROVED | 03/24/2025 | Tell what precautions must be taken for a safe swim |
| 5b | APPROVED | 03/24/2025 | Demonstrate BSA beginner test... |
| 6b | APPROVED | 04/07/2025 | Show what to do for "hurry" cases... |
| 8a | APPROVED | 07/04/2025 | Participate in a flag ceremony... |

**Extracted Data Model**:

```typescript
interface RankRequirementDetail {
  rankName: string;           // "Second Class"
  requirementsVersion: string; // "2022 (Active)"
  percentComplete: number;    // 27
  status: 'STARTED' | 'APPROVED' | 'AWARDED';
  finalCompletionDate?: string;

  requirements: {
    id: string;               // "1a", "2b", "3c"
    status: 'STARTED' | 'APPROVED';
    completedDate?: string;   // "09/29/2025"
    description: string;      // Full requirement text
    commentCount: number;
  }[];
}
```

---

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Chuckbox App                           │
├─────────────────────────────────────────────────────────────┤
│  Sync Service (AI-Assisted)                                 │
│  ├── AgentBrowserClient  - CLI/SDK wrapper                  │
│  ├── SyncAgent (LLM)     - Interprets pages, handles errors │
│  ├── SnapshotParser      - Extract data from snapshots      │
│  └── SyncOrchestrator    - Coordinate sync operations       │
├─────────────────────────────────────────────────────────────┤
│  agent-browser daemon    - Manages Chromium via Playwright  │
│  └── Accessibility Tree  - Semantic element refs (@e1, @e2) │
└─────────────────────────────────────────────────────────────┘
```

### Sync Flow (with discovered structure)

```typescript
async function syncScoutbookData(unitId: string): Promise<SyncResult> {
  // 1. Open browser to login page
  await agentBrowser.open('https://advancements.scouting.org/', { headed: true });

  // 2. Wait for user to complete manual login (CAPTCHA)
  await waitForLoginComplete();  // Polls for absence of login form

  // 3. Navigate to roster (should auto-land here after login)
  // Verify we're on roster page
  let snapshot = await agentBrowser.snapshot({ json: true });

  // 4. Extract roster data (paginated - 72 members across 8 pages)
  const rosterMembers: RosterMember[] = [];
  while (hasNextPage(snapshot)) {
    rosterMembers.push(...parseRosterPage(snapshot));
    await agentBrowser.click(getNextPageRef(snapshot));
    snapshot = await agentBrowser.snapshot({ json: true });
  }

  // 5. For users with Unit Admin access: extract individual advancement
  for (const member of rosterMembers.filter(m => m.type === 'YOUTH')) {
    await navigateToYouthProfile(member.bsaMemberId);
    const profile = await extractYouthProfile();

    // Optionally expand each rank for detailed requirements
    for (const rank of profile.rankProgress) {
      if (rank.status !== 'NOT_STARTED') {
        await expandRank(rank.rankName);
        const requirements = await extractRankRequirements();
        // Store requirements...
      }
    }
  }

  // 6. Close browser and return results
  await agentBrowser.close();
  return { membersSync: rosterMembers.length, ... };
}
```

### Error Handling & Resilience

#### AI-Powered Recovery
When extraction fails, the AI can attempt recovery:

```typescript
async function extractWithRecovery(
  pageType: string,
  snapshot: AccessibilitySnapshot
): Promise<ExtractedData> {
  try {
    // First attempt: structured parsing
    return parseSnapshot(pageType, snapshot);
  } catch (e) {
    // Recovery: ask AI to interpret the snapshot
    const aiResult = await llm.complete({
      prompt: `The structured parser failed on this ${pageType} page.
               Snapshot: ${JSON.stringify(snapshot)}
               Extract the data manually and explain what changed.`,
    });

    // Log the change for future parser updates
    await logStructureChange(pageType, snapshot, aiResult.explanation);

    return aiResult.data;
  }
}
```

#### Rate Limiting
- Maximum 1 request per second
- Exponential backoff on errors (1s, 2s, 4s, 8s, max 60s)
- Circuit breaker: 5 consecutive failures = pause sync

#### Graceful Degradation
When automation fails:
1. Capture snapshot + screenshot of failed page
2. AI attempts to diagnose the issue
3. Notify user with human-readable error
4. Offer CSV export as fallback (existing roster import)

---

## Implementation Phases

### Phase 0: Setup & Exploration ✅ COMPLETE
- [x] Install agent-browser CLI (`npm install -g agent-browser`)
- [x] Install Playwright browsers (`agent-browser install`)
- [x] Explore Scoutbook Plus login page
- [x] Document login page accessibility structure
- [x] Explore roster page structure (Committee Member view)
- [x] Explore youth profile page structure (Parent view)
- [x] Explore rank requirements page structure
- [x] Document access model differences

### Phase 1A: Authentication & Navigation
- [ ] Implement browser launch with headed mode
- [ ] Implement login detection (poll for roster page elements)
- [ ] Handle role/profile selection if user has multiple
- [ ] Detect and handle session timeouts

### Phase 1B: Roster Extraction
- [ ] Build parser for roster accessibility tree
- [ ] Handle pagination (72 members across 8 pages)
- [ ] Extract all roster fields (name, BSA ID, rank, patrol, position, etc.)
- [ ] Match extracted scouts to existing Chuckbox scouts by BSA ID
- [ ] Create missing scouts (with user confirmation)
- [ ] Update existing scout records with fresh data
- [ ] Store sync session metadata

### Phase 1C: Advancement Extraction (requires Unit Admin)
- [ ] Navigate to individual youth profile pages
- [ ] Extract rank progress summary
- [ ] Expand ranks and extract detailed requirements
- [ ] Extract merit badge counts
- [ ] Extract activity logs (camping, hiking, service)
- [ ] Store in Chuckbox advancement tables

### Phase 1D: UI Integration
- [ ] Add "Sync from Scoutbook" button to Chuckbox settings
- [ ] Show sync progress indicator
- [ ] Display sync results summary
- [ ] Handle and display errors gracefully

---

## Database Schema Additions

```sql
-- Sync session tracking
CREATE TABLE sync_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  pages_visited INTEGER DEFAULT 0,
  records_extracted INTEGER DEFAULT 0,
  error_log JSONB,
  created_by UUID REFERENCES profiles(id)
);

-- Snapshot storage for debugging and replay
CREATE TABLE sync_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_session_id UUID REFERENCES sync_sessions(id),
  page_url TEXT NOT NULL,
  page_type TEXT NOT NULL,
  accessibility_tree JSONB NOT NULL,
  screenshot_url TEXT,  -- Optional, stored in Supabase Storage
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- Snapshot fingerprints for change detection
CREATE TABLE snapshot_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_type TEXT NOT NULL UNIQUE,
  structure_hash TEXT NOT NULL,
  key_elements JSONB NOT NULL,
  sample_snapshot JSONB,
  captured_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Advancement data (synced from Scoutbook)
CREATE TABLE scout_advancements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scout_id UUID REFERENCES scouts(id),
  bsa_member_id TEXT,
  current_rank TEXT,
  advancement_data JSONB,  -- Full profile snapshot
  synced_at TIMESTAMPTZ DEFAULT now(),
  sync_session_id UUID REFERENCES sync_sessions(id)
);

-- Rank requirement details
CREATE TABLE scout_rank_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scout_id UUID REFERENCES scouts(id),
  rank_name TEXT NOT NULL,
  requirements_version TEXT,
  percent_complete INTEGER,
  status TEXT CHECK (status IN ('not_started', 'started', 'approved', 'awarded')),
  requirements JSONB,  -- Array of {id, status, completedDate, description}
  synced_at TIMESTAMPTZ DEFAULT now(),
  sync_session_id UUID REFERENCES sync_sessions(id)
);
```

---

## User Experience: Manual Login Flow

The sync process requires user involvement for authentication (security + CAPTCHA), then automation handles the rest.

### Step-by-Step UX

```
┌─────────────────────────────────────────────────────────────┐
│  1. USER INITIATES SYNC                                     │
│     Chuckbox UI: [Start Scoutbook Sync] button              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  2. BROWSER OPENS (headed mode)                             │
│     Scoutbook Plus login page at advancements.scouting.org  │
│                                                             │
│     USER MANUALLY:                                          │
│     • Enters username                                       │
│     • Enters password                                       │
│     • Clicks "I am not a robot" CAPTCHA                     │
│     • Clicks LOGIN                                          │
│     • Handles MFA if prompted                               │
│     • Selects role if multiple (e.g., Committee Member)     │
│                                                             │
│     Estimated time: ~30 seconds                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  3. AUTOMATION TAKES OVER                                   │
│     • Detects successful login (roster page visible)        │
│     • Extracts roster data (all pages)                      │
│     • If Unit Admin: visits each scout's profile            │
│     • Extracts rank/merit badge progress                    │
│     • User sees progress bar in Chuckbox UI                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  4. SYNC COMPLETE                                           │
│     • Browser closes automatically                          │
│     • Chuckbox shows summary: "Synced 72 members"           │
│     • Advancement data available in Chuckbox                │
└─────────────────────────────────────────────────────────────┘
```

### Why Manual Login?

| Reason | Explanation |
|--------|-------------|
| Security | We never store Scoutbook passwords |
| CAPTCHA | "I am not a robot" requires human interaction |
| MFA | Two-factor auth requires user's phone/email |
| Trust | User maintains control of their BSA credentials |
| ToS | User-initiated action is more defensible legally |

### Detecting Login Success

After user completes login, automation detects success by:
1. Polling for absence of login form elements (`@e1: "Username"`)
2. Checking for presence of roster/navigation elements
3. URL check (no longer on root `/` path)

```typescript
async function waitForLogin(timeout: number = 120000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const snapshot = await agentBrowser.snapshot({ interactive: true, json: true });
    const refs = snapshot.data.refs;

    // Check if still on login page
    const hasLoginForm = Object.values(refs).some(
      r => r.name === 'Username (my.scouting)' || r.name === 'LOGIN'
    );

    if (!hasLoginForm) {
      // Verify we're on a real page (roster, profile, etc.)
      const hasNavMenu = Object.values(refs).some(
        r => r.name === 'Roster' && r.role === 'menuitem'
      );

      if (hasNavMenu) {
        return true;  // Successfully logged in
      }
    }

    await sleep(1000);
  }

  throw new Error('Login timeout - user did not complete login within 2 minutes');
}
```

---

## Security Considerations

### Credential Handling
- **Never store Scoutbook passwords** in Chuckbox database
- User enters credentials directly in browser window (not through Chuckbox)
- Chuckbox never sees or transmits the password
- agent-browser daemon clears session on completion

### Session Management
- Session cookies held only in agent-browser daemon memory
- Cleared immediately after sync completes
- No persistent Scoutbook session storage

### Rate Limiting & ToS
- Respectful rate limiting (1 req/sec max)
- User-initiated syncs only (no background polling)
- Clear user consent before each sync operation
- See `Chuckbox_Strategic_Roadmap_v2_2.md` Section 6.1 for ToS analysis

---

## Open Questions

1. **~~Credential storage~~**: Decided - require credentials each sync (no storage)

2. **Sync frequency**: On-demand only for MVP. Consider scheduled syncs post-MVP.

3. **Conflict resolution**: When Chuckbox and Scoutbook data differ, which wins?
   - Proposal: Scoutbook is source of truth for advancement data

4. **MFA handling**: Require user presence for MFA (no workaround)

5. **Unit selection**: Handle users with access to multiple units?
   - Observed: Users can switch between roles (Committee Member, Parent)
   - Need to handle role selection after login

6. **LLM provider**: Use Claude API for AI-assisted recovery

7. **Snapshot retention**: Keep snapshots for 30 days for debugging

---

## Next Steps (Implementation Order)

1. **Build sync service skeleton** - Create `src/lib/sync/scoutbook/` module structure
2. **Implement browser launch** - Open browser, wait for login
3. **Build roster parser** - Parse roster snapshot to `RosterMember[]`
4. **Handle pagination** - Navigate all roster pages
5. **Build profile parser** - Parse youth profile snapshot
6. **Build requirements parser** - Parse rank requirements
7. **Create database migration** - Add sync tables
8. **Build UI** - Settings page with sync button and progress

---

## Appendix: agent-browser CLI Reference

### Core Commands
```bash
# Navigation
agent-browser open <url>              # Navigate to URL
agent-browser open <url> --headed     # Show browser window (required for login)
agent-browser back                    # Go back in history
agent-browser forward                 # Go forward in history

# Snapshots (key feature!)
agent-browser snapshot                # Get accessibility tree
agent-browser snapshot -i             # Interactive elements only
agent-browser snapshot --json         # JSON output for parsing

# Interactions (using refs from snapshot)
agent-browser click @e1               # Click element by ref
agent-browser fill @e2 "text"         # Fill input by ref
agent-browser type "text"             # Type without targeting
agent-browser press Enter             # Press key

# Semantic locators (alternative to refs)
agent-browser find text "Ben Blaalid" click  # Find by text and click

# Screenshots
agent-browser screenshot              # Capture viewport
agent-browser screenshot --full       # Full page

# Session Management
agent-browser close                   # Close browser
agent-browser cookies --clear         # Clear session
```

### Installation
```bash
npm install -g agent-browser
agent-browser install  # Downloads Chromium
```

---

*Document created: January 2026*
*Last updated: January 15, 2026*
*Exploration completed: January 15, 2026*
*Automation tool: Vercel agent-browser v0.5.0*
