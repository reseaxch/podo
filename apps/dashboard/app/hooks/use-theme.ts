"use client"

import { useEffect, useState } from "react"

export type Theme = "light" | "dark"

const STORAGE_KEY = "podo-theme"

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light"
  const preset = document.documentElement.dataset.theme
  if (preset === "light" || preset === "dark") return preset
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === "light" || stored === "dark" ? stored : systemTheme()
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (window.localStorage.getItem(STORAGE_KEY)) return
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const followSystem = (event: MediaQueryListEvent) =>
      setTheme(event.matches ? "dark" : "light")
    query.addEventListener("change", followSystem)
    return () => query.removeEventListener("change", followSystem)
  }, [])

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark"
      document.documentElement.dataset.theme = next
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }

  return { theme, toggleTheme }
}
