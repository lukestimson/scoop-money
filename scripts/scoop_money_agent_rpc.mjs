#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function defaultManifestPath() {
  if (process.env.SCOOP_MONEY_AGENT_MANIFEST) return process.env.SCOOP_MONEY_AGENT_MANIFEST
  const home = homedir()
  if (process.platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'scoop-money', 'agent-bridge.json')
  if (process.platform === 'win32')
    return join(
      process.env.APPDATA || join(home, 'AppData', 'Roaming'),
      'scoop-money',
      'agent-bridge.json'
    )
  return join(
    process.env.XDG_CONFIG_HOME || join(home, '.config'),
    'scoop-money',
    'agent-bridge.json'
  )
}

function usage() {
  console.error(`Usage:
  node scripts/scoop_money_agent_rpc.mjs <method> [jsonParams]

Examples:
  node scripts/scoop_money_agent_rpc.mjs agent.status
  node scripts/scoop_money_agent_rpc.mjs agent.describe
  node scripts/scoop_money_agent_rpc.mjs transactions.create '{"description":"Coffee","amount":-500,"source":"ai"}'
  node scripts/scoop_money_agent_rpc.mjs income.create '{"shoot_name":"Client session","amount":35000}'

Currency values are integer cents. Override discovery with SCOOP_MONEY_AGENT_MANIFEST,
or set both SCOOP_MONEY_AGENT_URL and SCOOP_MONEY_AGENT_TOKEN.`)
}

const method = process.argv[2]
if (!method || method === '-h' || method === '--help') {
  usage()
  process.exit(method ? 0 : 1)
}

let params = {}
if (process.argv[3] != null) {
  try {
    params = JSON.parse(process.argv[3])
  } catch (error) {
    throw new Error(`jsonParams must be valid JSON: ${error.message}`)
  }
}

const manifest =
  process.env.SCOOP_MONEY_AGENT_URL && process.env.SCOOP_MONEY_AGENT_TOKEN
    ? {
        rpcUrl: process.env.SCOOP_MONEY_AGENT_URL,
        token: process.env.SCOOP_MONEY_AGENT_TOKEN
      }
    : JSON.parse(readFileSync(defaultManifestPath(), 'utf8'))
if (!manifest.rpcUrl || !manifest.token) throw new Error('Invalid Scoop Money agent manifest.')

const response = await fetch(manifest.rpcUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${manifest.token}`
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
})
const text = await response.text()
let payload
try {
  payload = text ? JSON.parse(text) : null
} catch {
  throw new Error(`Non-JSON response (${response.status}): ${text}`)
}
if (!response.ok || payload?.error) {
  console.error(JSON.stringify(payload?.error ?? payload, null, 2))
  process.exit(1)
}
console.log(JSON.stringify(payload?.result ?? payload, null, 2))
