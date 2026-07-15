import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getWorkspaceSettings,
  type WorkspaceSettingsController,
} from "./settings-model"
import { SettingsWorkspace } from "./settings-workspace"

vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }))

describe("SettingsWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("tracks dirty state and cancels local changes", async () => {
    const user = userEvent.setup()
    render(<SettingsWorkspace view={await getWorkspaceSettings()} />)

    const name = screen.getByRole("textbox", { name: "Workspace name" })
    await user.clear(name)
    await user.type(name, "Podo Reliability")

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(name).toHaveValue("Podo Cloud")
    expect(screen.getByText(/All changes saved/)).toBeInTheDocument()
  })

  it("validates and saves through the typed controller", async () => {
    const user = userEvent.setup()
    render(<SettingsWorkspace view={await getWorkspaceSettings()} />)
    const name = screen.getByRole("textbox", { name: "Workspace name" })

    await user.clear(name)
    await user.type(name, "X")
    await user.click(screen.getByRole("button", { name: "Save changes" }))
    expect(screen.getByText(/at least 2 characters/)).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Review the highlighted settings",
    )

    await user.clear(name)
    await user.type(name, "Podo Ops")
    await user.click(screen.getByRole("button", { name: "Save changes" }))
    expect(screen.getByRole("status")).toHaveTextContent(
      "Workspace settings saved",
    )
    expect(screen.getByText(/revision 13/)).toBeInTheDocument()
  })

  it("edits roles and keeps production mutations permanently blocked", async () => {
    const user = userEvent.setup()
    render(<SettingsWorkspace view={await getWorkspaceSettings()} />)

    await user.click(screen.getByRole("button", { name: /Team & roles/ }))
    await user.click(
      screen.getByRole("combobox", { name: "Role for Alex Rivera" }),
    )
    await user.click(screen.getByRole("option", { name: "Responder" }))
    expect(
      screen.getByRole("combobox", { name: "Role for Alex Rivera" }),
    ).toHaveTextContent("Responder")

    await user.click(screen.getByRole("button", { name: /AI autonomy/ }))
    const autonomy = screen
      .getByRole("heading", { name: "AI autonomy & approvals" })
      .closest("section")!
    expect(within(autonomy).getByText("Always blocked")).toBeInTheDocument()
    expect(
      within(autonomy).queryByRole("group", { name: /Production mutation/ }),
    ).not.toBeInTheDocument()
  })

  it("fails closed when persistence rejects a mutation", async () => {
    const user = userEvent.setup()
    const save = vi
      .fn<WorkspaceSettingsController["save"]>()
      .mockResolvedValue({
        ok: false,
        code: "unavailable",
        message: "Settings service is unavailable. No changes were applied.",
      })
    render(
      <SettingsWorkspace
        controller={{ save }}
        view={await getWorkspaceSettings()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: /Repositories & data/ }),
    )
    await user.click(screen.getByRole("button", { name: "Disconnect GitHub" }))
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("status")).toHaveTextContent(
      "No changes were applied",
    )
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
  })

  it("recovers when the settings transport rejects", async () => {
    const user = userEvent.setup()
    const save = vi
      .fn<WorkspaceSettingsController["save"]>()
      .mockRejectedValue(new Error("network timeout"))
    render(
      <SettingsWorkspace
        controller={{ save }}
        view={await getWorkspaceSettings()}
      />,
    )

    const name = screen.getByRole("textbox", { name: "Workspace name" })
    await user.clear(name)
    await user.type(name, "Podo Ops")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    expect(screen.getByRole("status")).toHaveTextContent(
      "Settings service is unavailable. No changes were applied.",
    )
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
  })

  it("configures incident defaults and validates security access", async () => {
    const user = userEvent.setup()
    render(<SettingsWorkspace view={await getWorkspaceSettings()} />)

    await user.click(screen.getByRole("button", { name: /Incident defaults/ }))
    await user.click(screen.getByRole("combobox", { name: "Default severity" }))
    await user.click(screen.getByRole("option", { name: /P1 · Critical/ }))
    expect(screen.getByText(/Collect 30m of evidence/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Security & access/ }))
    const domain = screen.getByRole("textbox", { name: /^Allowed domain/ })
    await user.clear(domain)
    await user.type(domain, "invalid")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    expect(
      screen.getByText("Enter a valid workspace domain."),
    ).toBeInTheDocument()
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
  })

  it("opens complete plan and integration management screens", async () => {
    const user = userEvent.setup()
    render(<SettingsWorkspace view={await getWorkspaceSettings()} />)

    await user.click(screen.getByRole("button", { name: "Manage" }))
    const plan = screen.getByRole("dialog", { name: "Plan management" })
    expect(within(plan).getByText("8 / 10")).toBeInTheDocument()
    expect(within(plan).getByText(/Next invoice/)).toBeInTheDocument()
    await user.click(within(plan).getByRole("button", { name: "Done" }))

    await user.click(
      screen.getByRole("button", { name: /Repositories & data/ }),
    )
    await user.click(screen.getByRole("button", { name: "Add connection" }))
    const catalog = screen.getByRole("dialog", {
      name: "Integration catalog",
    })
    await user.click(
      within(catalog).getByRole("button", { name: "Add PagerDuty" }),
    )
    await user.click(within(catalog).getByRole("button", { name: "Done" }))

    expect(screen.getByText("PagerDuty")).toBeInTheDocument()
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
  })

  it("adds an invited member to pending settings", async () => {
    const user = userEvent.setup()
    render(<SettingsWorkspace view={await getWorkspaceSettings()} />)

    await user.click(screen.getByRole("button", { name: /Team & roles/ }))
    await user.click(screen.getByRole("button", { name: "Invite member" }))
    const dialog = screen.getByRole("dialog", {
      name: "Invite workspace member",
    })
    await user.type(
      within(dialog).getByRole("textbox", { name: "Work email" }),
      "sam.taylor@podo.dev",
    )
    await user.click(
      within(dialog).getByRole("combobox", { name: "Invitation role" }),
    )
    await user.click(screen.getByRole("option", { name: "Responder" }))
    await user.click(
      within(dialog).getByRole("button", { name: "Send invitation" }),
    )

    expect(screen.getByText("sam.taylor@podo.dev")).toBeInTheDocument()
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
  })
})
