export interface BenchmarkSample<T> {
  name: string
  durationMs: number
  result: T
}

export async function measure<T>(name: string, operation: () => Promise<T>): Promise<BenchmarkSample<T>> {
  const startedAt = performance.now()
  const result = await operation()
  return {
    name,
    durationMs: performance.now() - startedAt,
    result,
  }
}
