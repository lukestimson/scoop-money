import type { MoneyAPI } from '../types/money'

declare global {
  interface Window {
    api: MoneyAPI
  }
}
