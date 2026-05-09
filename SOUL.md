# SOUL.md

This document captures the working philosophy, architecture, and implementation conventions behind Scoop CRM so a new Electron app can be built on the same stack and feel like part of the same product family.

═══════════════════════════════════════════════

## 1. STACK & ARCHITECTURE

═══════════════════════════════════════════════

### Exact Tech Stack

The current stack is defined in `package.json`:

- Electron `^39.2.6`
- Electron Vite `^5.0.0`
- Electron Builder `^26.0.12`
- React `^19.2.1`
- React DOM `^19.2.1`
- TypeScript `^5.9.3`
- Vite `^7.2.6`
- Tailwind CSS `^4.2.4`
- `@tailwindcss/vite` `^4.2.4`
- `better-sqlite3` `^12.9.0`
- `@electron/rebuild` `^4.0.4`
- Anthropic SDK `^0.90.0`
- Google APIs `^171.4.0`
- Google Auth Library `^10.6.2`
- Recharts `^3.8.1`
- dotenv `^17.4.2`

The project uses `electron-vite`, not a custom webpack setup. The app entry is `./out/main/index.js` after build.

### Project Folder Structure Convention

Use the Electron Vite three-process layout:

- `src/main/` — Electron main process, SQLite, AI, Gmail, filesystem, Apple Mail automation, IPC handlers.
- `src/preload/` — context bridge only. No UI and no business logic.
- `src/renderer/src/` — React UI, contexts, components, hooks, renderer-only utilities.
- `src/types/` — shared TypeScript types and pure helpers usable from both main and renderer.
- `resources/` — runtime resources, credentials, and dev icon assets.
- `build/` — electron-builder resources such as `icon.icns`, `icon.png`, and entitlements.
- `scripts/` — workflow helpers such as `scripts/run-electron-vite.mjs`.

Current examples:

- `src/main/index.ts`
- `src/main/database.ts`
- `src/main/ai.ts`
- `src/preload/index.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/LeadCard.tsx`
- `src/renderer/src/context/AppContext.tsx`
- `src/types/leads.ts`

### Main / Preload / Renderer Organization

`src/main/index.ts` is the orchestration point:

- Bootstraps `.env` with `dotenv.config()`.
- Sets app identity early: `app.setName('Scoop CRM')`, `app.setAppUserModelId('com.scoopcrm.app')`.
- Pins `userData` to `app.getPath('appData')/scoop-crm` to avoid dev vs packaged database splits.
- Creates the `BrowserWindow`.
- Initializes SQLite with `initDatabase(app.getPath('userData'))`.
- Initializes AI persistence with `initAiPersistence(app.getPath('userData'))`.
- Registers all `ipcMain.handle(...)` handlers.
- Starts Gmail polling if authenticated.
- Schedules backups.

`src/preload/index.ts` exposes exactly one custom surface:

- `window.api`, typed as `LeadsAPI` from `src/types/leads.ts`.
- It maps renderer-friendly method names to IPC channel names.
- It uses `contextBridge.exposeInMainWorld('api', api)`.

`src/renderer/src/main.tsx` composes global providers:

- `AppProvider`
- `UndoStackProvider`
- `ChatProvider`
- `ThemeProvider`
- `DateFormatProvider`

`src/renderer/src/App.tsx` owns the app shell:

- Left sidebar: dark Apple-style navigation with `bg-[#1c1c1e]`.
- Main workspace: `Dashboard`, `LeadList`, or `Settings`.

### IPC Structure

IPC channels use **domain-prefixed** names: `domain:action` (e.g. `leads:update`, `dashboard:setDismissals`). The canonical registry is `**ipcMain.handle(...)` in `src/main/index.ts`**; preload mirrors those names on `window.api` in `**src/preload/index.ts**`, typed by `**LeadsAPI` in `src/types/leads.ts**`.

**Convention**

- Main: `ipcMain.handle('domain:action', ...)`.
- Preload: camelCase methods → `ipcRenderer.invoke('domain:action', ...)`.
- Renderer: `window.api.*` only — no direct `ipcRenderer` usage in UI code.
- Shared request/response types: `**src/types/leads.ts`**.

**Current handlers (grouped)** — verify against `index.ts` when adding channels:

- **Leads:** `leads:getAll`, `leads:create`, `leads:update`, `leads:delete`, `leads:applyGhosted`
- **Email draft prefs:** `emailDraft:getSystemPrompt`, `emailDraft:setSystemPrompt`
- **Follow-up:** `followup:getRules`, `followup:updateRule`, `followup:getOverdue`, `followup:draftAndOpen`
- **Mail automation:** `mail:getMessageId`, `mail:openThread`
- **Templates & taxonomy:** `templates:getAll`, `templates:getSubcategories`, `templates:upsert`, `templates:delete`, `templates:rename`, `taxonomy:listCustom`, `taxonomy:addCustom`, `taxonomy:listDeleted`, `taxonomy:delete`
- **Lead mail flows:** `lead:draftInitialReach`, `lead:openSavedInitialReachMail`, `lead:markInitialReachSent`
- **AI:** `ai:chat`, `ai:getModel`, `ai:getAvailableModels`, `ai:setModel`, `ai:startMacDictation`
- **Gmail:** `gmail:isAuthenticated`, `gmail:authenticate`, `gmail:disconnect`, `gmail:checkNow`, `gmail:setPollingInterval`, `gmail:getStatus`
- **Backup:** `backup:now`, `backup:list`, `backup:getRetention`, `backup:setRetention`
- **Dashboard UI state:** `dashboard:getDismissals`, `dashboard:setDismissals`

Example end-to-end:

- Main: `ipcMain.handle('lead:draftInitialReach', ...)` in `src/main/index.ts`.
- Preload: `draftInitialReach: (leadId) => ipcRenderer.invoke('lead:draftInitialReach', leadId)` in `src/preload/index.ts`.
- Renderer: `await window.api.draftInitialReach(lead.id)` in `src/renderer/src/components/LeadCard.tsx`.

### Database Initialization

SQLite lives in `app.getPath('userData')/crm.db`, currently pinned to:

- macOS: `~/Library/Application Support/scoop-crm/crm.db`

`src/main/database.ts` owns database lifecycle:

- Lazy-loads `better-sqlite3` with runtime `require()` via `loadBetterSqlite()`.
- Opens `DB_PATH`.
- Enables WAL: `database.pragma('journal_mode = WAL')`.
- Runs `CREATE TABLE IF NOT EXISTS`.
- Runs migration helpers.
- Seeds default rules/templates only when safe.

### Environment Variables & Credentials

Environment variables are loaded at startup:

- `src/main/index.ts` calls `dotenv.config()`.
- `src/main/ai.ts` also has `tryLoadDotEnvForAnthropic()` as a fallback for AI classification paths.

Primary env var:

- `ANTHROPIC_API_KEY`

Credentials:

- Gmail credentials are handled as files, not env strings.
- `electron-builder.yml` copies `resources/gmail-credentials.json` to packaged resources using `extraResources`.
- OAuth tokens live under `app.getPath('userData')` through `src/main/gmailAuth.ts`.

Never commit `.env`, `.env.`*, `.npmrc`, or credential files. `electron-builder.yml` already excludes `.env` patterns from packaged files.

### Native Modules

`better-sqlite3` is native and must be rebuilt for Electron, not plain Node.

Use:

```bash
npm run rebuild
```

Do not use `npm run rebuild:node` for Electron runtime. That compiles `better-sqlite3` for the host Node ABI and can break Electron with ABI mismatch.

Relevant scripts:

- `postinstall`: `electron-builder install-app-deps && electron-rebuild -f -w better-sqlite3`
- `rebuild`: `electron-rebuild -f -w better-sqlite3`
- `rebuild:node`: exists, but should not be used for app runtime.

═══════════════════════════════════════════════

## 2. DATABASE CONVENTIONS

═══════════════════════════════════════════════

### Table Creation & Migration

Database schema is defined as SQL string constants in `src/main/database.ts`:

- `CREATE_LEADS`
- `CREATE_OUTREACH_TEMPLATES`
- `CREATE_APP_META`
- `CREATE_CUSTOM_TAXONOMY_SLUGS`
- `CREATE_DELETED_TAXONOMY_SLUGS`
- `CREATE_FOLLOWUP_RULES`

Migration is additive:

- `SCHEMA_ADDITIONS` lists new `leads` columns.
- `FOLLOWUP_RULES_ADDITIONS` lists new `followup_rules` columns.
- `migrateLeadsTable(database)` checks `PRAGMA table_info(leads)` and runs missing `ALTER TABLE` statements.
- `migrateFollowupRulesTable(database)` does the same for follow-up rules.

Use migrations for:

- New nullable columns.
- New default text fields.
- JSON columns stored as text.
- Normalization passes that repair older data.

Do not rewrite the whole table unless absolutely necessary.

### Row Typing: `rowToX` Pattern

Raw SQLite rows are treated as unknown and mapped into typed domain objects.

Examples:

- `rowToLead(r: unknown): Lead`
- `mapOutreachTemplateRow(r: unknown): OutreachTemplate`

Conventions:

- Parse enums through helpers: `parseLeadStatus`, `parseTheirComsStatus`, `parseMyComsStatus`.
- Convert empty strings to `null` when the public type says nullable.
- Convert missing text to `''` when UI expects a controlled input.
- Parse JSON text fields through shared helpers such as `parseInboundReplySnapshots()` and `parseLeadContactEmails()`.
- Keep `Lead` shape in `src/types/leads.ts` as the single source of truth.

### Nullable vs Default Fields

Use `null` for absent semantic values:

- `contact_email`
- `website_url`
- `message_id`
- `their_coms_date`
- `my_coms_date`
- `follow_up_date`
- `gmail_status_undo_previous`

Use empty strings for editable text:

- `notes`
- `initial_outreach`
- `initial_outreach_subject`
- `follow_up_draft`
- prompt fields in `followup_rules`

Use JSON text columns when the data is structured but belongs to one lead:

- `contact_emails TEXT DEFAULT '[]'`
- `inbound_reply_snapshots TEXT DEFAULT '[]'`

Normalize at the boundary before saving:

- Email lists through `normalizeContactEmailsForSave()`.
- Taxonomy slugs through `normalizeSubcategory()` / `normalizeSubcategoryTag()`.
- Pipeline notes via AI normalization before calling `createLead` / `updateLead`.

### Timestamp Convention

Store timestamps as Unix seconds, not ISO strings, in database rows and IPC types.

Examples:

- `date_created`
- `date_updated`
- `date_initial_outreach`
- `last_contacted`
- `their_coms_date`
- `my_coms_date`
- `created_at`
- `updated_at`
- `receivedAt` inside `InboundReplySnapshot`

Use `Math.floor(Date.now() / 1000)` for new values.

Backup filenames are the exception: `backup-YYYY-MM-DDTHH-MM-SS.db` generated from `new Date().toISOString()` for human sorting.

### Backup Strategy

Backups are implemented in `src/main/backup.ts`:

- Directory: `app.getPath('userData')/backups`
- File pattern: `backup-*.db`
- Default retention: `7`
- Min retention: `1`
- Max retention: `50`
- Retention config: `backup-settings.json`

`runBackup()` uses `backupDatabase(dest)`, which calls the `better-sqlite3` online backup API. This avoids copying a live WAL database incorrectly.

Backups are triggered:

- Noon wall-clock schedule.
- Evening wall-clock schedule.
- Manual Settings action.
- App quit through `before-quit`, with `BACKUP_QUIT_TIMEOUT_MS = 8000` so quit cannot hang forever.

═══════════════════════════════════════════════

## 3. AI INTEGRATION PATTERN

═══════════════════════════════════════════════

### Anthropic SDK Initialization

AI lives in `src/main/ai.ts`.

The SDK client is cached:

- `let cachedClient: Anthropic | null = null`
- `getClient()` creates `new Anthropic({ apiKey })`.
- Missing `ANTHROPIC_API_KEY` throws a clear error.

Follow-up and initial-reach drafting reuse the same client through:

- `getAnthropicClientForFollowUp()`

### Swappable Model Pattern

Model state is main-process-owned:

- `currentModel`
- `persistedModelPreference`
- `cachedModels`
- `modelsLoadPromise`

Model list:

- `getAvailableModels()` calls `client.models.list({ limit: 100 })`.
- Results are cached for the app session.
- Concurrent loads share `modelsLoadPromise`.
- The active model is reconciled to an accessible model.
- Preference is persisted to `userData/model.json` via `initAiPersistence(...)`.

Model set:

- `setModelId(id)` validates against `cachedModels`.
- It returns `{ success: false, reason: 'models_not_loaded' | 'invalid_model_id' }` instead of silently persisting bad values.

### Context Passed to AI

Every chat turn gets a compact CRM snapshot.

`src/main/index.ts` builds it in `buildLeadsSummary()`:

- Pulls all categories with `getAllLeads(...)`.
- Includes totals by category and status.
- Trims large notes and drafts to control token use.
- Wraps it into `<crm_data>...</crm_data>` in `chatWithCRMInner()`.

`src/main/ai.ts` then sends:

- Prior chat history.
- Current user message.
- CRM snapshot.
- Optional image/PDF attachments as Claude content blocks.

### Tool Use / Function Calling

Tool schemas are declared in `TOOLS` inside `src/main/ai.ts`.

Current tools:

- `create_lead`
- `update_lead`
- `delete_lead`
- `list_leads`

The main process is the authority. The model proposes tool calls; `executeTool(...)` validates input and calls local database functions.

Tool loop:

- `MAX_TOOL_ROUNDS = 32`
- Each round calls `client.messages.create(...)`.
- If Claude returns `tool_use`, main executes all tool blocks and appends `tool_result`.
- If Claude returns plain text, return `{ text, dataChanged }`.
- If `stop_reason === 'max_tokens'`, throw instead of pretending success.

`MUTATING_TOOLS` controls refresh behavior:

- `create_lead`
- `update_lead`
- `delete_lead`

If any mutating tool ran, `ChatResult.dataChanged = true`, and the renderer bumps `leadsVersion`.

### Page Chat History

Renderer chat state lives in `src/renderer/src/context/ChatContext.tsx`.

State is isolated per page:

- `dashboard`
- `photo`
- `baja`
- `jobs`
- `photo-pipeline`
- `baja-pipeline`
- `jobs-pipeline`

Persisted in `localStorage` key:

- `crm_chat_store`

Each page stores:

- `messages`
- `draft`
- `height`
- `scrollTop`

`chatMessagesToTurns()` filters out pending/error messages before sending history to the model.

### AI Updates Data vs Just Responding

AI only changes data through declared tools.

Renderer flow:

- `ChatBox` sends `window.api.chat(...)`.
- Main returns `{ text, dataChanged }`.
- If `dataChanged`, renderer calls `bumpLeadsVersion()`.
- `LeadList` and `Dashboard` refetch because they depend on `leadsVersion`.

Standalone AI draft flows:

- `draftInitialReachAndOpen(...)` (`src/main/initialReachMail.ts`) calls `client.messages.create` once, opens `mailto:`, and persists `initial_outreach` + `initial_outreach_subject`.
- `draftFollowUpAndOpenMail(...)` (`src/main/followUpDraft.ts`) calls `client.messages.create` once, saves `follow_up_draft`, copies to clipboard, and opens Mail automation.
- Gmail reply classification calls `classifyReplyDisposition(...)` in `src/main/ai.ts` only for **new** matched replies: skipped when `gmailMessageId` already exists on the lead’s snapshots (dedupe) and skipped for **automated** replies classified heuristically as `robo` without an API call (`src/main/gmailLeadMatcher.ts`).

### Anthropic API surfaces (cost awareness)

There is **no global “hidden double call” layer** — each billable path is an explicit `client.messages.create` or `client.models.list`. Inventory:


| Surface                | Location                                       | Typical call pattern                                                                                                                                   |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model list             | `getAvailableModels()` in `src/main/ai.ts`     | `client.models.list({ limit: 100 })` — cached per session; also warmed on app ready in `index.ts`.                                                     |
| Assistant chat + tools | `chatWithCRMInner` loop in `src/main/ai.ts`    | Up to `MAX_TOOL_ROUNDS` (32) rounds of `client.messages.create` per user message — one API call per round that continues tool use.                     |
| Initial reach draft    | `src/main/initialReachMail.ts`                 | One `messages.create` per draft action.                                                                                                                |
| Follow-up draft        | `src/main/followUpDraft.ts`                    | One `messages.create` per draft action.                                                                                                                |
| Reply disposition      | `classifyReplyDisposition` in `src/main/ai.ts` | One `messages.create` per Gmail-matched reply that is **not** a duplicate `gmailMessageId` and **not** an automated reply (see `gmailLeadMatcher.ts`). |


**Optimization mindset:** avoid extra `getAvailableModels()`/`models.list` churn (cache is session-scoped); ensure Gmail matchers dedupe on `gmailMessageId`; keep chat summaries (`buildLeadsSummary`) lean so fewer tool rounds are needed.

═══════════════════════════════════════════════

## 4. DESIGN PHILOSOPHY

═══════════════════════════════════════════════

### Core Visual Principles

Scoop UI should feel like a dense, personal macOS productivity app:

- Apple Notes / Reminders influence.
- Quiet surfaces, not dashboard SaaS loudness.
- Rounded pills and chips.
- Subtle borders and low-contrast separators.
- Inline controls that appear where work happens.
- Dense information, but visually calm.
- Avoid heavy chrome around editable content.

The product should feel local, fast, and tactile.

### Tailwind-First Styling

All component styling should be Tailwind utility classes in `className`.

Do not add:

- CSS modules.
- styled-components.
- Sass.
- Per-component CSS files.
- Global CSS for component-specific layout.

The only CSS files should remain renderer entry/reset files:

- `src/renderer/src/assets/main.css` imports Tailwind and sets `html`, `body`, `#root`.
- `src/renderer/src/assets/base.css` contains inherited Electron starter reset tokens. New component work should not grow this file.

Use Tailwind arbitrary values for one-off exact sizing:

- `text-[11px]`
- `tracking-[0.12em]`
- `w-[220px]`
- `shadow-[0_4px_12px_rgba(0,0,0,0.12)]`

### Color Palette

Core neutrals:

- App dark sidebar: `#1c1c1e`
- Main light surface: `bg-white`
- Main dark surface: `dark:bg-zinc-950`
- Card light surface: `bg-white`
- Card dark surface: `dark:bg-zinc-900`
- Text: `text-zinc-900`, `dark:text-zinc-100`
- Muted text: `text-zinc-500`, `dark:text-zinc-400`
- Subtle border: `border-zinc-200`, `dark:border-zinc-700`

Semantic accents:

- Emerald: replies/success/confirmed (`#10b981`, Tailwind emerald)
- Amber: follow-ups/due (`#f59e0b`, `#F5A623` for initial reach)
- Sky: info/action (`#0ea5e9`)
- Red/Rose: errors/bounces/denied (`#ef4444`, Tailwind rose)
- Violet: ghosted (`#8b5cf6`)
- Zinc: neutral/no-reply/robo (`#a1a1aa`)

Status colors are centralized in `Dashboard.tsx`:

- `STATUS_COLORS.no_reply = '#a1a1aa'`
- `STATUS_COLORS.interested = '#f59e0b'`
- `STATUS_COLORS.deferred = '#0ea5e9'`
- `STATUS_COLORS.confirmed = '#10b981'`
- `STATUS_COLORS.denied = '#ef4444'`
- `STATUS_COLORS.ghosted = '#8b5cf6'`

Slug/tag colors use deterministic hashing in `src/renderer/src/lib/subcategoryColors.ts`:

- fallback neutral: `#a1a1aa`
- hash output: `hsl(${hue} ${sat}% ${light}%)`
- local overrides stored in `crm_label_hex_overrides_v1`

### Typography Scale

Typography is dense and precise:

- App nav: `text-[15px] font-medium`
- App title: `text-[11px] font-medium uppercase tracking-[0.12em]`
- Lead-card micro labels: `text-[10px] font-medium uppercase tracking-wide`
- Lead-card details: `text-[13px] leading-relaxed`
- Chips/buttons: `text-[11px]` or `text-[12px]`
- Notes: `NOTE_FONT_PX = 15`, line-height `NOTE_LINE_UNIT = 1.8`
- Dashboard section headers: `text-sm font-semibold`
- Dashboard title: `text-2xl font-semibold tracking-tight`

Use font weights sparingly:

- `font-medium` for controls/labels.
- `font-semibold` for page and card headings.
- Avoid heavy `font-bold` except numeric notification counts.

### Spacing & Radius

Common spacing:

- Sidebar width: `w-[220px]`
- Sidebar nav gap: `gap-0.5`
- Page padding: `px-8 py-8`
- Card padding: `p-4` or `px-3 py-2`
- Chip padding: `px-2.5 py-1`
- Icon hit targets: `h-6 w-6`, `h-7 w-7`, or `h-8 w-8`

Radius:

- Pills: `rounded-full`
- Small controls: `rounded-md`
- Menus/popovers/cards: `rounded-lg` or `rounded-xl`

### Shadows & Borders

Use minimal shadows:

- `shadow-sm` for cards.
- `shadow-md` or `shadow-xl` only for floating overlays.
- Custom menu shadow: `shadow-[0_4px_12px_rgba(0,0,0,0.12)]`.

Borders:

- Prefer `border-zinc-200/80`, `dark:border-zinc-700`.
- Use rings for chips: `ring-1 ring-inset`.
- Do not box editable text areas unless the entire mode family uses the same treatment.

### Animation & Transition Standards

Default interactions:

- `transition-colors`
- `duration-150`
- `ease-out`

Examples:

- Sidebar nav: `transition-[background-color,color] duration-150 ease-out`
- Hover labels: `transition-opacity duration-150`
- Buttons: `transition-colors`

Use subtle physical feedback:

- `active:scale-[0.97]` for small pill controls when useful.
- Avoid bouncy animations.

═══════════════════════════════════════════════

## 5. COMPONENT PATTERNS

═══════════════════════════════════════════════

### One Component Per File Rule

Preferred rule for a new Scoop app:

- One primary exported component per file.
- Small local helper components are acceptable when they are private and tightly coupled.
- Reusable UI primitives should be extracted early.

Current code has historical large files such as `LeadCard.tsx`; treat that as a warning, not a model to copy. For new apps, split complex flows into local components before a file becomes a “god component.”

### Inline Editing

Inline edit is the default. Avoid separate edit screens.

Pattern:

- Use `useInlineEdit()` from `src/renderer/src/hooks/useInlineEdit.ts`.
- Double-click or explicit small edit affordance enters edit mode.
- Local draft state mirrors the persisted value.
- Commit on Enter/blur.
- Escape cancels where practical.

Fields should look like text until active:

- `border-0`
- `bg-transparent`
- `p-0`
- `outline-none`
- `focus:ring-0`

### Dropdowns

Do not use native `<select>` for product UI.

Dropdowns are custom menus:

- Buttons toggle local `open` state.
- Menus use `absolute` or `fixed`.
- Portals are used for context menus / popovers when necessary.
- `useClickOutside()` handles dismissal.
- Menu rows are buttons with `type="button"`.

Shared menu style in `LeadCard.tsx`:

- `absolute z-50 min-w-[160px] rounded-lg border border-zinc-200/80 bg-white p-1 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900`

Context menus use right-click with `onContextMenu`.

### Debounced Saves

Debounced edit saves should:

- Keep a draft in local state.
- Schedule persistence with `setTimeout`.
- Clear existing timers before scheduling a new one.
- Flush on unmount if data changed.
- Track latest values in refs to avoid stale cleanup closures.

`BulletNotes.tsx` is the canonical pattern:

- `saveTimer`
- `latestDraftRef`
- `lastPersistedDraftRef`
- `latestLeadIdRef`
- `latestOnUpdateRef`
- `schedulePersist(...)`
- cleanup effect flushes pending notes.

### Toast / Flash Confirmations

Prefer tiny inline feedback over global toasts.

Examples:

- `BulletNotes.tsx`: `savedFlash` shows a small `Saved` label for one second.
- Lead card copy flows use `setTimeout` to show copied/draft info briefly.
- Follow-up draft flow shows an inline status block: “Draft copied to clipboard…”

Use local state and short timeouts, not a global toast bus unless the app needs cross-page notifications.

### Loading States

Loading is local and restrained:

- `isLoading` and `error` state in page components.
- Count placeholders use `…`.
- Skeletons are simple text/empty states, not complex shimmer systems.
- Disable buttons while async operations are in flight.

Examples:

- `LeadList.tsx`: `isLoading`, `error`.
- `Dashboard.tsx`: `overdueLoading`, `isLoading`.
- `LeadCard.tsx`: `initialReachBusy`, `followUpMailBusy`, `pipelineSentBusy`.

### Error States

Surface errors inline near the action:

- Small text: `text-[11px] text-red-600 dark:text-red-400`.
- Alert role when appropriate: `role="alert"`.
- Keep the failed action area visible.
- Do not use modal error dialogs for routine failures.

Examples:

- `initialReachErr` near the Draft Initial Reach button.
- `followUpMailErr` near the Follow-up button.
- Dashboard section errors inline under the section header.

### Forms

Prefer explicit `button type="button"` and `onClick` handlers for micro-interactions.

Use `<form>` only where submit behavior is actually useful:

- Chat composer is a reasonable form because Enter submits.

For settings and lead-card editing, avoid browser form behavior:

- No accidental page submit.
- No native validation UI unless it is deliberately wanted.
- Use controlled inputs and explicit commit handlers.

═══════════════════════════════════════════════

## 6. INTERACTION ETHOS

═══════════════════════════════════════════════

### Seamless Editing

Editing should feel like touching the data directly.

Rules:

- No separate edit pages.
- No “save mode” for an entire lead card.
- Inputs should preserve layout.
- Updates should be optimistic where safe.
- The user should be able to make small corrections quickly.

### Confirmations

Prefer inline confirmation over modals.

Pattern:

- User chooses destructive action.
- The menu row swaps to `delete` / `cancel`.
- No header or extra explanatory chrome unless the action is ambiguous.

`LabelColorEditor.tsx` implements this for category/tag deletion:

- `confirmingDelete`
- `delete`
- `cancel`

Use modals only for high-impact lead deletion or flows where context would otherwise be lost.

### Responsiveness

Every user action needs immediate feedback:

- Button disabled during async work.
- Label changes to `Drafting…`, `Saving…`, `Linking thread…`.
- Copy actions show a short visual confirmation.
- Data-mutating actions call `bumpLeadsVersion()` or trigger `leads:dataMutated`.

### Keyboard Standards

Keyboard behavior should be predictable:

- Enter commits inline edits.
- Escape cancels or exits focused modes.
- Cmd/Ctrl+Z triggers app undo only when no input/textarea/select/contenteditable is focused.
- Cmd/Ctrl +/- / 0 controls app text scale, not Chromium zoom.
- Tab in notes indents/outdents line levels.

Main process intercepts zoom keys in `before-input-event`; renderer has a fallback in `AppContext.tsx`.

### Navigation

Navigation is context switching, not routing.

`AppContext` owns:

- `activeNav`
- `setActiveNav`
- `pendingLeadFocus`
- `navigateToLeadFocus(...)`
- `leadsVersion`

Dashboard notifications can jump into a lead list and focus a specific card without URL routing.

`pendingLeadFocus` includes:

- `leadId`
- `category`
- `nonce`
- optional `openContactEmailEditor`

═══════════════════════════════════════════════

## 7. CONTEXT & STATE PATTERNS

═══════════════════════════════════════════════

### React Context vs Local State

Use React context only for cross-cutting app concerns:

- `AppContext`: nav, lead refresh version, pending lead focus, text scale, shared attachments.
- `ChatContext`: per-page chat messages/drafts/heights/scroll.
- `ThemeContext`: theme mode and document `.dark` class.
- `DateFormatContext`: absolute/relative date formatting.
- `UndoStackContext`: global undo stack.

Use local component state for:

- Menus/dropdowns.
- Inline edit drafts.
- Busy/error flags.
- Hover/flash affordances.
- Temporary context menu coordinates.

### localStorage Persistence

Use `localStorage` for UI preferences and non-critical client-side state:

- `crm_theme`
- `crm_date_format`
- `crm_chat_store`
- `scoop_crm_text_scale_v1`
- `scoop_crm_lead_list_ui_v1_${category}`
- `crm_label_hex_overrides_v1`
- `crm_subcategory_color_aliases_v1`
- `scoop_crm_ghost_bar_dismissed_v1` style keys in small UI libs

Do not use `localStorage` as the only durable source for business-critical data or notifications that must survive dev profile changes.

Recent fix: dashboard dismissal state now persists through main process into `dashboard-dismissals.json` under `userData`, exposed through:

- `window.api.getDashboardDismissals()`
- `window.api.setDashboardDismissals(...)`

### SQLite Persistence

Use SQLite for actual product data:

- Leads.
- Follow-up rules.
- Outreach templates.
- AI email draft system prompt.
- Custom/deleted taxonomy slugs.

SQLite is the source of truth. Renderer state is a cache or view preference.

### File Persistence in userData

Use `app.getPath('userData')` for app operational state:

- `crm.db`
- `backups/backup-*.db`
- `backup-settings.json`
- `model.json`
- `gmail-token.json`
- `gmail-poll-state.json`
- `dashboard-dismissals.json`

Pin `userData` early when app name/product name differs across dev/packaged builds.

### Page-Level State Isolation

Per-page state uses keyed maps:

- Chat page IDs in `ChatContext`.
- Lead-list UI per category in `leadListUiStorage.ts`.
- Pipeline vs Active UI stored separately inside `CategoryLeadListUiPersisted`.

Do not let a filter/search/sort from Photo bleed into Baja or Jobs.

### Cross-Page Communication

Use `AppContext` and main-process notifications:

- Renderer mutation paths call `bumpLeadsVersion()`.
- Main process sends `leads:dataMutated` when Gmail polling updates leads.
- `AppProvider` subscribes via `window.api.onLeadsDataMutated(...)`.
- Lists and Dashboard refetch when `leadsVersion` changes.

═══════════════════════════════════════════════

## 8. WHAT WE EXPLICITLY AVOID

═══════════════════════════════════════════════

Avoid these patterns:

- Native `<select>` controls for core UI.
- Heavy modals for simple confirmations.
- Component-specific CSS files.
- CSS modules or styled-components.
- Separate edit pages for simple record editing.
- Persisting important business data only in renderer `localStorage`.
- Unbounded AI tool loops.
- Hidden duplicate AI calls from overlapping pollers.
- Storing literal bullets in notes.
- Adding compatibility shims for unfinished branch behavior.
- Re-inserting default rows after the user deletes them.
- Raw string parsing when structured JSON/helpers exist.
- Copying live SQLite DB files directly instead of using the backup API.
- Running `npm run rebuild:node` for Electron native modules.

### Bugs / Complexity We Learned From

1. **Dev vs packaged `userData` split**
  Product name changed the folder from `scoop-crm` to `Scoop CRM`, making data appear missing. Fix: pin `app.setPath('userData', join(app.getPath('appData'), 'scoop-crm'))`.
2. **Dashboard dismissed notifications resurrecting**
  Renderer localStorage and pruning based on temporary empty data caused old notifications to reappear. Fix: durable main-process state in `dashboard-dismissals.json`; do not prune dismissal records just because current candidate data is empty.
3. **Bullet notes save loss**
  Debounced saves can lose edits on unmount. Fix: refs for latest draft and flush cleanup.
4. **Backup quit hang**
  `before-quit` with `event.preventDefault()` can freeze quit forever if backup hangs. Fix: `Promise.race` with `BACKUP_QUIT_TIMEOUT_MS = 8000`.
5. **AI model set before cache loaded**
  Persisting arbitrary model IDs before `models.list()` loaded created invalid state. Fix: structured `SetModelIdResult`.
6. **Duplicate reply notes**
  Gmail replies must dedupe on `gmailMessageId`, not just date/snippet.
7. **Reply row identity**
  Visible notes should be human-readable; unique email identity belongs in `inbound_reply_snapshots` (`receivedAt`, `gmailMessageId`, `fromEmail`), not visible `@timestamp` text.
8. **Pipeline subcategory drift**
  Tags, templates, lead dropdowns, and color overrides must use normalized slugs and shared storage keys.
9. **Native module ABI mismatch**
  Plain Node rebuilds do not work for Electron. Always rebuild against Electron.

═══════════════════════════════════════════════

## 9. DEVELOPMENT WORKFLOW

═══════════════════════════════════════════════

### Scripts

Core scripts:

- `npm run dev` — run Electron Vite dev.
- `npm run start` — preview built app.
- `npm run build` — `npm run typecheck && electron-vite build`.
- `npm run typecheck` — node + web TypeScript checks.
- `npm run lint` — ESLint.
- `npm run test:data` — data/domain tests.
- `npm run rebuild` — rebuild `better-sqlite3` for Electron.
- `npm run build:mac` — Electron Vite build + mac electron-builder.

### Typecheck Before Commits

Run:

```bash
npm run typecheck
```

For data/domain changes, also run:

```bash
npm run test:data
```

The repo has split TS configs:

- `tsconfig.node.json` for `src/main`, `src/preload`, and `src/types`.
- `tsconfig.web.json` for renderer and shared types.

### Git Commit Style

Recent commit styles include:

- `fix: BulletNotes flush on unmount, backup quit timeout, clamp negative follow-up days, guard setModelId before cache`
- `feat: automatic + manual DB backups — noon/8pm schedule, on-quit, 7-file rotation, Settings UI`
- `feat(ui): edit initial outreach in panel; tweak add-lead + and color picker`
- Some historical commits are looser (`Fix lead card category menus`), but prefer conventional `fix:` / `feat:` prefixes going forward.

Commit messages should be concise and describe the user-facing reason.

### Native Rebuild Workflow

After installing dependencies or changing Electron/native module versions:

```bash
npm run rebuild
```

Do not use:

```bash
npm run rebuild:node
```

unless you intentionally need a plain Node ABI build for a non-Electron script.

### Node Version

There is currently no `.nvmrc`. The repo uses `@types/node ^22.19.1`, while local machines may run newer Node. For a new Scoop app:

- Add `.nvmrc` to pin a known-good Node major.
- Keep Node aligned with Electron tooling.
- Remember that Electron has its own embedded Node ABI; native modules still need Electron rebuild.

### Cursor Agent vs Chat Mode

Use Cursor Agent when:

- Editing files.
- Running typecheck/lint/tests.
- Tracing IPC or database flows.
- Refactoring shared types.
- Investigating bugs with code evidence.

Use Chat/Ask mode when:

- Discussing product behavior.
- Comparing approaches.
- Writing plans or reviewing tradeoffs.
- Asking cost/architecture questions before implementation.

For code changes:

- Inspect existing patterns first.
- Keep changes scoped.
- Avoid reverting unrelated dirty files.
- Run at least `npm run typecheck` after substantive TypeScript changes.

═══════════════════════════════════════════════

## 10. SCOOP DESIGN LANGUAGE

═══════════════════════════════════════════════

### What Makes a Scoop App Feel Like Scoop

A Scoop app is a personal operating surface:

- Local-first.
- Dense but calm.
- Fast to edit.
- Minimal chrome.
- Human-readable data.
- Strong defaults.
- No unnecessary ceremony.
- AI helps with work, but local data remains the source of truth.

It should feel closer to Apple Notes + Reminders + a lightweight CRM than to a SaaS dashboard.

### Product-Family UI Decisions

Shared decisions:

- Dark compact sidebar with rounded pill nav.
- White/zinc workspace.
- Rounded cards, subtle borders, light shadows.
- Tiny uppercase labels for metadata.
- Chips for state/category/tag.
- Custom dropdowns and context menus.
- Inline editing everywhere.
- No bulky scrollbars; minimal thumb-only scrollbar styling where needed.
- Notes render as bullet-like lines, but stored data remains plain text.
- AI assistant is docked and page-aware.
- Dashboard notifications are compact and dismissible.

### How New Features Should Feel

Before building, ask:

- Can this be edited inline?
- Can this use an existing chip/menu/card pattern?
- Can this avoid a modal?
- Can this persist the minimum necessary durable state?
- Can the UI respond instantly before deeper work completes?
- Does the data model stay simple enough to inspect in SQLite?
- Does the AI action clearly indicate when it spends API calls?

New features should be small, composable interactions rather than big mode switches.

### Good Enough vs Needs Polish

Good enough:

- Typecheck passes.
- No obvious duplicate persistence path.
- Data survives restart.
- Errors are visible near the action.
- UI matches existing spacing/type/color patterns.
- It works in dev and packaged assumptions are known.

Needs polish:

- Extra borders/backgrounds make one mode feel different from another.
- Repeated notifications or resurrected state.
- Hidden API calls or unbounded loops.
- Unclear busy states.
- Native browser controls where custom app controls are expected.
- Text overflows or scroll traps interrupt page navigation.
- User data can appear missing because of path/profile drift.

### Final Principle

Scoop apps should be boring in their foundations and warm in their interactions: local data, typed boundaries, predictable persistence, restrained visuals, and tiny UX details that make the app feel like it belongs on the user’s Mac.