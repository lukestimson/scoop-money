import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAgentRpcDispatcher,
  getAgentBridgeDescription,
  getAgentMethodDescriptor
} from './agentBridgeCore.ts'

test('agent.describe exposes money methods and cent convention', () => {
  const description = getAgentBridgeDescription()
  const methods = description.methods as Array<{ method: string }>
  assert.ok(methods.some((method) => method.method === 'transactions.create'))
  assert.ok(methods.some((method) => method.method === 'income.bulkCreate'))
  assert.ok(methods.some((method) => method.method === 'agent.undoLastWrite'))
  assert.match((description.conventions as string[])[0], /integer cents/)
})

test('a mutating method backs up before writing and notifies after success', async () => {
  const calls: string[] = []
  const dispatch = createAgentRpcDispatcher({
    methods: {
      'transactions.create': () => {
        calls.push('write')
        return { id: 1 }
      }
    },
    backupBeforeWrite: (method) => {
      calls.push(`backup:${method}`)
    },
    onMutated: (method) => {
      calls.push(`notify:${method}`)
    }
  })
  assert.deepEqual(
    await dispatch('transactions.create', {
      description: 'Coffee',
      amount: -500
    }),
    { id: 1 }
  )
  assert.deepEqual(calls, ['backup:transactions.create', 'write', 'notify:transactions.create'])
})

test('undo skips creating another snapshot', async () => {
  const calls: string[] = []
  const dispatch = createAgentRpcDispatcher({
    methods: {
      'agent.undoLastWrite': () => {
        calls.push('undo')
        return { success: true }
      }
    },
    backupBeforeWrite: () => {
      calls.push('backup')
    },
    onMutated: () => {
      calls.push('notify')
    }
  })
  assert.deepEqual(await dispatch('agent.undoLastWrite'), { success: true })
  assert.deepEqual(calls, ['undo', 'notify'])
})

test('unknown bridge methods are rejected', async () => {
  const dispatch = createAgentRpcDispatcher({ methods: {} })
  await assert.rejects(
    () => dispatch('transactions.eraseEverything'),
    /Unknown agent bridge method/
  )
  assert.equal(getAgentMethodDescriptor('transactions.eraseEverything'), undefined)
})
