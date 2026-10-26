// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { CandidateChoices, ReviewSteps } from "./review-workflow.tsx"
import { sampleEditPlan } from "#/lib/edit-plan.ts"
import type { ReviewCandidate } from "#/lib/review-session.ts"

afterEach(cleanup)
const candidate: ReviewCandidate = {
  id: "leadership",
  title: "Leading with AI",
  summary: "A distinct leadership moment",
  rationale: "Keeps the practical decision",
  strategy: "distinct-moment",
  clipRationales: [],
  planPath: "plan.json",
  status: "ready-for-review",
  revision: 1,
  plan: sampleEditPlan,
  previewExists: false,
  outputExists: false,
}

test("a project requires an explicit clip choice before Edit or Review", () => {
  const onChange = vi.fn()
  const { rerender } = render(
    <ReviewSteps
      stage="choose"
      hasSelection={false}
      locked={false}
      dirty={false}
      onChange={onChange}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "2 Edit" }))
  fireEvent.click(screen.getByRole("button", { name: "3 Review & export" }))
  expect(onChange).not.toHaveBeenCalled()
  rerender(
    <ReviewSteps
      stage="choose"
      hasSelection
      locked={false}
      dirty={false}
      onChange={onChange}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "2 Edit" }))
  expect(onChange).toHaveBeenCalledWith("edit")
})

test("unsaved changes prevent leaving for another clip; busy actions lock navigation", () => {
  const onChange = vi.fn()
  const { rerender } = render(
    <ReviewSteps
      stage="edit"
      hasSelection
      locked={false}
      dirty
      onChange={onChange}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "1 Choose clips" }))
  expect(onChange).not.toHaveBeenCalled()
  rerender(
    <ReviewSteps
      stage="review"
      hasSelection
      locked
      dirty={false}
      onChange={onChange}
    />,
  )
  for (const button of screen.getAllByRole("button")) fireEvent.click(button)
  expect(onChange).not.toHaveBeenCalled()
})

test("clip cards show editorial context and explicit selection without exposing render actions", () => {
  const onSelect = vi.fn()
  const { rerender } = render(
    <CandidateChoices
      candidates={[candidate]}
      disabled={false}
      onSelect={onSelect}
    />,
  )
  expect(screen.getByRole("heading", { name: candidate.title })).toBeTruthy()
  expect(screen.getByText(/seconds · 16:9/)).toBeTruthy()
  expect(screen.queryByRole("button", { name: /render/i })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Open clip" }))
  expect(onSelect).toHaveBeenCalledWith("leadership")
  onSelect.mockClear()
  rerender(
    <CandidateChoices candidates={[candidate]} disabled onSelect={onSelect} />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Open clip" }))
  expect(onSelect).not.toHaveBeenCalled()
})
