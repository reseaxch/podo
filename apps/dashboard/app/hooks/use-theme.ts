"use client"

import { useSyncExternalStore } from "react"

export type Theme = "light" | "dark"

const STORAGE_KEY = "podo-theme"
const CHANGE_EVENT = "podo-theme-change"

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function currentTheme(): Theme {
  if (typeof window === "undefined") return "light"
  const preset = document.documentElement.dataset.theme
  if (preset === "light" || preset === "dark") return preset
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === "light" || stored === "dark" ? stored : systemTheme()
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (onChange) => {
      const followStorage = () => onChange()
      const followSystem = (event: MediaQueryListEvent) => {
        if (window.localStorage.getItem(STORAGE_KEY)) return
        document.documentElement.dataset.theme = event.matches
          ? "dark"
          : "light"
        onChange()
      }
      window.addEventListener(CHANGE_EVENT, onChange)
      window.addEventListener("storage", followStorage)
      const query = window.matchMedia("(prefers-color-scheme: dark)")
      query.addEventListener("change", followSystem)
      return () => {
        window.removeEventListener(CHANGE_EVENT, onChange)
        window.removeEventListener("storage", followStorage)
        query.removeEventListener("change", followSystem)
      }
    },
    currentTheme,
    () => "light",
  )

  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark"
    document.documentElement.dataset.theme = next
    window.localStorage.setItem(STORAGE_KEY, next)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }

  return { theme, toggleTheme }
}
