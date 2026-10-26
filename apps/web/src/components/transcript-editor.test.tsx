// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { fireEvent, getByRole, queryByRole, waitFor } from "@testing-library/dom"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { TranscriptEditor } from "./transcript-editor.tsx"
import { sampleEditPlan } from "#/lib/edit-plan.ts"

let container: HTMLDivElement
let root: Root
const onSaved = vi.fn()
const onSeek = vi.fn()
const proposal = { proposalId: "opaque-proposal", revision: 1, beforeSeconds: 60, afterSeconds: 20, changes: ["Keep the first 20 seconds"], warnings: ["Check the ending"], plan: sampleEditPlan, captions: [], spans: [], operation: { type: "shorten", seconds: 20 } }

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(proposal))))
  await act(async () => root.render(<TranscriptEditor bridgeUrl="http://localhost:3210" sessionId="session" candidateId="candidate" revision={1} approvalToken="token" plan={sampleEditPlan}
    cues={[{ start: 0, end: 2, text: "An important answer" }]} selectedClipId="fire-analogy" disabled={false} onSeek={onSeek} onSaved={onSaved} onBusyChange={() => {}} />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

test("seeking and selecting passages do not save or render anything", async () => {
  await act(async () => {
    fireEvent.click(getByRole(container, "button", { name: /An important answer/ }))
    fireEvent.click(getByRole(container, "checkbox", { name: "Select passage 1" }))
  })
  expect(onSeek).toHaveBeenCalledWith(0)
  expect(fetch).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

test("unsupported commands show guidance without submitting an edit", async () => {
  await act(async () => fireEvent.input(getByRole(container, "textbox"), { target: { value: "make it viral" } }))
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "Propose edit" })))
  expect(getByRole(container, "alert").textContent).toContain("Try")
  expect(fetch).not.toHaveBeenCalled()
})

test("a proposal displays changes and warnings; saving is a separate request", async () => {
  await act(async () => fireEvent.input(getByRole(container, "textbox"), { target: { value: "shorten this to 20 seconds" } }))
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "Propose edit" })))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain("Check the ending")
  expect(onSaved).not.toHaveBeenCalled()
  const request = vi.mocked(fetch).mock.calls[0]!
  expect(String(request[0])).toContain("/edits/propose")
  expect(JSON.parse(String(request[1]?.body))).toMatchObject({ expectedRevision: 1, operation: { type: "shorten", seconds: 20 } })
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ version: "1", id: "saved-session" })))
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "Save proposal as r2" })))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  expect(String(vi.mocked(fetch).mock.calls[1]![0])).toContain("/edits/apply")
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes("render"))).toBe(true)
})

test("changing the command discards the old proposal", async () => {
  await act(async () => fireEvent.input(getByRole(container, "textbox"), { target: { value: "shorten this to 20 seconds" } }))
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "Propose edit" })))
  expect(getByRole(container, "button", { name: "Save proposal as r2" })).toBeTruthy()
  await act(async () => fireEvent.input(getByRole(container, "textbox"), { target: { value: "shorten this to 30 seconds" } }))
  expect(queryByRole(container, "button", { name: "Save proposal as r2" })).toBeNull()
})
