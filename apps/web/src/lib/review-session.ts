import type { EditPlan } from "./edit-plan.ts"

export type CandidateStatus = "ready-for-review" | "selected" | "rendering" | "rendered" | "failed"

export type ReviewCandidate = {
  id: string
  title: string
  summary: string
  planPath: string
  thumbnailPath?: string
  status: CandidateStatus
  error?: string
  plan: EditPlan
  outputExists: boolean
}
export type ReviewSession = {
  version: "1"
  id: string
  title: string
  sourceAssets: Array<{ id: string; label: string; path: string }>
  candidates: ReviewCandidate[]
  selectedCandidateId?: string
  updatedAt: string
  approvalToken: string
}

export const candidateForSelection = (session: ReviewSession) =>
  session.candidates.find((candidate) => candidate.id === session.selectedCandidateId)

export const mediaAssetForPlan = (session: ReviewSession, plan: EditPlan) => {
  const video = plan.assets.find((asset) => asset.kind === "video")
  return session.sourceAssets.find((asset) => asset.id === video?.id || asset.path === video?.path)
}
