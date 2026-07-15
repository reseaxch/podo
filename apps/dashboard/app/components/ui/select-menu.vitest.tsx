import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { SelectMenu } from "./select-menu"

const options = [
  { value: "disabled", label: "Disabled" },
  { value: "okta", label: "Okta", description: "Managed identity" },
] as const

function Example() {
  const [value, setValue] =
    useState<(typeof options)[number]["value"]>("disabled")
  return (
    <SelectMenu
      ariaLabel="Identity provider"
      onValueChange={setValue}
      options={options}
      value={value}
    />
  )
}

describe("SelectMenu", () => {
  it("selects an option and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    render(<Example />)

    const trigger = screen.getByRole("combobox", {
      name: "Identity provider",
    })
    await user.click(trigger)
    await user.click(screen.getByRole("option", { name: /Okta/ }))

    expect(trigger).toHaveTextContent("Okta")
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("supports keyboard navigation", async () => {
    const user = userEvent.setup()
    render(<Example />)

    const trigger = screen.getByRole("combobox", {
      name: "Identity provider",
    })
    trigger.focus()
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")

    expect(trigger).toHaveTextContent("Okta")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
})
