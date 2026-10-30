import { useEffect, useState } from "react"
import {
  projectRequest,
  type WorkspaceProject,
} from "#/lib/workspace-projects.ts"
import { AgentReviewWorkspace } from "./review-workspace.tsx"

export function ProjectEditor() {
  const [project, setProject] = useState<WorkspaceProject | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const id = new URLSearchParams(window.location.search).get("project")
    if (!id) {
      setError("Choose a project from your projects home.")
      return
    }
    projectRequest<{ project: WorkspaceProject; sessionId: string }>(
      `/${encodeURIComponent(id)}/open`,
      {},
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.project.kind === "clip-review") {
          window.location.replace(
            `/?session=${encodeURIComponent(result.sessionId)}`,
          )
          return
        }
        const url = new URL(window.location.href)
        url.searchParams.set("session", result.sessionId)
        window.history.replaceState(null, "", url)
        setProject(result.project)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message)
      })
    return () => controller.abort()
  }, [])
  if (project) return <AgentReviewWorkspace project={project} />
  return (
    <main className="dark min-h-screen bg-[#0c0d0f] p-8 text-zinc-200">
      <a href="/" className="text-sm text-amber-200">
        ← Projects
      </a>
      <p role={error ? "alert" : "status"} className="mt-8">
        {error ?? "Opening your project…"}
      </p>
    </main>
  )
}
