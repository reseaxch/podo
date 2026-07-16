export type GitHubFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export const DEFAULT_GITHUB_REQUEST_TIMEOUT_MS = 30_000
export const MAX_GITHUB_REQUEST_TIMEOUT_MS = 120_000

export function isGitHubRequestTimeout(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 1
    && (value as number) <= MAX_GITHUB_REQUEST_TIMEOUT_MS
}

export async function fetchWithGitHubTimeout(
  request: GitHubFetchLike,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error("github_request_timed_out"))
    }, timeoutMs)
  })
  const operation = Promise.resolve().then(() => request(input, {
    ...init,
    signal: controller.signal,
  }))

  try {
    return await Promise.race([operation, timedOut])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
