// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { LocalMediaPicker } from "./local-media-picker.tsx"
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
test("Browse selects a local path without importing, rendering or uploading", async () => {
  const path = "/media/Speaker's video ü.mp4"
  const onChange = vi.fn()
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ cancelled: false, path })),
      ),
  )
  render(
    <LocalMediaPicker
      label="Video file path"
      value=""
      onChange={onChange}
      available
      purpose="video"
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Browse…" }))
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(path))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("/pick-media")
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({
    purpose: "video",
  })
})
test("chooser cancellation keeps the current path and still allows manual entry", async () => {
  const onChange = vi.fn()
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ cancelled: true, path: null })),
      ),
  )
  render(
    <LocalMediaPicker
      label="Video file path"
      value="/media/original.mp4"
      onChange={onChange}
      available
      purpose="video"
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Browse…" }))
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Browse…" })).toBeTruthy(),
  )
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "/media/other.mp4" },
  })
  expect(onChange).toHaveBeenCalledWith("/media/other.mp4")
})
test("a chooser error explains recovery without replacing the existing path", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: "Choose a file inside the media folder" }),
          { status: 400 },
        ),
      ),
  )
  const onChange = vi.fn()
  render(
    <LocalMediaPicker
      label="Local file path"
      value="/media/keep.mp4"
      onChange={onChange}
      available
      purpose="music"
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Browse…" }))
  await screen.findByRole("alert")
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByRole("textbox").getAttribute("value")).toBe(
    "/media/keep.mp4",
  )
})
