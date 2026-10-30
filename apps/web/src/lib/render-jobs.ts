export type RenderJob = {
  id: string
  candidateId: string
  revision: number
  mode: "preview" | "final"
  status:
    | "queued"
    | "running"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted"
  phase: "preparing" | "rendering" | "publishing"
  message: string
  createdAt: string
  updatedAt: string
  finishedAt?: string
  percent: number | null
  renderedSeconds: number
  totalSeconds: number
  error?: string
  details?: string
}
export const renderJobActive = (job: RenderJob) =>
  ["queued", "running", "cancelling"].includes(job.status)
