"use client"

import type { KeyboardEvent } from "react"

import { useMenu } from "../../hooks/use-menu"
import type { IconName } from "../../lib/incident-types"
import { Icon } from "./pictogram"

type SelectMenuProps = {
  label: string
  leadingIcon: IconName
  options: string[]
  value: string
  onValueChange: (value: string) => void
}

export function SelectMenu({
  label,
  leadingIcon,
  options,
  value,
  onValueChange,
}: SelectMenuProps) {
  const { closeMenu, menuRef, openMenu, toggleMenu } = useMenu<"options">()
  const listboxId = `${label.toLowerCase().replaceAll(" ", "-")}-options`

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button[role='option']",
      ),
    )
    if (!items.length) return
    event.preventDefault()
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    )
    if (event.key === "Home") items[0]?.focus()
    else if (event.key === "End") items.at(-1)?.focus()
    else if (event.key === "ArrowDown")
      items[(currentIndex + 1 + items.length) % items.length]?.focus()
    else items[(currentIndex - 1 + items.length) % items.length]?.focus()
  }

  return (
    <div
      className="select-menu"
      ref={openMenu === "options" ? menuRef : undefined}
    >
      <button
        aria-controls={openMenu === "options" ? listboxId : undefined}
        aria-expanded={openMenu === "options"}
        aria-haspopup="listbox"
        aria-label={`${label}: ${value}`}
        className="select-menu-trigger"
        onClick={(event) => toggleMenu("options", event.currentTarget)}
        type="button"
      >
        <Icon name={leadingIcon} size={15} />
        <span>{value}</span>
        <Icon name="caret-down" size={13} />
      </button>
      {openMenu === "options" ? (
        <div
          aria-label={label}
          className="select-menu-content"
          id={listboxId}
          onKeyDown={handleListKeyDown}
          role="listbox"
        >
          <span className="select-menu-label">{label}</span>
          {options.map((option) => (
            <button
              aria-selected={value === option}
              key={option}
              onClick={() => {
                onValueChange(option)
                closeMenu(true)
              }}
              role="option"
              type="button"
            >
              <Icon
                name={option === "All services" ? "stack" : "cube"}
                size={15}
              />
              <span>{option}</span>
              {value === option ? (
                <Icon name="check-circle" size={15} />
              ) : (
                <i />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
