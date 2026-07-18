// Client for the inventory-service reservation endpoint.
// Establishes a cross-service edge: checkout-service depends on inventory-service.

export interface ReservationResult {
  reserved: boolean
  sku: string
}

export async function reserveInventory(
  sku: string,
  quantity: number,
  baseUrl = process.env.INVENTORY_URL ?? "http://127.0.0.1:8082",
): Promise<ReservationResult> {
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
