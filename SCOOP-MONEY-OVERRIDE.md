# Scoop Money — Project Context & Overrides

This document defines Scoop Money, a personal finance Electron 
app built on the same stack and design language as Scoop CRM.
Reference SOUL.md for all architecture, design, and interaction 
patterns. Apply everything in SOUL.md unless overridden here.

═══════════════════════════════════════════════
APP IDENTITY
═══════════════════════════════════════════════

- App name: Scoop Money
- userData path: scoop-money
- Bundle ID: com.scoopmoneyapp
- Database filename: money.db
- Window title: Scoop Money

═══════════════════════════════════════════════
IGNORE THESE SOUL.md SECTIONS (CRM-specific)
═══════════════════════════════════════════════

- Gmail OAuth and polling patterns
- Apple Mail AppleScript integration
- Lead matching and bounce detection
- Pipeline/Active toggle system
- Outreach templates
- IPC channels prefixed with: mail:, gmail:, 
  lead:, followup:, templates:, taxonomy:

═══════════════════════════════════════════════
NAVIGATION PAGES
═══════════════════════════════════════════════

Left sidebar nav (same Apple Notes style as CRM):
- Dashboard
- Transactions
- Budget
- Summary
- Income
- Settings

═══════════════════════════════════════════════
CORE DATA MODELS
═══════════════════════════════════════════════

TRANSACTION:
- id, date (unix), description, amount (cents integer),
  raw_category (from bank/card), mapped_category,
  account_id, source (csv_import | manual | ai),
  notes, created_at, updated_at

ACCOUNT:
- id, name, type (checking | savings | credit | venmo),
  institution, color, created_at

BUDGET_ITEM:
- id, category, monthly_amount (cents),
  budget_type (standard | with_aid | with_parents),
  is_need (boolean), created_at, updated_at

INCOME_ENTRY:
- id, shoot_name, company, date (unix),
  amount (cents), notes, created_at, updated_at

CATEGORY_MAPPING_RULE:
- id, raw_category (string from bank),
  mapped_category (user's budget category),
  description_contains (optional keyword match),
  priority (integer), created_at

BUDGET CATEGORIES (user-defined, these are defaults):
Needs: Rent, Utilities, Insurance, Groceries, 
       Gas, Phone, Subscriptions, Healthcare
Nice to Haves: Dining Out, Bars, Shopping, 
               Entertainment, Personal Care, 
               Business Expenses

═══════════════════════════════════════════════
BUDGET TYPES (toggleable)
═══════════════════════════════════════════════

Three budget type variants the user can toggle between:
- standard (baseline, no outside help)
- with_aid (government assistance factored in)
- with_parents (parental contributions factored in)

Each budget_item has a monthly_amount per budget_type.
Active budget_type is stored in localStorage and 
affects all budget comparisons and visualizations globally.

═══════════════════════════════════════════════
PAGE SPECIFICATIONS
═══════════════════════════════════════════════

DASHBOARD:
Primary feature is a large dynamic X-Y spending chart:
- Y axis: dollars spent
- X axis: time (variable units: day / week / month)
- Toggle between day/week/month view
- Line + scatter plot showing actual spending per period
- Data points connected by a line (path visualization)
- Overlaid budget line in a different color that scales
  correctly with the selected time unit:
  daily budget = monthly_budget / days_in_month
  weekly budget = monthly_budget * 12 / 52
  monthly budget = monthly_budget
- Hover tooltip showing exact amount and date per data point
- Built with Recharts (already in stack)
- Chart is modifiable: can filter by category, 
  account, or date range
- Below chart: quick stat row showing current month
  total spent vs budget, income vs expenses

TRANSACTIONS:
- Scrollable list of all transactions
- Each transaction is a compact card/row showing:
  date, description, mapped_category, amount
  color-coded: red if over contributing to budget breach,
  green if within budget
- Import button: accepts CSV or Excel file drag-and-drop
- AI auto-categorizes imported transactions using 
  category_mapping_rules + Anthropic API
- Filter bar: by account, category, date range, 
  import source
- Inline editing on all fields (double-click pattern)
- Manual add transaction button

BUDGET:
- List of all budget categories split into 
  Needs and Nice to Haves sections
- Each category shows: name, monthly budget amount,
  current month spent, difference (over/under)
- Cells are RED if over budget, GREEN if under budget
  (matches Google Sheets mental model)
- Budget type toggle at top (standard / with_aid / 
  with_parents) — changes all amounts globally
- Inline editing on budget amounts (double-click)
- Add/remove budget categories

SUMMARY:
- Monthly overview comparing expenses vs budget
  per category across multiple months
- Creative visual: grouped bar chart or heatmap grid
  showing each month as a column and each category 
  as a row — cell color intensity = % of budget used
- Time range selector: last 3 / 6 / 12 months
- Export to CSV button

INCOME:
- AI chat box (same pattern as CRM chat boxes)
  where user pastes photography gig info
- AI extracts and creates income entries with:
  shoot_name, company, date, amount, notes
- Income entries display as compact cards showing:
  shoot name (bold), company (muted below name),
  date, amount (green), expandable notes field
- Total income this month shown at top
- Income vs expenses comparison stat
- Filter by month, company

SETTINGS:
- Category Mapping Rules (most important section):
  Table of raw_category → mapped_category rules
  Plus optional description_contains keyword matcher
  Add/edit/delete rules inline
  These rules are applied on every CSV import
  and re-applied when user hits "Re-categorize All"
- Budget Categories management:
  Add/rename/delete custom categories
  Assign to Needs vs Nice to Haves
- Accounts management:
  Add/edit/delete accounts with type and color
- Theme: light/dark toggle (same ThemeContext pattern)
- Data: export all data to CSV, backup now, backup list
- AI Model selector (same swappable pattern as CRM)

═══════════════════════════════════════════════
TRANSACTION IMPORT FLOW
═══════════════════════════════════════════════

1. User drags CSV or Excel file onto Transactions page
   or clicks Import button
2. papaparse (CSV) or SheetJS (Excel) parses the file
3. Main process maps columns to Transaction fields:
   common column name variants handled automatically
   (Date/Trans Date/Posted Date → date,
    Description/Merchant/Payee → description,
    Amount/Debit/Credit → amount,
    Category/Type → raw_category)
4. Category mapping rules applied in priority order:
   a) description_contains keyword match (highest priority)
   b) raw_category exact match
   c) raw_category fuzzy match
   d) AI classification via Anthropic (fallback only)
5. Preview screen shows parsed transactions with 
   mapped categories before confirming import
6. User can correct categories inline in preview
7. Confirmed transactions saved to database
8. Duplicate detection: skip transactions where 
   date + description + amount already exist

═══════════════════════════════════════════════
AI INTEGRATION FOCUS
═══════════════════════════════════════════════

AI is used for:
- Transaction categorization during import (fallback)
- Income entry extraction from pasted text in Income page
- Dashboard chat: answer questions about spending
  ("how much did I spend on dining in April?")
  ("am I on track for my budget this month?")
  ("what's my average monthly grocery spend?")

AI is NOT used for:
- Outreach, emails, lead management
- Any external service automation

Each page has its own independent chat history 
following the same ChatContext pattern as CRM.
Page IDs: dashboard, transactions, budget, 
          summary, income

═══════════════════════════════════════════════
TECH ADDITIONS (on top of CRM stack)
═══════════════════════════════════════════════

Add these packages not in CRM:
- papaparse — CSV parsing
- xlsx (SheetJS) — Excel import
- date-fns — date math for budget period calculations

All amounts stored as INTEGER cents in SQLite.
Display layer divides by 100 and formats as currency.
Never store floating point dollar amounts.

═══════════════════════════════════════════════
WHAT SCOOP MONEY IS NOT
═══════════════════════════════════════════════

- Not a bank connection tool (no Plaid, no OAuth to banks)
- Not a multi-user app
- Not a cloud sync tool
- Not a tax preparation tool
- Not a stock/investment tracker (yet)