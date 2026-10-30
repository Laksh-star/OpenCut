export const bridgeUrl = (
  import.meta.env.VITE_OPENCUT_BRIDGE_URL ?? "http://127.0.0.1:3210"
).replace(/\/$/, "")
export type WorkspaceProject = {
  id: string
  name: string
  kind: "full-project" | "clip-review"
  manifestPath: string
  createdAt: string
  parentProjectId?: string
  updatedAt?: string
  durationSeconds?: number
  rendered?: boolean
  available?: boolean
}
export type ProjectMedia = {
  id: string
  path: string
  kind: "video" | "audio" | "captions"
  duration: number
  width: number
  height: number
  hasAudio: boolean
  stillImage: boolean
}
export async function projectRequest<T>(
  path: string,
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${bridgeUrl}/v1/workspace-projects${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal,
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      result.error ??
        "The local project service could not complete this action",
    )
  return result as T
}
