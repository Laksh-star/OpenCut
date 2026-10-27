// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { RenderProgressPanel } from "./render-progress.tsx"
import type { RenderJob } from "#/lib/render-jobs.ts"
afterEach(cleanup)
const job: RenderJob = {
  id: "job",
  candidateId: "master",
  revision: 1,
  mode: "preview",
  status: "running",
  phase: "rendering",
  message: "Rendering video…",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  percent: 50,
  renderedSeconds: 30,
  totalSeconds: 60,
}
test("live progress exposes the actual percentage and a separate cancel action", () => {
  const onCancel = vi.fn()
  render(
    <RenderProgressPanel job={job} cancelling={false} onCancel={onCancel} />,
  )
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "50",
  )
  expect(onCancel).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Cancel render" }))
  expect(onCancel).toHaveBeenCalledOnce()
})
test("publishing cannot be cancelled and preparing does not claim a percentage", () => {
  const onCancel = vi.fn()
  const { rerender } = render(
    <RenderProgressPanel
      job={{ ...job, phase: "publishing", percent: 99 }}
      cancelling={false}
      onCancel={onCancel}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Finishing export…" }))
  expect(onCancel).not.toHaveBeenCalled()
  rerender(
    <RenderProgressPanel
      job={{ ...job, phase: "preparing", percent: null }}
      cancelling={false}
      onCancel={onCancel}
    />,
  )
  expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(
    false,
  )
})
