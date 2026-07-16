import "@testing-library/jest-dom/vitest"

import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AuthScreen } from "./auth-screen"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("AuthScreen", () => {
  it("keeps every agent process mounted behind the spotlight mask", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
    render(<AuthScreen mode="signin" />)

    const main = screen.getByRole("main")
    expect(screen.getAllByText(/Podo Agent · live trace/)).toHaveLength(6)
    expect(screen.getAllByText("edge-gateway")).toHaveLength(2)
    expect(screen.getAllByText("01 / 03")).toHaveLength(2)
    expect(screen.getAllByText("02 / 03")).toHaveLength(2)
    expect(screen.getAllByText("03 / 03")).toHaveLength(2)
    expect(screen.getByText("Latency regression")).toBeInTheDocument()
    expect(screen.getByText("8 delayed events")).toBeInTheDocument()

    fireEvent.pointerMove(main, { clientX: 0, clientY: 0 })
    expect(main).toHaveAttribute("data-spotlight", "active")

    fireEvent.pointerMove(main, { clientX: 600, clientY: 500 })
    expect(main).toHaveAttribute("data-spotlight", "active")
    expect(screen.getAllByText(/Podo Agent · live trace/)).toHaveLength(6)
  })

  it("renders the sign-in flow and links to registration", () => {
    render(<AuthScreen mode="signin" />)

    expect(screen.getByRole("heading", { name: "Explore Podo" })).toBeVisible()
    expect(screen.getByText("Interactive demo")).toBeVisible()
    expect(
      screen.getByRole("link", { name: "Create account" }),
    ).toHaveAttribute("href", "/demo/register")
    expect(screen.getByLabelText("Work email")).toHaveAttribute(
      "autocomplete",
      "email",
    )
    expect(
      screen
        .getByRole("button", { name: "Preview GitHub connection" })
        .querySelector("svg"),
    ).not.toBeNull()
  })

  it("shows accessible validation messages", async () => {
    const user = userEvent.setup()
    render(<AuthScreen mode="signin" />)

    await user.click(screen.getByRole("button", { name: "Enter demo" }))

    expect(screen.getByText("Enter a valid work email.")).toBeVisible()
    expect(
      screen.getByText("Password must contain at least 8 characters."),
    ).toBeVisible()
    expect(screen.getByLabelText("Work email")).toHaveAttribute(
      "aria-invalid",
      "true",
    )
  })

  it("toggles password visibility", async () => {
    const user = userEvent.setup()
    render(<AuthScreen mode="signin" />)

    const password = screen.getByLabelText("Password")
    expect(password).toHaveAttribute("type", "password")
    await user.click(screen.getByRole("button", { name: "Show password" }))
    expect(password).toHaveAttribute("type", "text")
  })

  it("completes the registration prototype", async () => {
    vi.useFakeTimers()
    render(<AuthScreen mode="register" />)

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Maya Chen" },
    })
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "maya@podo.dev" },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "evidence-backed" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Preview account setup" }),
    )

    expect(
      screen.getByRole("button", { name: "Creating workspace…" }),
    ).toBeDisabled()
    act(() => vi.advanceTimersByTime(520))
    expect(screen.getByText("Demo preview ready")).toBeVisible()
    expect(
      screen.getByText("No account, session, or workspace was created."),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Open Podo" })).toHaveAttribute(
      "href",
      "/overview?mode=demo",
    )
  })
})
