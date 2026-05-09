import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// When ELECTRON_RUN_AS_NODE=1, `require("electron")` is the install-path stub
// (no `app`), and the app will crash. Clear it for the electron-vite child.
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const bin = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
)
const args = process.argv.slice(2)
const child = spawn(bin, args, {
  cwd: root,
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
})
child.on('exit', (code) => {
  process.exit(code ?? 0)
})
