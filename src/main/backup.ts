import { mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { basename, join } from 'path'
import type { BackupFile } from '../types/money'
import { backupDatabase } from './database'

const BACKUP_PATTERN = /^backup-.*\.db$/
const DEFAULT_RETENTION = 7

let backupDir = ''
let noonTimer: NodeJS.Timeout | null = null
let eveningTimer: NodeJS.Timeout | null = null

export function initBackups(userDataPath: string): void {
  backupDir = join(userDataPath, 'backups')
  mkdirSync(backupDir, { recursive: true })
  scheduleBackupTimers()
}

export async function runBackup(): Promise<{ path: string }> {
  if (!backupDir) throw new Error('Backups have not been initialized')
  mkdirSync(backupDir, { recursive: true })
  const destination = join(backupDir, `${backupFileStamp()}.db`)
  await backupDatabase(destination)
  pruneBackups()
  return { path: destination }
}

export function listBackups(): BackupFile[] {
  if (!backupDir) return []
  mkdirSync(backupDir, { recursive: true })
  return readdirSync(backupDir)
    .filter((name) => BACKUP_PATTERN.test(name))
    .map((name) => {
      const path = join(backupDir, name)
      const stat = statSync(path)
      return {
        name,
        path,
        createdAt: Math.floor(stat.mtimeMs / 1000),
        size: stat.size
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function scheduleBackupTimers(): void {
  if (noonTimer) clearTimeout(noonTimer)
  if (eveningTimer) clearTimeout(eveningTimer)
  noonTimer = scheduleDailyAt(12, 0)
  eveningTimer = scheduleDailyAt(20, 0)
}

function scheduleDailyAt(hour: number, minute: number): NodeJS.Timeout {
  const next = new Date()
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
  return setTimeout(async () => {
    try {
      await runBackup()
    } finally {
      scheduleDailyAt(hour, minute)
    }
  }, next.getTime() - Date.now())
}

function pruneBackups(): void {
  listBackups()
    .slice(DEFAULT_RETENTION)
    .forEach((backup) => {
      if (BACKUP_PATTERN.test(basename(backup.path))) unlinkSync(backup.path)
    })
}

function backupFileStamp(): string {
  return `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
}
