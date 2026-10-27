import { useEffect, useState } from "react"
import { Film, FolderOpen, Plus } from "lucide-react"
import { LocalMediaPicker } from "./local-media-picker.tsx"
import { Button } from "./ui/button.tsx"
import {
  projectRequest,
  type WorkspaceProject,
} from "#/lib/workspace-projects.ts"

export function ProjectsHome() {
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [mediaRoot, setMediaRoot] = useState("")
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [sourcePath, setSourcePath] = useState("")
  const [picking, setPicking] = useState(false)
  const [filePickerAvailable, setFilePickerAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<"full-project" | "clip-review">(
    "full-project",
  )
  useEffect(() => {
    const controller = new AbortController()
    projectRequest<{ projects: WorkspaceProject[]; mediaRoot: string; filePickerAvailable?: boolean }>(
      "",
      undefined,
      controller.signal,
    )
      .then((result) => {
        setProjects(result.projects)
        setMediaRoot(result.mediaRoot)
        setFilePickerAvailable(Boolean(result.filePickerAvailable))
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])
  async function create() {
    setBusy(true)
    setError(null)
    try {
      const project = await projectRequest<WorkspaceProject>("", {
        name,
        sourcePath,
      })
      window.location.assign(
        `/editor?project=${encodeURIComponent(project.id)}`,
      )
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not create project",
      )
      setBusy(false)
    }
  }
  return (
    <main className="dark min-h-screen bg-[#0c0d0f] text-zinc-100 [&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans">
      <header className="border-b border-white/10 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Film className="size-9 rounded-lg bg-amber-300 p-2 text-black" />
          <div>
            <p className="font-semibold">OpenCut</p>
            <p className="text-xs text-zinc-400">Your local video workspace</p>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-8 px-5 py-8">
        <div>
          <h1 className="text-3xl font-semibold">Your projects</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Edit a complete video, then create short clips from the same
            project.
          </p>
        </div>
        <section
          className="rounded-2xl border border-amber-300/20 bg-[#111214] p-5 sm:p-6"
          aria-label="New project"
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Plus className="size-5 text-amber-200" />
            Start a full-video project
          </h2>
          <form
            className="mt-4 grid items-end gap-3 md:grid-cols-[1fr_2fr_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <label className="text-xs text-zinc-400">
              Project name
              <input
                required
                maxLength={120}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
                placeholder="My next video"
                className="mt-2 block min-h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-sm text-white"
              />
            </label>
            <LocalMediaPicker label="Video file path" value={sourcePath} onChange={setSourcePath} purpose="video" available={filePickerAvailable} disabled={busy} onBusyChange={setPicking} placeholder={`${mediaRoot || "/your/media/folder"}/video.mp4`} />
            <Button
              type="submit"
              className="min-h-11 bg-amber-300 text-black hover:bg-amber-200"
              disabled={busy || picking || loading}
            >
              {busy ? "Opening video…" : "Create project"}
            </Button>
          </form>
          <p className="mt-3 break-words text-xs text-zinc-500">
            Use a video inside {mediaRoot || "your media folder"}. Large videos
            stay in place on this Mac.
          </p>
        </section>
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-300/25 bg-red-300/10 p-4 text-sm text-red-200"
          >
            {error}
          </p>
        ) : null}
        <section aria-label="Saved projects">
          <div className="mb-5 flex gap-2" aria-label="Project type">
            {(
              [
                ["full-project", "Main projects"],
                ["clip-review", "Clip reviews"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                className={`rounded-lg px-4 py-2 text-sm ${filter === value ? "bg-white/10 text-white" : "text-zinc-400"}`}
                onClick={() => setFilter(value)}
              >
                {label}{" "}
                <span className="ml-2 text-zinc-500">
                  {projects.filter((project) => project.kind === value).length}
                </span>
              </button>
            ))}
          </div>
          {loading ? (
            <p role="status" className="text-sm text-zinc-400">
              Loading projects…
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects
                .filter((project) => project.kind === filter)
                .map((project) => (
                  <article
                    key={project.id}
                    className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[#111214] p-5"
                  >
                    <FolderOpen className="size-7 text-amber-200" />
                    <h3 className="text-lg font-semibold">{project.name}</h3>
                    <p className="text-xs text-zinc-400">
                      {project.available === false
                        ? "Media unavailable — check the original folder"
                        : `${Math.floor((project.durationSeconds ?? 0) / 60)}m ${Math.round((project.durationSeconds ?? 0) % 60)}s · ${project.rendered ? "Final exported" : "Draft"}`}
                    </p>
                    <a
                      className="mt-auto rounded-lg border border-white/15 px-4 py-2 text-center text-sm hover:bg-white/10"
                      href={`/editor?project=${encodeURIComponent(project.id)}`}
                    >
                      Open{" "}
                      {project.kind === "full-project"
                        ? "project"
                        : "clip review"}
                    </a>
                  </article>
                ))}
              {!projects.some((project) => project.kind === filter) ? (
                <p className="text-sm text-zinc-500">
                  {filter === "full-project"
                    ? "Create your first main project above."
                    : "Clip reviews you open or create will appear here."}
                </p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
