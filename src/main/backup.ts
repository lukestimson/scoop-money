import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import type { BackupFile } from '../types/money'
import { backupDatabase } from './database'

const BACKUP_PATTERN = /^backup-.*\.db$/
const DEFAULT_RETENTION = 7
const MIN_RETENTION = 1
const MAX_RETENTION = 50

let backupDir = ''
let settingsPath = ''
let noonTimer: NodeJS.Timeout | null = null
let eveningTimer: NodeJS.Timeout | null = null

export function initBackups(userDataPath: string): void {
  backupDir = join(userDataPath, 'backups')
  settingsPath = join(userDataPath, 'backup-settings.json')
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

export function getBackupRetention(): number {
  if (!settingsPath) return DEFAULT_RETENTION
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as { maxBackups?: unknown }
    return clampRetention(Number(parsed.maxBackups))
  } catch {
    return DEFAULT_RETENTION
  }
}

export function setBackupRetention(maxFiles: number): number {
  const next = clampRetention(maxFiles)
  if (settingsPath) writeFileSync(settingsPath, JSON.stringify({ maxBackups: next }, null, 2), 'utf8')
  pruneBackups()
  return next
}

export function getBackupDirectory(): string {
  if (!backupDir) throw new Error('Backups have not been initialized')
  mkdirSync(backupDir, { recursive: true })
  return backupDir
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
    .slice(getBackupRetention())
    .forEach((backup) => {
      if (BACKUP_PATTERN.test(basename(backup.path))) unlinkSync(backup.path)
    })
}

function clampRetention(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RETENTION
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, Math.round(value)))
}

function backupFileStamp(): string {
  return `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
}
