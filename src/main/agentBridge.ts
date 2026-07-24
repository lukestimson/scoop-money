import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import {
  createAccount,
  createBudgetItem,
  createBudgetLineItem,
  createCategoryRule,
  createExpectedIncomeEntry,
  createIncomeEntry,
  createTransaction,
  backupDatabase,
  deleteAccount,
  deleteBudgetItem,
  deleteBudgetLineItem,
  deleteCategoryRule,
  deleteExpectedIncomeEntry,
  deleteIncomeEntry,
  deleteTransaction,
  getAllAccounts,
  getAllBudgetItems,
  getAllBudgetLineItems,
  getAllCategoryRules,
  getAllExpectedIncomeEntries,
  getAllIncomeEntries,
  getAllTransactions,
  getDatabasePath,
  getIncomeTaxSettings,
  getLivingExpensesSettings,
  recategorizeAllTransactions,
  restoreDatabase,
  updateAccount,
  updateBudgetItem,
  updateBudgetLineItem,
  updateCategoryRule,
  updateExpectedIncomeEntry,
  updateIncomeEntry,
  updateIncomeTaxSettings,
  updateLivingExpensesSettings,
  updateTransaction
} from './database'
import { getBackupRetention, listBackups, runBackup, setBackupRetention } from './backup'
import {
  AGENT_BRIDGE_VERSION,
  createAgentRpcDispatcher,
  type AgentRpcParams
} from './agentBridgeCore'
import type {
  Account,
  BudgetItem,
  BudgetLineItem,
  CategoryMappingRule,
  ExpectedIncomeEntry,
  IncomeEntry,
  IncomeTaxSettings,
  LivingExpensesSettings,
  Transaction
} from '../types/money'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 43874
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MANIFEST_FILENAME = 'agent-bridge.json'
const UNDO_DB_FILENAME = 'money-agent-undo.db'

type JsonRecord = Record<string, unknown>

interface AgentBridgeManifest {
  name: string
  version: number
  pid: number
  host: string
  port: number
  baseUrl: string
  rpcUrl: string
  healthUrl: string
  token: string
  startedAt: string
  dbPath: string
  methodsHint: string
}

interface JsonRpcRequest {
  id?: unknown
  method?: unknown
  params?: AgentRpcParams
}

let bridgeServer: ReturnType<typeof createServer> | null = null

function manifestPath(userDataDir: string): string {
  return join(userDataDir, MANIFEST_FILENAME)
}

function undoDbPath(userDataDir: string): string {
  return join(userDataDir, UNDO_DB_FILENAME)
}

function bridgeEnabled(): boolean {
  const value = process.env.SCOOP_MONEY_AGENT_BRIDGE
  return value == null || !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase())
}

function preferredPort(): number {
  const value = Number(process.env.SCOOP_MONEY_AGENT_PORT ?? DEFAULT_PORT)
  return Number.isInteger(value) && value >= 0 && value <= 65535 ? value : DEFAULT_PORT
}

function asRecord(params: AgentRpcParams): JsonRecord {
  return params && typeof params === 'object' && !Array.isArray(params)
    ? (params as JsonRecord)
    : {}
}

function nestedOrTopLevel(params: AgentRpcParams, key: string): JsonRecord {
  const record = asRecord(params)
  const nested = record[key]
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? (nested as JsonRecord)
    : record
}

function requiredId(record: JsonRecord): number {
  const id = Number(record.id)
  if (!Number.isInteger(id) || id <= 0) throw new Error('id must be a positive integer.')
  return id
}

function requiredNumber(record: JsonRecord, key: string): number {
  const value = Number(record[key])
  if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number.`)
  return value
}

function requireNonEmptyString(record: JsonRecord, key: string): string {
  const value = typeof record[key] === 'string' ? record[key].trim() : ''
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function pick(record: JsonRecord, keys: string[]): JsonRecord {
  return Object.fromEntries(
    keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])
  )
}

function patchFromParams(
  params: AgentRpcParams,
  keys: string[]
): { id: number; patch: JsonRecord } {
  const record = asRecord(params)
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as JsonRecord)
      : record
  const patch = pick(data, keys)
  if (Object.keys(patch).length === 0) throw new Error('At least one writable field is required.')
  return { id: requiredId(record), patch }
}

const TRANSACTION_KEYS = [
  'date',
  'description',
  'amount',
  'raw_category',
  'mapped_category',
  'account_id',
  'source',
  'notes',
  'income_candidate',
  'external_id'
]
const INCOME_KEYS = ['shoot_name', 'company', 'income_type', 'date', 'amount', 'tip', 'notes']
const EXPECTED_INCOME_KEYS = ['name', 'notes', 'annual_amount', 'income_kind']
const ACCOUNT_KEYS = ['name', 'type', 'institution', 'color']
const BUDGET_KEYS = [
  'category',
  'is_need',
  'amount_standard',
  'amount_with_aid',
  'amount_with_parents'
]
const BUDGET_LINE_KEYS = [
  'source_sheet',
  'source_row',
  'section',
  'label',
  'category',
  'monthly_amount',
  'annual_amount',
  'notes',
  'support_scope',
  'is_need'
]
const RULE_KEYS = ['raw_category', 'description_contains', 'mapped_category', 'priority']
const TAX_KEYS = [
  'filing_status',
  'retirement_contribution',
  'above_line_deductions',
  'federal_standard_deduction',
  'ca_standard_deduction',
  'ca_bracket_adjustment',
  'social_security_wage_base'
]
const LIVING_EXPENSES_KEYS = ['rent_ratio_target_x100', 'reserve_target_months']

function validateTransaction(input: JsonRecord, create: boolean): Partial<Transaction> {
  if (create) {
    requireNonEmptyString(input, 'description')
    requiredNumber(input, 'amount')
  }
  const data = pick(input, TRANSACTION_KEYS)
  if ('amount' in data) data.amount = Math.round(requiredNumber(data, 'amount'))
  if ('date' in data) data.date = Math.round(requiredNumber(data, 'date'))
  if ('account_id' in data && data.account_id !== null)
    data.account_id = requiredId({ id: data.account_id })
  if (
    'source' in data &&
    data.source !== 'manual' &&
    data.source !== 'ai' &&
    data.source !== 'csv_import' &&
    data.source !== 'plaid'
  ) {
    throw new Error('source must be manual, ai, csv_import, or plaid.')
  }
  if (create && !('source' in data)) data.source = 'ai'
  return data as Partial<Transaction>
}

function validateIncome(input: JsonRecord, create: boolean): Partial<IncomeEntry> {
  if (create) {
    requireNonEmptyString(input, 'shoot_name')
    requiredNumber(input, 'amount')
  }
  const data = pick(input, INCOME_KEYS)
  for (const key of ['amount', 'tip', 'date']) {
    if (key in data && data[key] !== null) data[key] = Math.round(requiredNumber(data, key))
  }
  return data as Partial<IncomeEntry>
}

function validateExpectedIncome(input: JsonRecord): Partial<ExpectedIncomeEntry> {
  const data = pick(input, EXPECTED_INCOME_KEYS)
  if ('annual_amount' in data)
    data.annual_amount = Math.round(requiredNumber(data, 'annual_amount'))
  if (
    'income_kind' in data &&
    !['w2', 'self_employment', 'other'].includes(String(data.income_kind))
  ) {
    throw new Error('income_kind must be w2, self_employment, or other.')
  }
  return data as Partial<ExpectedIncomeEntry>
}

function createAgentMethods(
  userDataDir: string
): Record<string, (params: AgentRpcParams) => unknown | Promise<unknown>> {
  return {
    'agent.status': () => ({
      bridgeVersion: AGENT_BRIDGE_VERSION,
      dbPath: getDatabasePath(),
      userDataDir,
      undoDbPath: undoDbPath(userDataDir),
      manifestPath: manifestPath(userDataDir),
      counts: {
        transactions: getAllTransactions().length,
        income: getAllIncomeEntries().length,
        expectedIncome: getAllExpectedIncomeEntries().length,
        accounts: getAllAccounts().length,
        budgetItems: getAllBudgetItems().length,
        budgetLines: getAllBudgetLineItems().length
      }
    }),
    'agent.undoLastWrite': () => {
      const path = undoDbPath(userDataDir)
      if (!existsSync(path)) return { success: false, reason: 'No agent undo snapshot found.' }
      restoreDatabase(path)
      return { success: true, restoredFrom: path }
    },
    'transactions.list': (params) => {
      const record = asRecord(params)
      return getAllTransactions({
        accountId: record.accountId == null ? undefined : requiredId({ id: record.accountId }),
        category: typeof record.category === 'string' ? record.category : undefined,
        source:
          record.source === 'manual' ||
          record.source === 'ai' ||
          record.source === 'csv_import' ||
          record.source === 'plaid'
            ? record.source
            : undefined,
        start: record.start == null ? undefined : Math.round(requiredNumber(record, 'start')),
        end: record.end == null ? undefined : Math.round(requiredNumber(record, 'end'))
      })
    },
    'transactions.create': (params) =>
      createTransaction(validateTransaction(nestedOrTopLevel(params, 'transaction'), true)),
    'transactions.bulkCreate': (params) => {
      const transactions = asRecord(params).transactions
      if (!Array.isArray(transactions)) throw new Error('transactions must be an array.')
      const created = transactions.map((transaction) => {
        if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction))
          throw new Error('Each transaction must be an object.')
        return createTransaction(validateTransaction(transaction as JsonRecord, true))
      })
      return { createdCount: created.length, transactions: created }
    },
    'transactions.update': (params) => {
      const { id, patch } = patchFromParams(params, TRANSACTION_KEYS)
      return updateTransaction(id, validateTransaction(patch, false))
    },
    'transactions.delete': (params) => {
      const id = requiredId(asRecord(params))
      deleteTransaction(id)
      return { deleted: true, id }
    },
    'income.list': () => getAllIncomeEntries(),
    'income.create': (params) =>
      createIncomeEntry(validateIncome(nestedOrTopLevel(params, 'income'), true)),
    'income.bulkCreate': (params) => {
      const entries = asRecord(params).entries
      if (!Array.isArray(entries)) throw new Error('entries must be an array.')
      const created = entries.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          throw new Error('Each income entry must be an object.')
        return createIncomeEntry(validateIncome(entry as JsonRecord, true))
      })
      return { createdCount: created.length, entries: created }
    },
    'income.update': (params) => {
      const { id, patch } = patchFromParams(params, INCOME_KEYS)
      return updateIncomeEntry(id, validateIncome(patch, false))
    },
    'income.delete': (params) => {
      const id = requiredId(asRecord(params))
      deleteIncomeEntry(id)
      return { deleted: true, id }
    },
    'incomeExpected.list': () => getAllExpectedIncomeEntries(),
    'incomeExpected.create': (params) =>
      createExpectedIncomeEntry(validateExpectedIncome(nestedOrTopLevel(params, 'entry'))),
    'incomeExpected.update': (params) => {
      const { id, patch } = patchFromParams(params, EXPECTED_INCOME_KEYS)
      return updateExpectedIncomeEntry(id, validateExpectedIncome(patch))
    },
    'incomeExpected.delete': (params) => {
      const id = requiredId(asRecord(params))
      deleteExpectedIncomeEntry(id)
      return { deleted: true, id }
    },
    'accounts.list': () => getAllAccounts(),
    'accounts.create': (params) =>
      createAccount(pick(nestedOrTopLevel(params, 'account'), ACCOUNT_KEYS) as Partial<Account>),
    'accounts.update': (params) => {
      const { id, patch } = patchFromParams(params, ACCOUNT_KEYS)
      return updateAccount(id, patch as Partial<Account>)
    },
    'accounts.delete': (params) => {
      const id = requiredId(asRecord(params))
      deleteAccount(id)
      return { deleted: true, id }
    },
    'budget.list': () => getAllBudgetItems(),
    'budget.create': (params) =>
      createBudgetItem(pick(nestedOrTopLevel(params, 'item'), BUDGET_KEYS) as Partial<BudgetItem>),
    'budget.update': (params) => {
      const { id, patch } = patchFromParams(params, BUDGET_KEYS)
      return updateBudgetItem(id, patch as Partial<BudgetItem>)
    },
    'budget.delete': (params) => {
      const id = requiredId(asRecord(params))
      deleteBudgetItem(id)
      return { deleted: true, id }
    },
    'budgetLines.list': () => getAllBudgetLineItems(),
    'budgetLines.create': (params) =>
      createBudgetLineItem(
        pick(nestedOrTopLevel(params, 'item'), BUDGET_LINE_KEYS) as Partial<BudgetLineItem>
      ),
    'budgetLines.update': (params) => {
      const { id, patch } = patchFromParams(params, BUDGET_LINE_KEYS)
      return updateBudgetLineItem(id, patch as Partial<BudgetLineItem>)
    },
    'budgetLines.delete': (params) => {
      const id = requiredId(asRecord(params))
      deleteBudgetLineItem(id)
      return { deleted: true, id }
    },
    'rules.list': () => getAllCategoryRules(),
    'rules.create': (params) =>
      createCategoryRule(
        pick(nestedOrTopLevel(params, 'rule'), RULE_KEYS) as Partial<CategoryMappingRule>
      ),
    'rules.update': (params) => {
      const { id, patch } = patchFromParams(params, RULE_KEYS)
      return updateCategoryRule(id, patch as Partial<CategoryMappingRule>)
    },
    'rules.delete': (params) => {
      const id = requiredId(asRecord(params))
      deleteCategoryRule(id)
      return { deleted: true, id }
    },
    'rules.recategorizeAll': () => recategorizeAllTransactions(),
    'settings.incomeTax.get': () => getIncomeTaxSettings(),
    'settings.incomeTax.update': (params) =>
      updateIncomeTaxSettings(
        pick(nestedOrTopLevel(params, 'data'), TAX_KEYS) as Partial<IncomeTaxSettings>
      ),
    'settings.livingExpenses.get': () => getLivingExpensesSettings(),
    'settings.livingExpenses.update': (params) =>
      updateLivingExpensesSettings(
        pick(
          nestedOrTopLevel(params, 'data'),
          LIVING_EXPENSES_KEYS
        ) as Partial<LivingExpensesSettings>
      ),
    'backup.now': async () => runBackup(),
    'backup.list': () => listBackups(),
    'backup.retention.get': () => getBackupRetention(),
    'backup.retention.set': (params) =>
      setBackupRetention(requiredNumber(asRecord(params), 'maxFiles'))
  }
}

function getBridgeToken(userDataDir: string): string {
  const fromEnvironment = process.env.SCOOP_MONEY_AGENT_TOKEN?.trim()
  if (fromEnvironment) return fromEnvironment
  try {
    const existing = JSON.parse(readFileSync(manifestPath(userDataDir), 'utf8')) as {
      token?: unknown
    }
    if (typeof existing.token === 'string' && existing.token.length >= 24) return existing.token
  } catch {
    /* first launch */
  }
  return randomBytes(32).toString('base64url')
}

function writeManifest(userDataDir: string, port: number, token: string): AgentBridgeManifest {
  mkdirSync(userDataDir, { recursive: true })
  const baseUrl = `http://${HOST}:${port}`
  const manifest: AgentBridgeManifest = {
    name: 'Scoop Money Agent Bridge',
    version: AGENT_BRIDGE_VERSION,
    pid: process.pid,
    host: HOST,
    port,
    baseUrl,
    rpcUrl: `${baseUrl}/rpc`,
    healthUrl: `${baseUrl}/health`,
    token,
    startedAt: new Date().toISOString(),
    dbPath: getDatabasePath(),
    methodsHint: 'Call agent.describe over /rpc for the full schema and method catalog.'
  }
  const path = manifestPath(userDataDir)
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8')
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best effort */
  }
  return manifest
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function tokenMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function authorized(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization
  const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const header = req.headers['x-scoop-money-agent-token']
  const explicit = Array.isArray(header) ? header[0] : header
  return tokenMatches(bearer, token) || tokenMatches(String(explicit ?? ''), token)
}

function readRequestJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw.trim() ? JSON.parse(raw) : null)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function rpcError(id: unknown, code: number, message: string): JsonRecord {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function handleRpc(
  payload: unknown,
  dispatch: (method: string, params?: AgentRpcParams) => Promise<unknown>
): Promise<JsonRecord> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return rpcError(null, -32600, 'Invalid JSON-RPC request object.')
  const request = payload as JsonRpcRequest
  const id = request.id ?? null
  if (typeof request.method !== 'string' || !request.method.trim())
    return rpcError(id, -32600, 'JSON-RPC method is required.')
  try {
    return {
      jsonrpc: '2.0',
      id,
      result: await dispatch(request.method.trim(), request.params)
    }
  } catch (error) {
    return rpcError(id, -32000, error instanceof Error ? error.message : String(error))
  }
}

export function startAgentBridge(userDataDir: string, notifyRendererDataMutated: () => void): void {
  if (!bridgeEnabled()) {
    console.log('[agent] Scoop Money bridge disabled by SCOOP_MONEY_AGENT_BRIDGE')
    return
  }
  if (bridgeServer) return
  const token = getBridgeToken(userDataDir)
  const dispatch = createAgentRpcDispatcher({
    methods: createAgentMethods(userDataDir),
    backupBeforeWrite: async () => backupDatabase(undoDbPath(userDataDir)),
    onMutated: () => notifyRendererDataMutated()
  })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Cache-Control': 'no-store' })
      res.end()
      return
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      writeJson(res, 200, {
        ok: true,
        name: 'Scoop Money Agent Bridge',
        version: AGENT_BRIDGE_VERSION,
        auth: 'required for /rpc',
        rpcPath: '/rpc'
      })
      return
    }
    if (url.pathname !== '/rpc') {
      writeJson(res, 404, { error: 'Not found.' })
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'Use POST /rpc.' })
      return
    }
    if (!authorized(req, token)) {
      writeJson(res, 401, { error: 'Unauthorized.' })
      return
    }
    try {
      const payload = await readRequestJson(req)
      const response = Array.isArray(payload)
        ? await Promise.all(payload.map((item) => handleRpc(item, dispatch)))
        : await handleRpc(payload, dispatch)
      writeJson(res, 200, response)
    } catch (error) {
      writeJson(res, 400, {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
  bridgeServer = server
  let fallbackUsed = false
  const listen = (port: number): void => {
    server.listen(port, HOST, () => {
      const actualPort = (server.address() as AddressInfo | null)?.port ?? port
      const manifest = writeManifest(userDataDir, actualPort, token)
      console.log(`[agent] Scoop Money bridge listening at ${manifest.rpcUrl}`)
    })
  }
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && !fallbackUsed) {
      fallbackUsed = true
      console.warn(`[agent] port ${preferredPort()} is in use; using a random local port`)
      listen(0)
      return
    }
    bridgeServer = null
    console.error('[agent] Scoop Money bridge failed:', error)
  })
  listen(preferredPort())
}
