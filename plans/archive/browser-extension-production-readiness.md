# Browser Extension Production Readiness Plan

## Goal
Make the Chuckbox browser extension easier to use and production-ready for users on chuckbox.app with single-unit setups.

## Scope
- Single hosted instance (chuckbox.app)
- One unit per extension setup
- Developer mode installation (Chrome Web Store is future phase)

---

## Current Pain Points

1. **Token setup is cumbersome** - User must navigate to settings, generate token, manually copy/paste into extension
2. **Extension is hard to discover** - Buried under "Import Options" in Scoutbook Plus card
3. **No unit context shown** - Extension doesn't display which unit it's connected to
4. **Unclear connection status** - "Token Set" vs "Connected" is confusing
5. **No installation instructions** - Users don't know how to install the unpacked extension

---

## Implementation Plan

### Phase 1: Improve Chuckbox Settings UI

#### 1.1 Keep CSV as Primary, Extension as Alternative
**File:** `src/components/settings/scoutbook-sync-card.tsx`

- CSV upload remains the primary/recommended import option
- Browser extension positioned as alternative for users who prefer real-time sync
- Clearer benefit text: "Sync directly from Scoutbook while browsing"
- Note: Extension becomes primary option once two-way sync (Chuckbox → Scoutbook) is implemented

#### 1.2 Better Token Generation UX
**File:** `src/components/settings/scoutbook-sync-card.tsx`

- Show unit name when generating token: "Generate token for Troop 9297"
- After token generated, show clear next steps:
  1. "Install the extension" (with link to instructions)
  2. "Paste this token in the extension"
  3. "Navigate to Scoutbook and click Sync"
- Add "Installation Guide" expandable section with screenshots

#### 1.3 Add Extension Connection Status
**Files:**
- `src/app/api/scoutbook/extension-auth/route.ts`
- `src/components/settings/scoutbook-sync-card.tsx`

- GET endpoint returns: `{ valid: boolean, unitName: string, lastUsedAt: Date | null }`
- Show in settings: "Extension connected" with last sync time
- Or: "No extension connected" with setup prompts

---

### Phase 2: Improve Extension Popup UX

#### 2.1 Show Unit Context
**File:** `chuckbox-extension/src/popup/popup.ts`

- After successful auth check, display unit name in popup header
- Store unit info from auth response in local storage
- Example: "Connected to Troop 9297"

#### 2.2 Simplify Status Indicators
**File:** `chuckbox-extension/src/popup/popup.html` & `popup.ts`

Current states are confusing. Simplify to:
- **Red**: "Not Connected" → Shows token input
- **Green**: "Connected to [Unit Name]" → Ready to sync
- Remove intermediate "Token Set" yellow state (just validate immediately)

#### 2.3 Better Token Input Flow
**File:** `chuckbox-extension/src/popup/popup.ts`

- Auto-validate token immediately on paste
- Show spinner during validation
- Clear error message if invalid: "Token expired or invalid. Generate a new one in Chuckbox."
- Success: Immediately show unit name and enable sync button

#### 2.4 Improve Sync Feedback
**File:** `chuckbox-extension/src/popup/popup.ts`

- After successful sync, show summary inline (not just link):
  - "Synced 24 scouts, 8 adults"
  - "3 new, 2 updates ready for review"
- Prominent "Review Changes" button that opens Chuckbox settings

---

### Phase 3: Installation Instructions

#### 3.1 Add README/Installation Guide
**File:** `chuckbox-extension/INSTALL.md` (new)

Create clear installation guide with:
1. Download extension (link to release zip or repo)
2. Unzip to folder
3. Open chrome://extensions
4. Enable Developer Mode
5. Click "Load unpacked" and select folder
6. Screenshots for each step

#### 3.2 Link from Chuckbox Settings
**File:** `src/components/settings/scoutbook-sync-card.tsx`

- Add "How to Install" expandable section
- Include same instructions inline or link to hosted guide
- Show download link for extension files

---

### Phase 4: Polish & Error Handling

#### 4.1 Improve Error Messages
**Files:** `chuckbox-extension/src/popup/popup.ts`, `src/lib/api.ts`

| Error | Current Message | Improved Message |
|-------|-----------------|------------------|
| Invalid token | "Request failed" | "Token is invalid or expired. Generate a new one in Chuckbox Settings." |
| Network error | Generic error | "Cannot connect to Chuckbox. Check your internet connection." |
| Rate limited | "Rate limit exceeded" | "Too many syncs. Please wait an hour before syncing again." |
| Not on roster | "Not a roster page" | "Navigate to your Scoutbook roster page, then click Sync." |

#### 4.2 Add Logout/Reset Option
**File:** `chuckbox-extension/src/popup/popup.ts`

- Add "Disconnect" button (currently only "Clear" which is unclear)
- Confirms: "This will remove your token. You'll need to generate a new one."
- Clears token and resets to initial state

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/settings/scoutbook-sync-card.tsx` | Promote extension, add unit context, installation guide |
| `src/app/api/scoutbook/extension-auth/route.ts` | Return unit name in auth response |
| `chuckbox-extension/src/popup/popup.html` | Simplify status UI, add unit name display |
| `chuckbox-extension/src/popup/popup.ts` | Auto-validate token, show unit name, better errors |
| `chuckbox-extension/src/lib/api.ts` | Include unit info in auth response type |
| `chuckbox-extension/INSTALL.md` | New installation guide |

---

## Verification Plan

### Manual Testing
1. Fresh setup flow:
   - New user navigates to Settings → Integrations
   - Extension option is prominent and clear
   - Generate token shows unit name
   - Install extension following guide
   - Paste token, see unit name appear
   - Navigate to Scoutbook, sync works
   - Review changes in Chuckbox

2. Error scenarios:
   - Paste invalid/expired token → clear error message
   - Try to sync without token → guided to settings
   - Try to sync on wrong page → clear instruction

3. Reconnection flow:
   - Clear token in extension
   - Generate new token
   - Reconnect successfully

---

## Implementation Order

1. **Phase 2.1-2.3**: Extension popup improvements (unit context, token validation)
2. **Phase 1.3**: API returns unit name on auth check
3. **Phase 1.1-1.2**: Settings UI improvements
4. **Phase 3**: Installation guide
5. **Phase 4**: Error handling polish

This order lets us test the core UX improvements quickly before polishing the onboarding flow.

---

## Out of Scope (Future)
- Chrome Web Store publication
- Multi-unit token switching
- Self-hosted instance support
- OAuth-style token flow (redirect-based)
- Two-way sync (Chuckbox → Scoutbook) - when implemented, extension becomes primary option
