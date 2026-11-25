import { describe, expect, it } from 'vitest'
import { parseAmount, parseDate } from './parsers/common'
import { parseCsv } from './parsers/csv'
import { parseOfx } from './parsers/ofx'
import { parseStatementLines } from './parsers/statementText'
import { categorise, normaliseMerchant } from './categorise'

describe('dates and amounts', () => {
  it('reads SA date styles', () => {
    expect(parseDate('2026/01/05')).toBe('2026-01-05')
    expect(parseDate('05/01/2026')).toBe('2026-01-05')
    expect(parseDate('5 Jan 2026')).toBe('2026-01-05')
    expect(parseDate('20260105120000[+2:SAST]')).toBe('2026-01-05')
  })
  it('reads amounts with Cr/Dr and thousands separators', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56)
    expect(parseAmount('1 234.56Cr')).toBe(1234.56)
    expect(parseAmount('150.00 Dr')).toBe(-150)
    expect(parseAmount('-99.90')).toBe(-99.9)
    expect(parseAmount('Checkers')).toBeNull()
  })
})

describe('FNB CSV', () => {
  const csv = [
    'ACCOUNT TRANSACTION HISTORY',
    'Name:,GOLD CHEQUE ACCOUNT',
    'Account:,62000001234,',
    '',
    'Date,Amount,Balance,Description',
    '2026/01/03,-412.35,9587.65,POS Purchase Checkers Sandton 412345*1234 02 Jan',
    '2026/01/03,-412.35,9175.30,POS Purchase Checkers Sandton 412345*1234 02 Jan',
    '2026/01/25,25000.00,34175.30,Magtape Credit ACME PTY LTD SALARY',
  ].join('\r\n')

  it('finds the header and reads every row', () => {
    const r = parseCsv(csv)
    expect(r.transactions).toHaveLength(3)
    expect(r.transactions[0]).toMatchObject({ date: '2026-01-03', amount: -412.35, balance: 9587.65 })
    expect(r.accountName).toBe('Account ••1234')
  })

  it('handles separate debit and credit columns', () => {
    const r = parseCsv('Date;Description;Debit;Credit\n05/02/2026;Netflix.com;199,00;\n06/02/2026;Refund;;50,00')
    expect(r.transactions.map((t) => t.amount)).toEqual([-199, 50])
  })
})

describe('OFX', () => {
  it('reads SGML-style OFX', () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>62000001234</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-199.00<NAME>NETFLIX.COM</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260125<TRNAMT>25000.00<NAME>SALARY<MEMO>ACME</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
    const r = parseOfx(ofx)
    expect(r.transactions).toEqual([
      { date: '2026-01-10', amount: -199, description: 'NETFLIX.COM' },
      { date: '2026-01-25', amount: 25000, description: 'SALARY ACME' },
    ])
  })
})

describe('FNB PDF statement text', () => {
  const lines = [
    'Statement Period : 26 December 2025 to 25 January 2026',
    'Date  Description  Amount  Balance  Accrued Bank Charges',
    '26 Dec  Opening Balance  10,000.00Cr',
    '28 Dec  POS Purchase Woolworths Food 412345*1234 27 Dec  850.20  9,149.80Cr',
    '02 Jan  #Monthly Account Fee  69.00  9,080.80Cr',
    '25 Jan  Magtape Credit ACME Salary  25,000.00Cr  34,080.80Cr',
    '25 Jan  Closing Balance  34,080.80Cr',
  ]

  it('assigns years across the December–January boundary and signs amounts', () => {
    const r = parseStatementLines(lines)
    expect(r.transactions).toEqual([
      { date: '2025-12-28', amount: -850.2, description: 'POS Purchase Woolworths Food 412345*1234 27 Dec', balance: 9149.8 },
      { date: '2026-01-02', amount: -69, description: '#Monthly Account Fee', balance: 9080.8 },
      { date: '2026-01-25', amount: 25000, description: 'Magtape Credit ACME Salary', balance: 34080.8 },
    ])
  })
})

describe('FNB PDF: real statement layout', () => {
  // Shapes copied from a real FNB "Next Transact" statement (card numbers masked).
  const lines = [
    'Statement Period : 14 August 2026 to 14 November 2026',
    'Opening Balance  389.63Cr',
    'Date  Bank  Description  Amount  Balance',
    '15 Aug  POS Purchase Woolworths  ######*9655 13 Aug  152.95  236.68Cr',
    '24 Aug  FNB App Payment From Inv-#####  10,000.00Cr  10,236.68Cr',
    '25 Aug  POS Purchase G2A.Com  ######*7016 25 Aug  190.61  10,046.07Cr',
    '27 Aug  4.92  10,041.15Cr',
    '27 Aug  POS Purchase 179.00 Netflix.Com  ######*9655 25 Aug  179.00  9,862.15Cr',
    '07 Sep  POS Purchase 1899.00 Playstation  ######*9655 04 Sep  1,899.00  7,963.15Cr  52.22',
    'Closing Balance  7,963.15Cr',
  ]
  const r = parseStatementLines(lines)

  it('keeps the shop name when the price is printed inside the description', () => {
    expect(r.transactions[4]).toEqual({
      date: '2026-08-27', amount: -179, description: 'POS Purchase 179.00 Netflix.Com ######*9655 25 Aug', balance: 9862.15,
    })
    expect(normaliseMerchant(r.transactions[4].description)).toBe('NETFLIX COM')
  })

  it('reads rows FNB prints without text as bank fees', () => {
    expect(r.transactions[3]).toEqual({ date: '2026-08-27', amount: -4.92, description: 'Bank fee (no description on statement)', balance: 10041.15 })
    expect(normaliseMerchant(r.transactions[3].description)).toBe('BANK FEE')
  })

  it('ignores the accrued bank charges column', () => {
    expect(r.transactions[5]).toMatchObject({ amount: -1899, balance: 7963.15 })
  })

  it('reads credits and every row', () => {
    expect(r.transactions).toHaveLength(6)
    expect(r.transactions[1]).toMatchObject({ amount: 10000, description: 'FNB App Payment From Inv-#####' })
  })
})

describe('categorising', () => {
  const byName = new Map([['Groceries', 1], ['Salary', 2], ['Bank fees', 3], ['Clothing', 4], ['Rent & bond', 5]])

  it('cleans merchant names', () => {
    expect(normaliseMerchant('POS Purchase Checkers Sandton 412345*1234 02 Jan')).toBe('CHECKERS SANDTON')
  })

  it('uses built-in SA keywords', () => {
    const c = (description: string, amount: number) =>
      categorise({ description, amount, merchant: normaliseMerchant(description) }, [], byName, []).categoryId
    expect(c('POS Purchase Woolworths Food Rosebank', -300)).toBe(1)
    expect(c('Woolworths Sandton City', -900)).toBe(4)
    expect(c('Magtape Credit ACME Salary', 25000)).toBe(2)
    expect(c('#Monthly Account Fee', -69)).toBe(3)
    expect(c('Current account transfer', -100)).toBeNull() // "rent" inside "current" must not match
  })

  it('prefers rules learned from the user', () => {
    const rules = [{ pattern: 'CHECKERS SANDTON', categoryId: 9, source: 'learned' as const, createdAt: 0 }]
    expect(categorise({ description: 'x', merchant: 'CHECKERS SANDTON', amount: -1 }, rules, byName, []))
      .toEqual({ categoryId: 9, source: 'learned' })
  })
})
