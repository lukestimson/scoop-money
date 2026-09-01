import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AiProvider,
  BudgetType,
  ChatMessage,
  ImportRuleProvider,
  MoneyAPI,
  TransactionFilters
} from '../types/money'

const api: MoneyAPI = {
  onMoneyDataMutated: (callback): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('money:dataMutated', listener)
    return (): void => {
      ipcRenderer.removeListener('money:dataMutated', listener)
    }
  },
  onTextScaleCommand: (callback): (() => void) => {
    const listener = (
      _event: unknown,
      command: { kind: 'delta'; delta: number } | { kind: 'reset' }
    ): void => {
      callback(command)
    }
    ipcRenderer.on('ui:textScaleCommand', listener)
    return (): void => {
      ipcRenderer.removeListener('ui:textScaleCommand', listener)
    }
  },
  getTransactions: (filters?: TransactionFilters) =>
    ipcRenderer.invoke('transactions:getAll', filters),
  createTransaction: (data) => ipcRenderer.invoke('transactions:create', data),
  updateTransaction: (id, data) => ipcRenderer.invoke('transactions:update', id, data),
  deleteTransaction: (id) => ipcRenderer.invoke('transactions:delete', id),
  moveTransactionToIncome: (id) => ipcRenderer.invoke('transactions:moveToIncome', id),
  deleteTransactions: (ids) => ipcRenderer.invoke('transactions:deleteMany', ids),
  deleteAllTransactions: () => ipcRenderer.invoke('transactions:deleteAll'),
  importTransactions: (filePath, accountId) =>
    ipcRenderer.invoke('transactions:import', filePath, accountId),
  getImportedFiles: (filters) => ipcRenderer.invoke('imports:getAll', filters),
  clearImportedFile: (fileId) => ipcRenderer.invoke('imports:clear', fileId),
  clearIncomeCandidateFlags: (ids) => ipcRenderer.invoke('transactions:clearIncomeFlags', ids),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  getBudgetItems: (budgetType?: BudgetType) => ipcRenderer.invoke('budget:getAll', budgetType),
  getBudgetLineItems: () => ipcRenderer.invoke('budgetLines:getAll'),
  createBudgetItem: (data) => ipcRenderer.invoke('budget:create', data),
  updateBudgetItem: (id, data) => ipcRenderer.invoke('budget:update', id, data),
  deleteBudgetItem: (id) => ipcRenderer.invoke('budget:delete', id),
  createBudgetLineItem: (data) => ipcRenderer.invoke('budgetLines:create', data),
  updateBudgetLineItem: (id, data) => ipcRenderer.invoke('budgetLines:update', id, data),
  deleteBudgetLineItem: (id) => ipcRenderer.invoke('budgetLines:delete', id),

  getAccounts: () => ipcRenderer.invoke('accounts:getAll'),
  createAccount: (data) => ipcRenderer.invoke('accounts:create', data),
  updateAccount: (id, data) => ipcRenderer.invoke('accounts:update', id, data),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),

  getIncomeEntries: () => ipcRenderer.invoke('income:getAll'),
  createIncomeEntry: (data) => ipcRenderer.invoke('income:create', data),
  updateIncomeEntry: (id, data) => ipcRenderer.invoke('income:update', id, data),
  deleteIncomeEntry: (id) => ipcRenderer.invoke('income:delete', id),
  getExpectedIncomeEntries: () => ipcRenderer.invoke('incomeExpected:getAll'),
  createExpectedIncomeEntry: (data) => ipcRenderer.invoke('incomeExpected:create', data),
  updateExpectedIncomeEntry: (id, data) => ipcRenderer.invoke('incomeExpected:update', id, data),
  deleteExpectedIncomeEntry: (id) => ipcRenderer.invoke('incomeExpected:delete', id),
  getIncomeTaxSettings: () => ipcRenderer.invoke('incomeTax:getSettings'),
  updateIncomeTaxSettings: (data) => ipcRenderer.invoke('incomeTax:updateSettings', data),
  getLivingExpensesSettings: () => ipcRenderer.invoke('livingExpenses:getSettings'),
  updateLivingExpensesSettings: (data) => ipcRenderer.invoke('livingExpenses:updateSettings', data),

  getCategoryRules: () => ipcRenderer.invoke('rules:getAll'),
  createCategoryRule: (data) => ipcRenderer.invoke('rules:create', data),
  updateCategoryRule: (id, data) => ipcRenderer.invoke('rules:update', id, data),
  deleteCategoryRule: (id) => ipcRenderer.invoke('rules:delete', id),
  recategorizeAllTransactions: () => ipcRenderer.invoke('rules:recategorizeAll'),
  getImportTransactionRules: (provider?: ImportRuleProvider) =>
    ipcRenderer.invoke('importRules:getAll', provider),
  createImportTransactionRule: (data) => ipcRenderer.invoke('importRules:create', data),
  updateImportTransactionRule: (id, data) => ipcRenderer.invoke('importRules:update', id, data),
  deleteImportTransactionRule: (id) => ipcRenderer.invoke('importRules:delete', id),

  chat: (pageId: string, message: string, history: ChatMessage[], attachments = []) =>
    ipcRenderer.invoke('ai:chat', pageId, message, history, attachments),
  getModel: () => ipcRenderer.invoke('ai:getModel'),
  getAvailableModels: () => ipcRenderer.invoke('ai:getAvailableModels'),
  setModel: (id) => ipcRenderer.invoke('ai:setModel', id),
  getAiProvider: () => ipcRenderer.invoke('ai:getProvider'),
  setAiProvider: (provider: AiProvider) => ipcRenderer.invoke('ai:setProvider', provider),
  refreshAiModels: () => ipcRenderer.invoke('ai:refreshModels'),
  startMacDictation: () => ipcRenderer.invoke('ai:startMacDictation'),
  getAiPromptSettings: () => ipcRenderer.invoke('aiPrompts:get'),
  updateAiPromptSettings: (data) => ipcRenderer.invoke('aiPrompts:update', data),
  resetAiPromptSettings: () => ipcRenderer.invoke('aiPrompts:reset'),

  backupNow: () => ipcRenderer.invoke('backup:now'),
  getBackupList: () => ipcRenderer.invoke('backup:list'),
  getBackupRetention: () => ipcRenderer.invoke('backup:getRetention'),
  setBackupRetention: (maxFiles) => ipcRenderer.invoke('backup:setRetention', maxFiles),
  openBackupFolder: () => ipcRenderer.invoke('backup:openFolder')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(window as unknown as { api: MoneyAPI }).api = api
}
