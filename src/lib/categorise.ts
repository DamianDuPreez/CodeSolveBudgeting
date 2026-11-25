import type { Rule } from './types'

/** Words FNB and other SA banks put in front of the merchant name. */
const PREFIXES = [
  'pos purchase', 'card purchase', 'purchase', 'pos local purchase', 'pos international purchase',
  'debit order', 'internet pmt to', 'internet payment to', 'fnb app payment to', 'fnb app payment from',
  'fnb app transfer to', 'fnb app transfer from', 'payment to', 'payment from', 'scheduled payment to',
  'send money app dr', 'send money', 'magtape credit', 'magtape debit', 'eft credit', 'eft debit',
  'cash deposit', 'atm withdrawal', 'fnb atm', 'prepaid', 'pos reversal', 'refund', 'ib payment to',
  'immediate payment to', 'rtc payment to', 'payshap payment to', 'payshap payment from', 'credit transfer',
]

/**
 * True when the "merchant" is only the bank's transaction label (e.g. "POS PURCHASE"), so it says
 * nothing about the shop. Rules must never be learned from or matched on such names.
 */
export function isGenericMerchant(merchant: string): boolean {
  const m = merchant.trim().toLowerCase()
  return m === '' || PREFIXES.includes(m) || m === '(no description)'
}

/**
 * Reduce a raw bank description to the part that identifies the merchant:
 * "POS Purchase Checkers Sandton 412345*1234 03 Jan" → "CHECKERS SANDTON"
 */
export function normaliseMerchant(description: string): string {
  let s = description.toLowerCase()
  // Rows FNB prints without any text (see NO_DESCRIPTION_FEE in the PDF reader).
  if (s.startsWith('bank fee (no description')) return 'BANK FEE'
  if (s.startsWith('money in (no description')) return 'MONEY IN'
  for (const p of PREFIXES) {
    if (s.startsWith(p + ' ')) { s = s.slice(p.length + 1); break }
  }
  // FNB puts the price first on some card purchases: "POS Purchase 179.00 Netflix.Com".
  s = s.replace(/^\d[\d, ]*\.\d{2}\s+/, '')
  s = s
    .replace(/\d+\*+\d+/g, ' ') // masked card numbers
    .replace(/\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/g, ' ') // "03 jan"
    .replace(/\b\d{4,}\b/g, ' ') // reference numbers
    .replace(/\b[a-z]*\d{5,}[a-z]*\b/g, ' ') // references glued to letters, e.g. "948303753me"
    .replace(/[^a-z0-9&' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = s.split(' ').filter((w) => w.length > 1 || /\d/.test(w))
  return words.slice(0, 3).join(' ').toUpperCase() || description.toUpperCase().slice(0, 30)
}

/** Built-in knowledge of common South African merchants, keyed by default category name. */
export const KEYWORDS: Record<string, string[]> = {
  Groceries: ['checkers', 'shoprite', 'pick n pay', 'pnp', 'woolworths food', 'woolies food', 'spar', 'superspar', 'kwikspar', 'food lover', 'boxer', 'usave', 'makro food', 'sixty60', 'checkers hyper', 'ok foods', 'fruit & veg', 'fruit and veg'],
  'Fuel & transport': ['engen', 'shell', 'sasol', 'bp', 'caltex', 'astron', 'total', 'totalenergies', 'uber', 'bolt', 'gautrain', 'e-toll', 'sanral', 'toll', 'parking', 'myciti', 'putco'],
  'Eating out': ['kfc', 'mcdonald', 'nando', 'steers', 'wimpy', 'spur', 'debonairs', 'roman', 'pizza', 'burger king', 'ocean basket', 'mugg', 'vida e', 'starbucks', 'seattle coffee', 'mr d', 'uber eats', 'restaurant', 'coffee', 'cafe', 'fishaways', 'chicken licken', 'panarottis'],
  'Electricity & water': ['prepaid electricity', 'eskom', 'city power', 'municipality', 'city of', 'electricity', 'water'],
  'Phone & internet': ['vodacom', 'mtn', 'cell c', 'telkom', 'rain', 'afrihost', 'webafrica', 'vumatel', 'openserve', 'airtime', 'data bundle', 'fibre'],
  Subscriptions: ['netflix', 'showmax', 'dstv', 'multichoice', 'spotify', 'apple.com', 'google', 'youtube', 'disney', 'amazon prime', 'prime video', 'microsoft', 'icloud', 'openai', 'chatgpt', 'adobe', 'crunchyroll', 'discord', 'patreon', 'twitch'],
  Insurance: ['outsurance', 'discovery insure', 'santam', 'old mutual', 'sanlam', 'momentum', 'miway', 'king price', 'budget insurance', 'hollard', '1life', 'insurance', 'assurance'],
  'Medical aid': ['discovery health', 'bonitas', 'medihelp', 'fedhealth', 'bestmed', 'medical aid', 'momentum health'],
  'Health & pharmacy': ['clicks', 'dis-chem', 'dischem', 'pharmacy', 'doctor', 'dentist', 'optometrist', 'spec-savers', 'specsavers', 'hospital', 'netcare', 'mediclinic', 'life healthcare'],
  Household: ['builders', 'game', 'makro', 'mr price home', '@home', 'hardware', 'leroy merlin', 'cashbuild', 'takealot', 'dis-chem home'],
  Clothing: ['mr price', 'mrp', 'edgars', 'truworths', 'foschini', 'markham', 'ackermans', 'pep', 'pepstores', 'h&m', 'zara', 'cotton on', 'woolworths', 'superbalist', 'sportscene', 'totalsports', 'identity'],
  Entertainment: ['ster-kinekor', 'nu metro', 'computicket', 'ticketpro', 'steam', 'playstation', 'xbox', 'betway', 'hollywoodbets', 'casino', 'g2a', 'playerauctions', 'epic games', 'nintendo'],
  'Bank fees': ['service fee', 'monthly account fee', 'account fee', 'bank charge', 'admin fee', 'transaction fee', 'notification fee', 'fnb fee', 'interest charged', 'cash handling fee', 'ewallet fee', 'bank fee'],
  'Rent & bond': ['rent', 'bond', 'home loan', 'levy', 'levies', 'body corporate'],
  Salary: ['salary', 'salaries', 'wages', 'payroll', 'sal', 'stipend'],
  Savings: ['savings', 'tax free', 'easyequities', 'satrix', 'unit trust', 'allan gray', 'coronation', '10x'],
}

export interface CategoriseInput {
  description: string
  merchant: string
  amount: number
}

export interface CategoryChoice {
  categoryId: number | null
  source: 'rule' | 'learned' | 'keyword' | 'none'
}

const patternCache = new Map<string, RegExp>()

/** Match a keyword at the start of a word, so "rent" matches "rental" but not "current". */
function keywordPattern(word: string): RegExp {
  let re = patternCache.get(word)
  if (!re) {
    const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`(^|[^a-z0-9])${escaped}`, 'i')
    patternCache.set(word, re)
  }
  return re
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let common = 0
  for (const t of a) if (b.has(t)) common++
  return common / Math.min(a.size, b.size)
}

/**
 * Choose a category without any paid AI:
 * 1. rules the user made, 2. rules learned from the user's corrections,
 * 3. similarity to merchants the user already categorised, 4. built-in SA merchant keywords.
 */
export function categorise(
  t: CategoriseInput,
  rules: Rule[],
  categoryIdByName: Map<string, number>,
  known: { merchant: string; categoryId: number }[],
): CategoryChoice {
  const merchant = t.merchant.toLowerCase()
  const desc = t.description.toLowerCase()

  for (const source of ['user', 'learned'] as const) {
    // Longest pattern first, so "WOOLWORTHS FOOD" beats "WOOLWORTHS".
    const hit = rules
      .filter((r) => r.source === source && !isGenericMerchant(r.pattern) && (merchant.includes(r.pattern.toLowerCase()) || desc.includes(r.pattern.toLowerCase())))
      .sort((a, b) => b.pattern.length - a.pattern.length)[0]
    if (hit) return { categoryId: hit.categoryId, source: source === 'user' ? 'rule' : 'learned' }
  }

  const mt = tokens(t.merchant)
  let best: { categoryId: number; score: number } | null = null
  for (const k of known) {
    if (isGenericMerchant(k.merchant)) continue
    const score = similarity(mt, tokens(k.merchant))
    if (score >= 0.6 && (!best || score > best.score)) best = { categoryId: k.categoryId, score }
  }
  if (best) return { categoryId: best.categoryId, source: 'learned' }

  // FNB marks its own fees with a leading "#", e.g. "#Monthly Account Fee".
  const fees = categoryIdByName.get('Bank fees')
  if (fees !== undefined && t.amount < 0 && desc.trim().startsWith('#')) return { categoryId: fees, source: 'keyword' }

  for (const [name, words] of Object.entries(KEYWORDS)) {
    const id = categoryIdByName.get(name)
    if (id === undefined) continue
    // Income keywords only count for money in; spending keywords only for money out.
    if (name === 'Salary' ? t.amount <= 0 : t.amount > 0 && name !== 'Savings') continue
    if (words.some((w) => keywordPattern(w).test(desc))) return { categoryId: id, source: 'keyword' }
  }

  return { categoryId: null, source: 'none' }
}
