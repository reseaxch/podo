"use client"

import { useSyncExternalStore } from "react"

export type Theme = "light" | "dark"

const STORAGE_KEY = "podo-theme-v2"
const CHANGE_EVENT = "podo-theme-change"

function currentTheme(): Theme {
  if (typeof window === "undefined") return "dark"
  const preset = document.documentElement.dataset.theme
  if (preset === "light" || preset === "dark") return preset
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === "light" ? "light" : "dark"
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (onChange) => {
      const followStorage = () => onChange()
      window.addEventListener(CHANGE_EVENT, onChange)
      window.addEventListener("storage", followStorage)
      return () => {
        window.removeEventListener(CHANGE_EVENT, onChange)
        window.removeEventListener("storage", followStorage)
      }
    },
    currentTheme,
    () => "dark",
  )

  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark"
    document.documentElement.dataset.theme = next
    window.localStorage.setItem(STORAGE_KEY, next)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }

  return { theme, toggleTheme }
}
