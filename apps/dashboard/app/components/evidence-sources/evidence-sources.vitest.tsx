import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adaptEvidenceSource } from "../../lib/evidence-sources-data"
import type { EvidenceSourcesController } from "../../lib/evidence-source-types"
import { evidenceSourceRecordsMock } from "../../mocks/evidence-sources"
import { EvidenceSources } from "./evidence-sources"

vi.mock("next/navigation", () => ({
  usePathname: () => "/evidence-sources",
}))

const model = {
  owner: { name: "Maya Chen", avatar: "/maya-chen.jpg" },
  generatedAt: "Updated just now",
  sources: evidenceSourceRecordsMock.map(adaptEvidenceSource),
}

describe("EvidenceSources", () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it("filters the catalog by connection status and category", async () => {
    const user = userEvent.setup()
    render(<EvidenceSources model={model} />)

    await user.click(screen.getByRole("tab", { name: /Needs attention/ }))

    expect(
      screen.getByRole("button", { name: /^Inspect GitHub Actions\b/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Inspect Datadog\b/ }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: /All sources/ }))
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by category" }),
      "Cloud",
    )

    expect(
      screen.getByRole("button", { name: /^Inspect Google Cloud\b/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Inspect GitHub\b/ }),
    ).not.toBeInTheDocument()
  })

  it("searches source capabilities from the shared topbar", async () => {
    const user = userEvent.setup()
    render(<EvidenceSources model={model} />)

    await user.type(
      screen.getByRole("searchbox", { name: "Search evidence sources" }),
      "stack traces",
    )

    expect(
      screen.getByRole("button", { name: /^Inspect Sentry\b/ }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(1)
  })

  it("connects an available source from its detail inspector", async () => {
    const user = userEvent.setup()
    render(<EvidenceSources model={model} />)

    await user.click(screen.getByRole("button", { name: /^Inspect Sentry\b/ }))
    expect(
      screen.getByRole("complementary", { name: "Sentry details" }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Connect source" }))

    expect(
      screen.getByRole("button", { name: "Manage connection" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sentry connected to the evidence pipeline",
    )
  })

  it("fails closed when the connection controller rejects the mutation", async () => {
    const user = userEvent.setup()
    const updateConnection = vi
      .fn<EvidenceSourcesController["updateConnection"]>()
      .mockRejectedValue(new Error("Connector authorization expired"))
    render(<EvidenceSources controller={{ updateConnection }} model={model} />)

    await user.click(screen.getByRole("button", { name: /^Inspect Sentry\b/ }))
    await user.click(screen.getByRole("button", { name: "Connect source" }))

    expect(updateConnection).toHaveBeenCalledWith({
      sourceId: "sentry-catalog",
      action: "connect",
      expectedStatus: "Available",
    })
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connector authorization expired",
    )
    expect(
      screen.getByRole("button", { name: "Connect source" }),
    ).toBeInTheDocument()
  })

  it("offers a useful reset when no connectors match", async () => {
    const user = userEvent.setup()
    render(<EvidenceSources model={model} />)

    await user.type(
      screen.getByRole("searchbox", { name: "Search evidence sources" }),
      "no-such-connector",
    )

    expect(screen.getByText("No sources match these filters")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Reset filters" }))
    expect(
      screen.getByRole("button", { name: /^Inspect Datadog\b/ }),
    ).toBeInTheDocument()
  })
})
