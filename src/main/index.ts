import { join } from 'path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import dotenv from 'dotenv'
import icon from '../../resources/icon.png?asset'
import {
  createAccount,
  createBudgetItem,
  createBudgetLineItem,
  createCategoryRule,
  createIncomeEntry,
  createTransaction,
  deleteAccount,
  deleteAllTransactions,
  deleteBudgetItem,
  deleteBudgetLineItem,
  deleteCategoryRule,
  deleteIncomeEntry,
  deleteTransactions,
  createExpectedIncomeEntry,
  deleteTransaction,
  deleteExpectedIncomeEntry,
  getAllAccounts,
  getAllBudgetItems,
  getAllBudgetLineItems,
  getAllCategoryRules,
  getAllExpectedIncomeEntries,
  getAllIncomeEntries,
  getAllTransactions,
  getImportedFiles,
  getIncomeTaxSettings,
  initDatabase,
  recategorizeAllTransactions,
  updateAccount,
  updateBudgetItem,
  updateBudgetLineItem,
  updateCategoryRule,
  updateExpectedIncomeEntry,
  updateIncomeEntry,
  updateIncomeTaxSettings,
  updateTransaction
} from './database'
import { importTransactionsFromFile } from './importer'
import { getBackupDirectory, getBackupRetention, initBackups, listBackups, runBackup, setBackupRetention } from './backup'
import {
  chatWithMoney,
  getAiPromptSettings,
  getAvailableModels,
  getModelId,
  initAiPersistence,
  resetAiPromptSettings,
  setModelId,
  startMacDictation,
  updateAiPromptSettings
} from './ai'
import type { BudgetType, TransactionFilters } from '../types/money'

dotenv.config()

app.setName('Scoop Money')
app.setAppUserModelId('com.scoopmoneyapp')
app.setPath('userData', join(app.getPath('appData'), 'scoop-money'))

const BACKUP_QUIT_TIMEOUT_MS = 8000
let quitting = false

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: 'Scoop Money',
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('did-finish-load', () => {
    try {
      mainWindow.webContents.setZoomFactor(1)
      void mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
    } catch {
      /* ignore */
    }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!(input.control || input.meta) || input.alt) return
    const key = input.key
    if (key === '+' || key === '=') {
      event.preventDefault()
      mainWindow.webContents.send('ui:textScaleCommand', { kind: 'delta', delta: 0.025 })
    } else if (key === '-' || key === '_') {
      event.preventDefault()
      mainWindow.webContents.send('ui:textScaleCommand', { kind: 'delta', delta: -0.025 })
    } else if (key === '0') {
      event.preventDefault()
      mainWindow.webContents.send('ui:textScaleCommand', { kind: 'reset' })
    }
  })
}

function registerIpcHandlers(): void {
  ipcMain.handle('transactions:getAll', (_event, filters?: TransactionFilters) => getAllTransactions(filters))
  ipcMain.handle('transactions:create', (_event, data) => createTransaction(data))
  ipcMain.handle('transactions:update', (_event, id: number, data) => updateTransaction(id, data))
  ipcMain.handle('transactions:delete', (_event, id: number) => deleteTransaction(id))
  ipcMain.handle('transactions:deleteMany', (_event, ids: number[]) => deleteTransactions(ids))
  ipcMain.handle('transactions:deleteAll', () => deleteAllTransactions())
  ipcMain.handle('transactions:import', (_event, filePath: string, accountId: number) =>
    importTransactionsFromFile(filePath, accountId)
  )
  ipcMain.handle('imports:getAll', (_event, filters?: { start?: number; end?: number }) => getImportedFiles(filters))

  ipcMain.handle('budget:getAll', (_event, budgetType?: BudgetType) => getAllBudgetItems(budgetType))
  ipcMain.handle('budgetLines:getAll', () => getAllBudgetLineItems())
  ipcMain.handle('budget:create', (_event, data) => createBudgetItem(data))
  ipcMain.handle('budget:update', (_event, id: number, data) => updateBudgetItem(id, data))
  ipcMain.handle('budget:delete', (_event, id: number) => deleteBudgetItem(id))
  ipcMain.handle('budgetLines:create', (_event, data) => createBudgetLineItem(data))
  ipcMain.handle('budgetLines:update', (_event, id: number, data) => updateBudgetLineItem(id, data))
  ipcMain.handle('budgetLines:delete', (_event, id: number) => deleteBudgetLineItem(id))

  ipcMain.handle('accounts:getAll', () => getAllAccounts())
  ipcMain.handle('accounts:create', (_event, data) => createAccount(data))
  ipcMain.handle('accounts:update', (_event, id: number, data) => updateAccount(id, data))
  ipcMain.handle('accounts:delete', (_event, id: number) => deleteAccount(id))

  ipcMain.handle('income:getAll', () => getAllIncomeEntries())
  ipcMain.handle('income:create', (_event, data) => createIncomeEntry(data))
  ipcMain.handle('income:update', (_event, id: number, data) => updateIncomeEntry(id, data))
  ipcMain.handle('income:delete', (_event, id: number) => deleteIncomeEntry(id))
  ipcMain.handle('incomeExpected:getAll', () => getAllExpectedIncomeEntries())
  ipcMain.handle('incomeExpected:create', (_event, data) => createExpectedIncomeEntry(data))
  ipcMain.handle('incomeExpected:update', (_event, id: number, data) => updateExpectedIncomeEntry(id, data))
  ipcMain.handle('incomeExpected:delete', (_event, id: number) => deleteExpectedIncomeEntry(id))
  ipcMain.handle('incomeTax:getSettings', () => getIncomeTaxSettings())
  ipcMain.handle('incomeTax:updateSettings', (_event, data) => updateIncomeTaxSettings(data))

  ipcMain.handle('rules:getAll', () => getAllCategoryRules())
  ipcMain.handle('rules:create', (_event, data) => createCategoryRule(data))
  ipcMain.handle('rules:update', (_event, id: number, data) => updateCategoryRule(id, data))
  ipcMain.handle('rules:delete', (_event, id: number) => deleteCategoryRule(id))
  ipcMain.handle('rules:recategorizeAll', () => recategorizeAllTransactions())

  ipcMain.handle('ai:chat', (_event, pageId: string, message: string, history, attachments) =>
    chatWithMoney(pageId, message, history, attachments ?? [])
  )
  ipcMain.handle('ai:getModel', () => getModelId())
  ipcMain.handle('ai:getAvailableModels', () => getAvailableModels())
  ipcMain.handle('ai:setModel', (_event, id: string) => setModelId(id))
  ipcMain.handle('ai:startMacDictation', () => startMacDictation())
  ipcMain.handle('aiPrompts:get', () => getAiPromptSettings())
  ipcMain.handle('aiPrompts:update', (_event, data) => updateAiPromptSettings(data))
  ipcMain.handle('aiPrompts:reset', () => resetAiPromptSettings())

  ipcMain.handle('backup:now', () => runBackup())
  ipcMain.handle('backup:list', () => listBackups())
  ipcMain.handle('backup:getRetention', () => getBackupRetention())
  ipcMain.handle('backup:setRetention', (_event, maxFiles: number) => setBackupRetention(maxFiles))
  ipcMain.handle('backup:openFolder', () => shell.openPath(getBackupDirectory()))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.scoopmoneyapp')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDatabase(app.getPath('userData'))
  initAiPersistence(app.getPath('userData'))
  initBackups(app.getPath('userData'))
  registerIpcHandlers()
  getAvailableModels().catch(() => undefined)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  Promise.race([
    runBackup(),
    new Promise((resolve) => setTimeout(resolve, BACKUP_QUIT_TIMEOUT_MS))
  ]).finally(() => app.quit())
})
