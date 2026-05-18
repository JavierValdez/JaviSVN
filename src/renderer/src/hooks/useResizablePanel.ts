import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

interface UseResizablePanelOptions {
  storageKey: string
  defaultWidth: number
  minWidth: number
  maxWidth?: number
  minRemainingWidth?: number
}

function readStoredWidth(storageKey: string, fallback: number): number {
  try {
    const stored = window.localStorage.getItem(storageKey)
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function useResizablePanel<T extends HTMLElement = HTMLDivElement>({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  minRemainingWidth = 0
}: UseResizablePanelOptions) {
  const containerRef = useRef<T | null>(null)
  const [width, setWidth] = useState(() => readStoredWidth(storageKey, defaultWidth))
  const [isResizing, setIsResizing] = useState(false)

  const clampWidth = useCallback((nextWidth: number) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width
    const maxAllowedByContainer = containerWidth
      ? Math.max(minWidth, containerWidth - minRemainingWidth)
      : Number.POSITIVE_INFINITY
    const effectiveMax = Math.max(minWidth, Math.min(maxWidth ?? Number.POSITIVE_INFINITY, maxAllowedByContainer))

    return Math.min(Math.max(nextWidth, minWidth), effectiveMax)
  }, [maxWidth, minRemainingWidth, minWidth])

  useEffect(() => {
    setWidth((currentWidth) => clampWidth(currentWidth))
  }, [clampWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(Math.round(width)))
    } catch {
      // Ignore storage failures; resizing still works for the current session.
    }
  }, [storageKey, width])

  useEffect(() => {
    const onResize = () => setWidth((currentWidth) => clampWidth(currentWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampWidth])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    const pointerId = event.pointerId
    const handle = event.currentTarget
    const startX = event.clientX
    const startWidth = width
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    handle.setPointerCapture(pointerId)
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onPointerMove = (moveEvent: PointerEvent) => {
      setWidth(clampWidth(startWidth + moveEvent.clientX - startX))
    }

    const stopResize = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      setIsResizing(false)

      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId)
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }, [clampWidth, width])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

    event.preventDefault()
    const step = event.shiftKey ? 40 : 12
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    setWidth((currentWidth) => clampWidth(currentWidth + step * direction))
  }, [clampWidth])

  return {
    containerRef,
    width,
    isResizing,
    resizeHandleProps: {
      onPointerDown,
      onKeyDown
    }
  }
}
