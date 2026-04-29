# UX Audit Plan: Brand Consistency & Performance Review

## Overview

Comprehensive UX audit of ChuckBox frontend using Playwright for visual testing, brand guideline compliance checking, mobile responsiveness verification, and React performance best practices review.

## Requirements

### User Value
- Ensure consistent brand experience across all pages
- Identify UX inconsistencies and accessibility issues
- Optimize for mobile-first usage (primary use case for busy scout leaders)
- Improve performance following Vercel React best practices

### Scope
**Included:**
- All 35+ dashboard pages
- Brand guideline compliance (colors, typography, spacing, voice)
- Mobile responsiveness (iPhone, iPad, Android viewports)
- React performance patterns (waterfalls, bundle size, server components)
- Component consistency audit

**Excluded:**
- Auth pages (login, logout, callback)
- API endpoint testing
- Database performance
- Backend architecture

### Success Criteria
- Markdown report with findings and recommendations
- Screenshots at mobile/tablet/desktop breakpoints
- Prioritized list of fixes (Critical/High/Medium/Low)
- Estimated effort for each fix

## Brand Guidelines Reference

Source: `chuckbox brand assets/chuckbox-brand-guide-v3.html`

### Colors (Target)
| Name | Hex | Usage |
|------|-----|-------|
| Pine 800 | #234D3E | Primary dark |
| Pine 700 | #2D6A4F | Primary |
| Pine 600 | #3D8B6A | Primary hover |
| Pine 500 | #52A07E | Primary light |
| Campfire 500 | #E85D04 | Accent/CTA |
| Campfire 400 | #F48C06 | Accent hover |
| Campfire 300 | #FAA307 | Accent light |
| Cream 300 | #F5E6D3 | Background |
| Cream 200 | #FAF3EB | Background light |
| Cream 100 | #FFFDF9 | Background lightest |

### Typography (Target)
- **Primary**: Nunito (headings, UI text)
- **Editorial**: Source Serif 4 (long-form content)

### Current Codebase (Observed)
- Colors: `forest-*` and `tan-*` (similar but not exact match)
- Fonts: Bricolage Grotesque, DM Sans (different from brand guide)

### Design Tokens
- Border radius small: 6px
- Border radius buttons: 10px
- Border radius cards: 16px
- Shadow subtle: `0 1px 2px rgba(35, 77, 62, 0.05)`

### Voice Guidelines
- Direct, Friendly, Helpful, Trustworthy
- Avoid jargon, be conversational
- Use active voice

## Technical Approach

### Phase 0: Setup

#### 0.1 Playwright Configuration
- [ ] 0.1.1 Create Playwright test config for visual regression
- [ ] 0.1.2 Define viewport presets (iPhone 13, iPad Pro, Desktop 1280px)
- [ ] 0.1.3 Set up screenshot comparison utilities
- [ ] 0.1.4 Create authentication helper for dashboard access

### Phase 1: Visual Audit

#### 1.1 Screenshot Capture
- [ ] 1.1.1 Capture all dashboard pages at mobile viewport (390x844)
- [ ] 1.1.2 Capture all dashboard pages at tablet viewport (820x1180)
- [ ] 1.1.3 Capture all dashboard pages at desktop viewport (1280x800)
- [ ] 1.1.4 Document any pages with loading states or errors

#### 1.2 Brand Compliance Check
- [ ] 1.2.1 Audit color usage against brand palette
- [ ] 1.2.2 Audit typography (fonts, sizes, weights)
- [ ] 1.2.3 Audit spacing and layout consistency
- [ ] 1.2.4 Audit component styling (buttons, cards, forms)
- [ ] 1.2.5 Audit iconography and imagery

#### 1.3 Mobile Responsiveness
- [ ] 1.3.1 Check touch target sizes (minimum 44x44px)
- [ ] 1.3.2 Check text readability at mobile sizes
- [ ] 1.3.3 Check navigation accessibility on mobile
- [ ] 1.3.4 Check form usability on mobile
- [ ] 1.3.5 Identify horizontal scroll issues

### Phase 2: Performance Audit

#### 2.1 React Patterns Review
Based on `.claude/skills/vercel-react-best-practices.md`:

- [ ] 2.1.1 Identify sequential data fetching (waterfalls)
- [ ] 2.1.2 Check for proper use of Server Components
- [ ] 2.1.3 Review client/server component boundaries
- [ ] 2.1.4 Check for unnecessary client-side state
- [ ] 2.1.5 Review bundle size impact of dependencies

#### 2.2 Loading States
- [ ] 2.2.1 Audit loading skeleton implementations
- [ ] 2.2.2 Check Suspense boundary placement
- [ ] 2.2.3 Review streaming opportunities

### Phase 3: Accessibility Audit

#### 3.1 Basic Accessibility
- [ ] 3.1.1 Check color contrast ratios (WCAG AA minimum)
- [ ] 3.1.2 Verify semantic HTML usage
- [ ] 3.1.3 Check form label associations
- [ ] 3.1.4 Verify keyboard navigation
- [ ] 3.1.5 Check focus indicators

### Phase 4: Report Generation

#### 4.1 Compile Findings
- [ ] 4.1.1 Create findings document with screenshots
- [ ] 4.1.2 Categorize issues by severity
- [ ] 4.1.3 Map issues to specific files/components
- [ ] 4.1.4 Provide fix recommendations
- [ ] 4.1.5 Estimate effort for each fix

## Pages to Audit

### Core Dashboard
1. `/` - Dashboard home
2. `/scouts` - Scout list
3. `/scouts/[id]` - Scout profile
4. `/scouts/[id]/edit` - Edit scout
5. `/scouts/new` - Add scout

### Financial
6. `/accounts` - Account list
7. `/accounts/[id]` - Account detail
8. `/billing` - Billing overview
9. `/billing/create` - Create billing record
10. `/billing/[id]` - Billing detail
11. `/payments` - Payments list
12. `/payments/new` - New payment
13. `/payments/[id]` - Payment detail
14. `/journal` - Journal entries
15. `/journal/[id]` - Journal detail
16. `/journal/new` - New journal entry
17. `/reports` - Financial reports

### Advancement
18. `/advancement` - Advancement overview
19. `/advancement/merit-badges` - Merit badges list
20. `/advancement/merit-badges/[id]` - Merit badge detail
21. `/advancement/ranks` - Ranks list
22. `/advancement/ranks/[id]` - Rank detail

### Administration
23. `/settings` - Unit settings
24. `/settings/users` - User management
25. `/settings/billing` - Billing settings
26. `/settings/integrations` - Integrations
27. `/roster` - Roster management
28. `/roster/import` - Roster import

### Parent/Scout Views
29. `/my-scouts` - Parent's scout view
30. `/my-account` - Parent account view

## Output Format

Final report will be generated as:
`/reports/ux-audit-[date].md`

### Report Structure
```markdown
# ChuckBox UX Audit Report
Date: [date]

## Executive Summary
- Total issues found: X
- Critical: X | High: X | Medium: X | Low: X

## Brand Compliance
### Colors
[findings with screenshots]

### Typography
[findings with screenshots]

### Components
[findings with screenshots]

## Mobile Responsiveness
[findings with screenshots at each breakpoint]

## Performance
[findings with code examples]

## Accessibility
[findings with WCAG references]

## Recommendations
### Critical (Fix Immediately)
### High Priority
### Medium Priority
### Low Priority (Nice to Have)

## Appendix
- Full screenshot gallery
- Component inventory
- Color usage map
```

## Task Log

| Task | Date | Status | Notes |
|------|------|--------|-------|
| | | | |

## Implementation Notes

### Playwright Setup
Use existing MCP Playwright tools for:
- `mcp__playwright__playwright_navigate` - Navigate to pages
- `mcp__playwright__playwright_screenshot` - Capture screenshots
- `mcp__playwright__playwright_resize` - Switch viewports
- `mcp__playwright__playwright_get_visible_html` - Extract DOM for analysis

### Authentication
Need to handle Supabase auth for dashboard access:
1. Navigate to login page
2. Fill credentials (use test user)
3. Wait for redirect to dashboard
4. Proceed with audit

### Screenshot Storage
Screenshots will be saved to:
`/reports/screenshots/[page-name]-[viewport].png`
