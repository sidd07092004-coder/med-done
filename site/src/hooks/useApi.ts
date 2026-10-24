import { useEffect, useState } from 'react'
import { ApiError } from '../api/publicApi'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  /** True when the request failed with HTTP 404 (missing or unpublished). */
  notFound: boolean
}

/**
 * Minimal fetch-state helper: runs `fetcher` whenever `deps` change and exposes
 * loading / error / notFound flags so every view can render proper states.
 */
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: true,
    error: null,
    notFound: false,
  })

  useEffect(() => {
    const controller = new AbortController()
    setState({ data: null, loading: true, error: null, notFound: false })

    fetcher(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null, notFound: false })
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const error = err instanceof Error ? err : new Error(String(err))
        const notFound = err instanceof ApiError && err.status === 404
        setState({ data: null, loading: false, error, notFound })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
