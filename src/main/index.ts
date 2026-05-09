import { join } from 'path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import dotenv from 'dotenv'
import icon from '../../resources/icon.png?asset'
import {
  createAccount,
  createBudgetItem,
  createCategoryRule,
  createIncomeEntry,
  createTransaction,
  deleteAccount,
  deleteBudgetItem,
  deleteCategoryRule,
  deleteIncomeEntry,
  deleteTransaction,
  getAllAccounts,
  getAllBudgetItems,
  getAllCategoryRules,
  getAllIncomeEntries,
  getAllTransactions,
  initDatabase,
  recategorizeAllTransactions,
  updateAccount,
  updateBudgetItem,
  updateCategoryRule,
  updateIncomeEntry,
  updateTransaction
} from './database'
import { importTransactionsFromFile } from './importer'
import { initBackups, listBackups, runBackup } from './backup'
import { chatWithMoney, getAvailableModels, getModelId, initAiPersistence, setModelId } from './ai'
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
}

function registerIpcHandlers(): void {
  ipcMain.handle('transactions:getAll', (_event, filters?: TransactionFilters) => getAllTransactions(filters))
  ipcMain.handle('transactions:create', (_event, data) => createTransaction(data))
  ipcMain.handle('transactions:update', (_event, id: number, data) => updateTransaction(id, data))
  ipcMain.handle('transactions:delete', (_event, id: number) => deleteTransaction(id))
  ipcMain.handle('transactions:import', (_event, filePath: string, accountId: number) =>
    importTransactionsFromFile(filePath, accountId)
  )

  ipcMain.handle('budget:getAll', (_event, budgetType?: BudgetType) => getAllBudgetItems(budgetType))
  ipcMain.handle('budget:create', (_event, data) => createBudgetItem(data))
  ipcMain.handle('budget:update', (_event, id: number, data) => updateBudgetItem(id, data))
  ipcMain.handle('budget:delete', (_event, id: number) => deleteBudgetItem(id))

  ipcMain.handle('accounts:getAll', () => getAllAccounts())
  ipcMain.handle('accounts:create', (_event, data) => createAccount(data))
  ipcMain.handle('accounts:update', (_event, id: number, data) => updateAccount(id, data))
  ipcMain.handle('accounts:delete', (_event, id: number) => deleteAccount(id))

  ipcMain.handle('income:getAll', () => getAllIncomeEntries())
  ipcMain.handle('income:create', (_event, data) => createIncomeEntry(data))
  ipcMain.handle('income:update', (_event, id: number, data) => updateIncomeEntry(id, data))
  ipcMain.handle('income:delete', (_event, id: number) => deleteIncomeEntry(id))

  ipcMain.handle('rules:getAll', () => getAllCategoryRules())
  ipcMain.handle('rules:create', (_event, data) => createCategoryRule(data))
  ipcMain.handle('rules:update', (_event, id: number, data) => updateCategoryRule(id, data))
  ipcMain.handle('rules:delete', (_event, id: number) => deleteCategoryRule(id))
  ipcMain.handle('rules:recategorizeAll', () => recategorizeAllTransactions())

  ipcMain.handle('ai:chat', (_event, pageId: string, message: string, history) =>
    chatWithMoney(pageId, message, history)
  )
  ipcMain.handle('ai:getModel', () => getModelId())
  ipcMain.handle('ai:getAvailableModels', () => getAvailableModels())
  ipcMain.handle('ai:setModel', (_event, id: string) => setModelId(id))

  ipcMain.handle('backup:now', () => runBackup())
  ipcMain.handle('backup:list', () => listBackups())
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
