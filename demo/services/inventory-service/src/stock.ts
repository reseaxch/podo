// Bounded in-memory stock ledger for the demo. Fixed capacity per SKU.

const stock = new Map<string, number>([
  ["sku-basic", 1000],
  ["sku-pro", 500],
])

export function reserve(sku: string, quantity: number): boolean {
  const available = stock.get(sku) ?? 0
  if (available < quantity) return false
  stock.set(sku, available - quantity)
  return true
}

export function available(sku: string): number {
  return stock.get(sku) ?? 0
}
