// Client for the inventory-service reservation endpoint.
// Establishes a cross-service edge: checkout-service depends on inventory-service.

export interface ReservationResult {
  reserved: boolean
  sku: string
}

export async function reserveInventory(sku: string, quantity: number): Promise<ReservationResult> {
  const baseUrl = process.env.INVENTORY_URL ?? "http://inventory-service:8082"
  const response = await fetch(`${baseUrl}/reserve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku, quantity }),
  })
  if (!response.ok) {
    throw new Error(`inventory reserve failed: ${response.status}`)
  }
  return (await response.json()) as ReservationResult
}
