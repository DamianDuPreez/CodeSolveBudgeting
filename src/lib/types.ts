/** A transaction as read from a bank file, before it is stored. */
export interface ParsedTransaction {
  /** ISO date, YYYY-MM-DD */
  date: string
  /** Rands. Negative = money out, positive = money in. */
  amount: number
  description: string
  /** Running balance after this transaction, when the file has it. */
  balance?: number
}

export interface ParseResult {
  format: 'ofx' | 'csv' | 'pdf'
  accountName?: string
  transactions: ParsedTransaction[]
  warnings: string[]
}

export interface Transaction extends ParsedTransaction {
  id?: number
  /** Stable fingerprint so re-importing the same file adds nothing twice. */
  hash: string
  /** Cleaned-up merchant name, e.g. "CHECKERS" */
  merchant: string
  categoryId: number | null
  /** How the category was chosen. "user" is never overwritten automatically. */
  categorySource: 'rule' | 'learned' | 'keyword' | 'user' | 'none'
  /** YYYY-MM, used for monthly budgets */
  month: string
  importId: number
}

export interface CategoryGroup {
  id?: number
  name: string
  order: number
}

export interface Category {
  id?: number
  groupId: number
  name: string
  order: number
  /** The special income category: money in here funds the budget. */
  isIncome?: boolean
  hidden?: boolean
}

/** Money assigned to a category for one month. */
export interface BudgetEntry {
  id?: number
  month: string
  categoryId: number
  assigned: number
}

/** A learned or user-made rule: merchant pattern → category. */
export interface Rule {
  id?: number
  /** Normalised merchant text the rule matches (substring match). */
  pattern: string
  categoryId: number
  source: 'learned' | 'user'
  createdAt: number
}

export interface ImportRecord {
  id?: number
  fileName: string
  format: ParseResult['format']
  importedAt: number
  added: number
  skipped: number
}
