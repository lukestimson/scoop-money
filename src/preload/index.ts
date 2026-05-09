import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { BudgetType, ChatMessage, MoneyAPI, TransactionFilters } from '../types/money'

const api: MoneyAPI = {
  getTransactions: (filters?: TransactionFilters) => ipcRenderer.invoke('transactions:getAll', filters),
  createTransaction: (data) => ipcRenderer.invoke('transactions:create', data),
  updateTransaction: (id, data) => ipcRenderer.invoke('transactions:update', id, data),
  deleteTransaction: (id) => ipcRenderer.invoke('transactions:delete', id),
  importTransactions: (filePath, accountId) => ipcRenderer.invoke('transactions:import', filePath, accountId),

  getBudgetItems: (budgetType?: BudgetType) => ipcRenderer.invoke('budget:getAll', budgetType),
  createBudgetItem: (data) => ipcRenderer.invoke('budget:create', data),
  updateBudgetItem: (id, data) => ipcRenderer.invoke('budget:update', id, data),
  deleteBudgetItem: (id) => ipcRenderer.invoke('budget:delete', id),

  getAccounts: () => ipcRenderer.invoke('accounts:getAll'),
  createAccount: (data) => ipcRenderer.invoke('accounts:create', data),
  updateAccount: (id, data) => ipcRenderer.invoke('accounts:update', id, data),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),

  getIncomeEntries: () => ipcRenderer.invoke('income:getAll'),
  createIncomeEntry: (data) => ipcRenderer.invoke('income:create', data),
  updateIncomeEntry: (id, data) => ipcRenderer.invoke('income:update', id, data),
  deleteIncomeEntry: (id) => ipcRenderer.invoke('income:delete', id),

  getCategoryRules: () => ipcRenderer.invoke('rules:getAll'),
  createCategoryRule: (data) => ipcRenderer.invoke('rules:create', data),
  updateCategoryRule: (id, data) => ipcRenderer.invoke('rules:update', id, data),
  deleteCategoryRule: (id) => ipcRenderer.invoke('rules:delete', id),
  recategorizeAllTransactions: () => ipcRenderer.invoke('rules:recategorizeAll'),

  chat: (pageId: string, message: string, history: ChatMessage[]) =>
    ipcRenderer.invoke('ai:chat', pageId, message, history),
  getModel: () => ipcRenderer.invoke('ai:getModel'),
  getAvailableModels: () => ipcRenderer.invoke('ai:getAvailableModels'),
  setModel: (id) => ipcRenderer.invoke('ai:setModel', id),

  backupNow: () => ipcRenderer.invoke('backup:now'),
  getBackupList: () => ipcRenderer.invoke('backup:list')
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
