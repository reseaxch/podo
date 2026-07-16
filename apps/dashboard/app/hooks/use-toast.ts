"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useToast(duration = 2600) {
  const [toast, setToast] = useState<string | null>(null)
  const [toastState, setToastState] = useState<"visible" | "exiting">("visible")
  const timerRef = useRef<number | null>(null)
  const exitTimerRef = useRef<number | null>(null)

  const showToast = useCallback(
    (message: string) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (exitTimerRef.current !== null)
        window.clearTimeout(exitTimerRef.current)
      setToastState("visible")
      setToast(message)
      timerRef.current = window.setTimeout(() => {
        setToastState("exiting")
        timerRef.current = null
        exitTimerRef.current = window.setTimeout(() => {
          setToast(null)
          setToastState("visible")
          exitTimerRef.current = null
        }, 150)
      }, duration)
    },
    [duration],
  )

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (exitTimerRef.current !== null)
        window.clearTimeout(exitTimerRef.current)
    },
    [],
  )

  return { toast, toastState, showToast }
}
