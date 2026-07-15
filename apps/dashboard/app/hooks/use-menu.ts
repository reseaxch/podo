"use client"

import { useEffect, useRef, useState } from "react"

export function useMenu<T extends string>() {
  const [openMenu, setOpenMenu] = useState<T | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  function closeMenu(returnFocus = false) {
    setOpenMenu(null)
    if (returnFocus)
      window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function toggleMenu(menu: T, trigger: HTMLButtonElement) {
    triggerRef.current = trigger
    setOpenMenu((current) => (current === menu ? null : menu))
  }

  useEffect(() => {
    if (!openMenu) return
    window.requestAnimationFrame(() =>
      menuRef.current
        ?.querySelector<HTMLElement>(
          "button[role='menuitem'], button[role='option']",
        )
        ?.focus(),
    )
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true)
    }
    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [openMenu])

  return { closeMenu, menuRef, openMenu, toggleMenu }
}
