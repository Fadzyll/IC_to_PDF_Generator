import { useEffect, useRef } from 'react'
import { CanvasMemoryError, wipe } from './image'

export interface AppError {
  message: string
  reload?: boolean
}

/** The PDF code is loaded on demand; a redeploy can remove the old file a stale page asks for. */
export const isChunkLoadError = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(
    (e as Error)?.message ?? '',
  )

/** Turn a failure into a message that says what happened and what to do. */
export function describeError(e: unknown, action: string): AppError {
  if (e instanceof CanvasMemoryError) {
    return {
      message: `Your phone ran out of memory while ${action}. Close other tabs or apps and try again. If it still fails, reload the page.`,
      reload: true,
    }
  }
  if (isChunkLoadError(e)) {
    return { message: 'The app was just updated. Please reload the page and try again.', reload: true }
  }
  const err = e as Error
  const detail = err?.message ? ` (${err.name}: ${err.message.slice(0, 120)})` : ''
  return { message: `Something went wrong while ${action}.${detail}`, reload: true }
}

/** Run image work during render without crashing the page if memory runs out. */
export function tryCanvas<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (e) {
    console.error(e)
    return fallback
  }
}

/**
 * Free canvases from the previous render once they've been replaced. Safari is
 * slow to release canvas memory by itself and has a low limit on iPhones.
 */
export function useReleaseReplaced(
  current: (HTMLCanvasElement | null)[],
  keep: (HTMLCanvasElement | null | undefined)[] = [],
) {
  const prev = useRef<HTMLCanvasElement[]>([])
  useEffect(() => {
    const now = current.filter((c): c is HTMLCanvasElement => !!c)
    for (const c of prev.current) if (!now.includes(c) && !keep.includes(c)) wipe(c)
    prev.current = now
  })
}

export const hasLiveCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** Let React paint a "Processing…" state before blocking work. */
export const nextFrame = () => new Promise((r) => setTimeout(r, 30))

/** A 'YYYY-MM-DD' stamp for file names. */
export function dateStamp(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Trigger a normal browser download of a file. */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
