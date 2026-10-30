import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { AgentReviewWorkspace } from "#/components/review-workspace.tsx"
import { ProjectsHome } from "#/components/projects-home.tsx"
export const Route = createFileRoute("/")({ component: Home })
function Home() {
  const [view, setView] = useState<"loading" | "projects" | "review">("loading")
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search)
    setView(
      parameters.has("session") || parameters.has("plan")
        ? "review"
        : "projects",
    )
  }, [])
  return view === "review" ? (
    <AgentReviewWorkspace />
  ) : view === "projects" ? (
    <ProjectsHome />
  ) : (
    <main className="min-h-screen bg-[#0c0d0f] p-8 text-zinc-200" role="status">
      Opening OpenCut…
    </main>
  )
}
