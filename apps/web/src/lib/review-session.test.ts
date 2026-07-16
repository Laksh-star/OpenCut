import { describe, expect, test } from "vitest"
import { sampleEditPlan } from "./edit-plan.ts"
import { candidateForSelection, mediaAssetForPlan, type ReviewSession } from "./review-session.ts"

const session = {
  version: "1", id: "demo", title: "Demo", updatedAt: new Date().toISOString(), approvalToken: "token",
  selectedCandidateId: "one",
  sourceAssets: [{ id: "interview", label: "Interview", path: sampleEditPlan.assets[0]!.path }],
  candidates: [{ id: "one", title: "One", summary: "", planPath: "one/edit-plan.json", status: "selected", plan: sampleEditPlan, outputExists: false }],
} satisfies ReviewSession

describe("review session helpers", () => {
  test("resolves selected candidate and authorized media", () => {
    expect(candidateForSelection(session)?.id).toBe("one")
    expect(mediaAssetForPlan(session, sampleEditPlan)?.id).toBe("interview")
  })
})
