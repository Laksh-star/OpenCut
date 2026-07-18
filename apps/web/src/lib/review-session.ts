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
export type ExportPackageCandidate = {
  candidateId: string
  title: string
  revision: number
  durationSeconds: number
  outputPath: string
  packagedOutputPath: string
  outputBytes: number
  approvedEditPlanPath?: string
  projectRecordPath?: string
  captionsPath?: string
  contactSheetPath?: string
}
export type ReviewExportPackage = {
  version: "1"
  id: string
  reviewSessionId: string
  title: string
  status: "created" | "partial"
  createdAt: string
  packagePath: string
  manifestPath: string
  summaryPath: string
  candidates: ExportPackageCandidate[]
  warnings: string[]
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
  exportPackages: ReviewExportPackage[]
  createdBy?: { agent?: string; model?: string }
  updatedAt: string
  approvalToken: string
}

export type PreflightSeverity = "pass" | "warn" | "block"
export type PreflightMode = "preview" | "final" | "batch" | "export"
export type PreflightCheck = {
  id: string
  severity: PreflightSeverity
  label: string
  detail: string
  candidateId?: string
  revision?: number
}
export type CandidatePreflight = {
  candidateId: string
  revision: number
  mode: PreflightMode
  eligible: boolean
  checks: PreflightCheck[]
  summary: Record<PreflightSeverity, number>
}
export type ReviewSessionPreflight = {
  checkedAt: string
  mode: PreflightMode
  renderLimitSeconds: number
  candidates: CandidatePreflight[]
  summary: Record<PreflightSeverity, number>
}

export const candidateForSelection = (session: ReviewSession) =>
  session.candidates.find((candidate) => candidate.id === session.selectedCandidateId)

export const mediaAssetForPlan = (session: ReviewSession, plan: EditPlan) => {
  const video = plan.assets.find((asset) => asset.kind === "video")
  return session.sourceAssets.find((asset) => asset.id === video?.id || asset.path === video?.path)
}

export const candidateHasCurrentPreview = (candidate: ReviewCandidate | undefined) =>
  Boolean(candidate?.previewExists && candidate.lastPreviewRevision === candidate.revision)
