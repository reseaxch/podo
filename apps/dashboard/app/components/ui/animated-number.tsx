"use client"

import { useEffect, useRef } from "react"

export function AnimatedNumber({
  value,
  duration = 520,
}: {
  value: number
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const previousRef = useRef(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const from = previousRef.current
    previousRef.current = value
    if (reduceMotion || from === value) {
      element.textContent = value.toLocaleString()
      return
    }

    const startedAt = performance.now()
    let frame = 0
    const update = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      element.textContent = Math.round(
        from + (value - from) * eased,
      ).toLocaleString()
      if (progress < 1) frame = window.requestAnimationFrame(update)
    }
    frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [duration, value])

  return (
    <span
      aria-label={value.toLocaleString()}
      className="animated-number"
      ref={ref}
    >
      {value.toLocaleString()}
    </span>
  )
}
