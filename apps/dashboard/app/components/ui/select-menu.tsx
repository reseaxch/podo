"use client"

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"

import type { IconName } from "../../lib/incident-types"
import { Icon } from "./pictogram"
import styles from "./select-menu.module.css"

export type SelectMenuOption<Value extends string> = {
  value: Value
  label: string
  description?: string
}

export function SelectMenu<Value extends string>({
  ariaLabel,
  className,
  disabled = false,
  label,
  leadingIcon,
  onValueChange,
  options,
  value,
}: {
  ariaLabel?: string | undefined
  className?: string | undefined
  disabled?: boolean
  label?: string | undefined
  leadingIcon?: IconName | undefined
  onValueChange: (value: Value) => void
  options: ReadonlyArray<SelectMenuOption<Value> | Value>
  value: Value
}) {
  const popupLabel = ariaLabel ?? label ?? "Select an option"
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  )
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(
    0,
    normalizedOptions.findIndex((option) => option.value === value),
  )
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 })
  const selected = normalizedOptions[selectedIndex]
  const accessibleLabel =
    ariaLabel ??
    (label ? `${label}: ${selected?.label ?? value}` : "Select an option")

  const close = useCallback(({ restoreFocus = true } = {}) => {
    setOpen(false)
    if (restoreFocus)
      window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  function select(index: number) {
    const option = normalizedOptions[index]
    if (!option) return
    onValueChange(option.value)
    close()
  }

  function openPopup(direction: 1 | -1 = 1) {
    if (disabled) return
    setHighlightedIndex(
      direction === 1
        ? selectedIndex
        : Math.max(0, normalizedOptions.length - 1),
    )
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const estimatedHeight = Math.min(280, normalizedOptions.length * 52 + 12)
    const placeAbove = window.innerHeight - rect.bottom < estimatedHeight + 12
    setPosition({
      left: Math.min(rect.left, window.innerWidth - rect.width - 8),
      top: placeAbove
        ? Math.max(8, rect.top - estimatedHeight - 5)
        : rect.bottom + 5,
      width: rect.width,
    })
  }, [normalizedOptions.length, open])

  useEffect(() => {
    if (!open) return
    popupRef.current?.focus()
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current?.contains(target) ||
        popupRef.current?.contains(target)
      )
        return
      close({ restoreFocus: false })
    }
    const handleViewportChange = () => close({ restoreFocus: false })
    document.addEventListener("pointerdown", handlePointer)
    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)
    return () => {
      document.removeEventListener("pointerdown", handlePointer)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
    }
  }, [close, open])

  return (
    <div className={`${styles.root} ${className ?? ""}`}>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={accessibleLabel}
        className={styles.trigger}
        disabled={disabled}
        onClick={() => (open ? close() : openPopup())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            openPopup(event.key === "ArrowDown" ? 1 : -1)
          }
        }}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        {leadingIcon ? (
          <span className={styles.leadingIcon}>
            <Icon name={leadingIcon} size={14} />
          </span>
        ) : null}
        <span className={styles.value}>
          <strong>{selected?.label ?? value}</strong>
          {selected?.description ? <small>{selected.description}</small> : null}
        </span>
        <span className={styles.caret}>
          <Icon name={open ? "caret-up" : "caret-down"} size={14} />
        </span>
      </button>

      {open
        ? createPortal(
            <div
              aria-activedescendant={`${listboxId}-${highlightedIndex}`}
              aria-label={popupLabel}
              className={styles.popup}
              id={listboxId}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  close()
                } else if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setHighlightedIndex((current) =>
                    Math.min(normalizedOptions.length - 1, current + 1),
                  )
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setHighlightedIndex((current) => Math.max(0, current - 1))
                } else if (event.key === "Home") {
                  event.preventDefault()
                  setHighlightedIndex(0)
                } else if (event.key === "End") {
                  event.preventDefault()
                  setHighlightedIndex(Math.max(0, normalizedOptions.length - 1))
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  select(highlightedIndex)
                } else if (event.key === "Tab") {
                  close({ restoreFocus: false })
                }
              }}
              ref={popupRef}
              role="listbox"
              style={position}
              tabIndex={-1}
            >
              {normalizedOptions.map((option, index) => (
                <button
                  aria-selected={option.value === value}
                  className={index === highlightedIndex ? styles.active : ""}
                  id={`${listboxId}-${index}`}
                  key={option.value}
                  onClick={() => select(index)}
                  onPointerMove={() => setHighlightedIndex(index)}
                  role="option"
                  type="button"
                >
                  <span>
                    <strong>{option.label}</strong>
                    {option.description ? (
                      <small>{option.description}</small>
                    ) : null}
                  </span>
                  {option.value === value ? (
                    <Icon name="check-circle" size={15} />
                  ) : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
