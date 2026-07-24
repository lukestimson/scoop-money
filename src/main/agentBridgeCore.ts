export type AgentRpcParams = Record<string, unknown> | unknown[] | null | undefined

export interface AgentMethodDescriptor {
  method: string
  description: string
  mutates: boolean
  backupBeforeWrite?: boolean
  params: Record<string, string>
}

export interface AgentRpcServices {
  methods: Record<string, (params: AgentRpcParams) => unknown | Promise<unknown>>
  backupBeforeWrite?: (method: string, params: AgentRpcParams) => void | Promise<void>
  onMutated?: (method: string, result: unknown) => void | Promise<void>
}

export const AGENT_BRIDGE_VERSION = 1

const CENTS_NOTE = 'All currency fields are integer cents. Dates are Unix seconds.'

export const AGENT_METHODS: AgentMethodDescriptor[] = [
  {
    method: 'agent.describe',
    description: 'Return the full method catalog and money-record schemas.',
    mutates: false,
    params: {}
  },
  {
    method: 'agent.status',
    description: 'Return bridge, database, manifest, and record-count status.',
    mutates: false,
    params: {}
  },
  {
    method: 'agent.undoLastWrite',
    description: 'Restore the database snapshot from before the latest bridge write.',
    mutates: true,
    backupBeforeWrite: false,
    params: {}
  },
  {
    method: 'transactions.list',
    description: `List transactions. ${CENTS_NOTE}`,
    mutates: false,
    params: {
      accountId: 'number?',
      category: 'string?',
      source: 'manual|ai|csv_import|plaid?',
      start: 'unix_seconds?',
      end: 'unix_seconds?'
    }
  },
  {
    method: 'transactions.create',
    description: `Create a manual or AI transaction. ${CENTS_NOTE}`,
    mutates: true,
    params: {
      transaction: 'Transaction input or top-level fields; description and amount required'
    }
  },
  {
    method: 'transactions.bulkCreate',
    description: `Create multiple transactions in one write. ${CENTS_NOTE}`,
    mutates: true,
    params: { transactions: 'Transaction input[]' }
  },
  {
    method: 'transactions.update',
    description: `Patch one transaction by id. ${CENTS_NOTE}`,
    mutates: true,
    params: {
      id: 'number',
      data: 'Partial transaction fields or top-level fields'
    }
  },
  {
    method: 'transactions.delete',
    description: 'Delete one transaction by id.',
    mutates: true,
    params: { id: 'number' }
  },
  {
    method: 'income.list',
    description: `List actual income entries. ${CENTS_NOTE}`,
    mutates: false,
    params: {}
  },
  {
    method: 'income.create',
    description: `Create one actual income entry. ${CENTS_NOTE}`,
    mutates: true,
    params: {
      income: 'Income entry input or top-level fields; shoot_name and amount required'
    }
  },
  {
    method: 'income.bulkCreate',
    description: `Create multiple actual income entries. ${CENTS_NOTE}`,
    mutates: true,
    params: { entries: 'Income entry input[]' }
  },
  {
    method: 'income.update',
    description: `Patch one actual income entry by id. ${CENTS_NOTE}`,
    mutates: true,
    params: { id: 'number', data: 'Partial income fields or top-level fields' }
  },
  {
    method: 'income.delete',
    description: 'Delete one actual income entry by id.',
    mutates: true,
    params: { id: 'number' }
  },
  {
    method: 'incomeExpected.list',
    description: `List expected annual income sources. ${CENTS_NOTE}`,
    mutates: false,
    params: {}
  },
  {
    method: 'incomeExpected.create',
    description: `Create an expected annual income source. ${CENTS_NOTE}`,
    mutates: true,
    params: { entry: 'Expected-income input or top-level fields' }
  },
  {
    method: 'incomeExpected.update',
    description: `Patch an expected annual income source. ${CENTS_NOTE}`,
    mutates: true,
    params: {
      id: 'number',
      data: 'Partial expected-income fields or top-level fields'
    }
  },
  {
    method: 'incomeExpected.delete',
    description: 'Delete one expected annual income source by id.',
    mutates: true,
    params: { id: 'number' }
  },
  {
    method: 'accounts.list',
    description: 'List accounts.',
    mutates: false,
    params: {}
  },
  {
    method: 'accounts.create',
    description: 'Create an account.',
    mutates: true,
    params: { account: 'Account input or top-level fields' }
  },
  {
    method: 'accounts.update',
    description: 'Patch an account by id.',
    mutates: true,
    params: {
      id: 'number',
      data: 'Partial account fields or top-level fields'
    }
  },
  {
    method: 'accounts.delete',
    description: 'Delete an account and clear its transaction links.',
    mutates: true,
    params: { id: 'number' }
  },
  {
    method: 'budget.list',
    description: `List category budget totals. ${CENTS_NOTE}`,
    mutates: false,
    params: {}
  },
  {
    method: 'budget.create',
    description: `Create a budget category total. ${CENTS_NOTE}`,
    mutates: true,
    params: { item: 'Budget item input or top-level fields' }
  },
  {
    method: 'budget.update',
    description: `Patch a budget category total. ${CENTS_NOTE}`,
    mutates: true,
    params: {
      id: 'number',
      data: 'Partial budget item fields or top-level fields'
    }
  },
  {
    method: 'budget.delete',
    description: 'Delete a budget category total.',
    mutates: true,
    params: { id: 'number' }
  },
  {
    method: 'budgetLines.list',
    description: `List detailed budget rows. ${CENTS_NOTE}`,
    mutates: false,
    params: {}
  },
  {
    method: 'budgetLines.create',
    description: `Create a detailed budget row. ${CENTS_NOTE}`,
    mutates: true,
    params: { item: 'Budget line input or top-level fields' }
  },
  {
    method: 'budgetLines.update',
    description: `Patch a detailed budget row. ${CENTS_NOTE}`,
    mutates: true,
    params: {
      id: 'number',
      data: 'Partial budget line fields or top-level fields'
    }
  },
  {
    method: 'budgetLines.delete',
    description: 'Delete a detailed budget row.',
    mutates: true,
    params: { id: 'number' }
  },
  {
    method: 'rules.list',
    description: 'List transaction category-mapping rules.',
    mutates: false,
    params: {}
  },
  {
    method: 'rules.create',
    description: 'Create a transaction category-mapping rule.',
    mutates: true,
    params: { rule: 'Category-mapping input or top-level fields' }
  },
  {
    method: 'rules.update',
    description: 'Patch a category-mapping rule.',
    mutates: true,
    params: {
      id: 'number',
      data: 'Partial category-mapping fields or top-level fields'
    }
  },
  {
    method: 'rules.delete',
    description: 'Delete a category-mapping rule.',
    mutates: true,
    params: { id: 'number' }
  },
  {
    method: 'rules.recategorizeAll',
    description: 'Apply category-mapping rules to all existing transactions.',
    mutates: true,
    params: {}
  },
  {
    method: 'settings.incomeTax.get',
    description: `Read income-tax settings. ${CENTS_NOTE}`,
    mutates: false,
    params: {}
  },
  {
    method: 'settings.incomeTax.update',
    description: `Patch income-tax settings. ${CENTS_NOTE}`,
    mutates: true,
    params: { data: 'Partial IncomeTaxSettings or top-level fields' }
  },
  {
    method: 'settings.livingExpenses.get',
    description: 'Read living-expenses targets.',
    mutates: false,
    params: {}
  },
  {
    method: 'settings.livingExpenses.update',
    description: 'Patch living-expenses targets.',
    mutates: true,
    params: { data: 'Partial LivingExpensesSettings or top-level fields' }
  },
  {
    method: 'backup.now',
    description: 'Create a normal retained database backup.',
    mutates: false,
    params: {}
  },
  {
    method: 'backup.list',
    description: 'List retained database backups.',
    mutates: false,
    params: {}
  },
  {
    method: 'backup.retention.get',
    description: 'Read backup retention count.',
    mutates: false,
    params: {}
  },
  {
    method: 'backup.retention.set',
    description: 'Set backup retention count.',
    mutates: true,
    backupBeforeWrite: false,
    params: { maxFiles: 'number' }
  }
]

const METHOD_BY_NAME = new Map(AGENT_METHODS.map((descriptor) => [descriptor.method, descriptor]))

export function getAgentBridgeDescription(): Record<string, unknown> {
  return {
    name: 'Scoop Money Agent Bridge',
    version: AGENT_BRIDGE_VERSION,
    transport: {
      protocol: 'local HTTP JSON-RPC 2.0',
      auth: 'Authorization: Bearer <token> or X-Scoop-Money-Agent-Token header',
      discovery: 'Read agent-bridge.json from the Scoop Money userData directory.'
    },
    conventions: [
      CENTS_NOTE,
      'Create transactions with source manual or ai; do not modify csv_import rows unless the user explicitly requests it.',
      'Every mutating bridge call creates a restorable pre-write snapshot, except undo and backup-retention settings.'
    ],
    methods: AGENT_METHODS
  }
}

export function getAgentMethodDescriptor(method: string): AgentMethodDescriptor | undefined {
  return METHOD_BY_NAME.get(method)
}

export function createAgentRpcDispatcher(
  services: AgentRpcServices
): (method: string, params?: AgentRpcParams) => Promise<unknown> {
  return async (method, params): Promise<unknown> => {
    if (method === 'agent.describe') return getAgentBridgeDescription()
    const descriptor = METHOD_BY_NAME.get(method)
    const handler = services.methods[method]
    if (!descriptor || !handler) throw new Error(`Unknown agent bridge method: ${method}`)
    if (descriptor.mutates && descriptor.backupBeforeWrite !== false)
      await services.backupBeforeWrite?.(method, params)
    const result = await handler(params)
    if (descriptor.mutates) await services.onMutated?.(method, result)
    return result
  }
}
