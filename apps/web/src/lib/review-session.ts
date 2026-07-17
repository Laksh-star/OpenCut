import type { EditPlan } from "./edit-plan.ts"

export type CandidateStatus =
  | "ready-for-review"
  | "selected"
  | "previewing"
  | "preview-ready"
  | "queued"
  | "rendering"
  | "rendered"
  | "failed"

export type ReviewCandidate = {
  id: string
  title: string
  summary: string
  planPath: string
  thumbnailPath?: string
  status: CandidateStatus
  revision: number
  lastPreviewRevision?: number
  previewOutputPath?: string
  error?: string
  plan: EditPlan
  outputExists: boolean
  previewExists: boolean
}
export type ReviewerNote = {
  id: string
  candidateId: string
  revision: number
  text: string
  createdAt: string
}
export type ReviewEvent = {
  id: string
  type: string
  at: string
  candidateId?: string
  revision?: number
  actor: "reviewer" | "agent" | "system"
  detail?: string
}
export type RenderBatchItem = {
  candidateId: string
  revision: number
  status: "queued" | "rendering" | "rendered" | "failed"
  outputPath?: string
  error?: string
}
export type RenderBatch = {
  id: string
  status: "queued" | "rendering" | "completed" | "partial" | "failed"
  requestedAt: string
  completedAt?: string
  items: RenderBatchItem[]
}
export type ReviewSession = {
  version: "1"
  id: string
  title: string
  sourceAssets: Array<{ id: string; label: string; path: string }>
  candidates: ReviewCandidate[]
  selectedCandidateId?: string
  reviewerNotes: ReviewerNote[]
  events: ReviewEvent[]
  renderBatches: RenderBatch[]
  createdBy?: { agent?: string; model?: string }
  updatedAt: string
  approvalToken: string
}

export const candidateForSelection = (session: ReviewSession) =>
  session.candidates.find((candidate) => candidate.id === session.selectedCandidateId)

export const mediaAssetForPlan = (session: ReviewSession, plan: EditPlan) => {
  const video = plan.assets.find((asset) => asset.kind === "video")
  return session.sourceAssets.find((asset) => asset.id === video?.id || asset.path === video?.path)
}

export const candidateHasCurrentPreview = (candidate: ReviewCandidate | undefined) =>
  Boolean(candidate?.previewExists && candidate.lastPreviewRevision === candidate.revision)
