import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readIncomeTypeColorHex,
  removeIncomeTypeColorHex,
  resolveIncomeTypeColorHex,
  setIncomeTypeColorHex
} from './incomeTypeColors.ts'

function installWindow(initial = {}) {
  const store = new Map(Object.entries(initial))
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return store.get(key) ?? null
      },
      setItem(key, value) {
        store.set(key, value)
      },
      removeItem(key) {
        store.delete(key)
      }
    }
  }
}

test('matches legacy saved overrides across case and spacing variants', () => {
  installWindow({
    scoop_income_type_colors_v1: JSON.stringify({
      Bartending: '#ff6600',
      'Stimson Photo': '#22aa88'
    })
  })

  assert.equal(readIncomeTypeColorHex('bartending'), '#ff6600')
  assert.equal(readIncomeTypeColorHex('Stimsonphoto'), '#22aa88')
  assert.equal(readIncomeTypeColorHex('stimson-photo'), '#22aa88')
})

test('stores and removes normalized override keys', () => {
  installWindow()

  setIncomeTypeColorHex('Thumb tack', '#123456')
  assert.equal(readIncomeTypeColorHex('Thumbtack'), '#123456')

  removeIncomeTypeColorHex('thumbtack')
  assert.equal(readIncomeTypeColorHex('Thumb tack'), null)
})

test('uses tolerant built-in fallbacks when no override exists', () => {
  installWindow()

  assert.equal(resolveIncomeTypeColorHex('thumbtack'), '#d97706')
  assert.equal(resolveIncomeTypeColorHex('Up Work'), '#0284c7')
  assert.equal(resolveIncomeTypeColorHex('Stimson Photo'), '#7c3aed')
})
