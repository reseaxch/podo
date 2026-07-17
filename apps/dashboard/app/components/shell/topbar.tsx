"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"

import { useMenu } from "../../hooks/use-menu"
import { useTheme } from "../../hooks/use-theme"
import { Icon } from "../ui/pictogram"

type TopbarProps = {
  owner: { name: string; avatar: string }
  section?: string
  current?: string
  query: string
  searchLabel: string
  searchPlaceholder: string
  onQueryChange: (query: string) => void
  onNotificationOpen?: (id: string, message: string) => void
  onNotify: (message: string) => void
  source?: "demo" | "core"
}

export function Topbar({
  owner,
  section = "Incidents",
  current,
  query,
  searchLabel,
  searchPlaceholder,
  onQueryChange,
  onNotificationOpen,
  onNotify,
  source = "demo",
}: TopbarProps) {
  const [project, setProject] = useState("podo-cloud")
  const [notificationsRead, setNotificationsRead] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const { theme, toggleTheme } = useTheme()
  const { closeMenu, menuRef, openMenu, toggleMenu } = useMenu<
    "project" | "notifications"
  >()

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [])

  function openNotification(id: string, message: string) {
    setNotificationsRead(true)
    closeMenu()
    if (onNotificationOpen) onNotificationOpen(id, message)
    else onNotify(message)
  }

  return (
    <header className="topbar">
      {source === "core" ? (
        <div
          aria-label="Live Core workspace"
          className="project-switcher live-core-context"
        >
          <Icon name="cube" size={17} /> Podo Core
        </div>
      ) : (
        <div
          className="menu-anchor"
          ref={openMenu === "project" ? menuRef : undefined}
        >
          <button
            aria-expanded={openMenu === "project"}
            aria-haspopup="menu"
            className="project-switcher"
            onClick={(event) => toggleMenu("project", event.currentTarget)}
            type="button"
          >
            <Icon name="cube" size={17} /> {project}{" "}
            <Icon name="caret-down" size={14} />
          </button>
          {openMenu === "project" ? (
            <div className="shell-menu project-menu" role="menu">
              <span className="menu-label">Projects</span>
              {["podo-cloud", "payments-prod", "identity-edge"].map((name) => (
                <button
                  aria-current={project === name ? "true" : undefined}
                  key={name}
                  onClick={() => {
                    setProject(name)
                    closeMenu()
                    onNotify(`Switched to ${name}`)
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Icon
                    name={name === "podo-cloud" ? "cube" : "stack"}
                    size={16}
                  />
                  <span>
                    <strong>{name}</strong>
                    <small>
                      {name === "podo-cloud" ? "Current incident" : "Healthy"}
                    </small>
                  </span>
                  {project === name ? (
                    <Icon name="check-circle" size={15} />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div className="breadcrumbs">
        <span>{section}</span>
        {current ? (
          <>
            <b>/</b>
            <strong>{current}</strong>
          </>
        ) : null}
      </div>
      <label className="command-search">
        <Icon name="magnifying-glass" size={17} />
        <input
          aria-label={searchLabel}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder}
          ref={searchRef}
          type="search"
          value={query}
        />
        <kbd>⌘ K</kbd>
      </label>
      <button
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        className="theme-button"
        onClick={toggleTheme}
        suppressHydrationWarning
        title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        type="button"
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} />
      </button>
      {source === "demo" ? (
        <div
          className="menu-anchor notification-anchor"
          ref={openMenu === "notifications" ? menuRef : undefined}
        >
          <button
            aria-expanded={openMenu === "notifications"}
            aria-haspopup="menu"
            aria-label="Notifications"
            className="notification-button"
            onClick={(event) =>
              toggleMenu("notifications", event.currentTarget)
            }
            type="button"
          >
            <Icon name="bell" />
            {!notificationsRead ? <span /> : null}
          </button>
          {openMenu === "notifications" ? (
            <div className="shell-menu notification-menu" role="menu">
              <div className="menu-heading">
                <strong>Notifications</strong>
                <button
                  onClick={() => {
                    setNotificationsRead(true)
                    onNotify("Notifications marked as read")
                  }}
                  type="button"
                >
                  Mark read
                </button>
              </div>
              <button
                onClick={() =>
                  openNotification("metrics", "Heap evidence opened")
                }
                role="menuitem"
                type="button"
              >
                <i className="notification-dot" />
                <span>
                  <strong>Heap crossed 90%</strong>
                  <small>2 min ago · Datadog</small>
                </span>
              </button>
              <button
                onClick={() =>
                  openNotification("runtime", "Runtime evidence opened")
                }
                role="menuitem"
                type="button"
              >
                <i className="notification-dot warning" />
                <span>
                  <strong>GC pressure remains high</strong>
                  <small>5 min ago · GCP</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <Image
        alt={owner.name}
        className="avatar"
        height={34}
        priority
        src={owner.avatar}
        width={34}
      />
    </header>
  )
}
