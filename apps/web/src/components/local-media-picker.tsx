import { useEffect, useRef, useState } from "react"
import { Button } from "./ui/button.tsx"
import { projectRequest } from "#/lib/workspace-projects.ts"
import type { ImportPurpose } from "#/lib/project-editing.ts"

type Props = {
  label: string
  value: string
  onChange: (path: string) => void
  purpose: ImportPurpose
  available: boolean
  disabled?: boolean
  placeholder?: string
  onBusyChange?: (busy: boolean) => void
}
export function LocalMediaPicker({
  label,
  value,
  onChange,
  purpose,
  available,
  disabled,
  placeholder,
  onBusyChange,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function browse() {
    if (busy || disabled) return
    setBusy(true)
    setError(null)
    onBusyChange?.(true)
    try {
      const result = await projectRequest<{
        cancelled: boolean
        path: string | null
      }>("/pick-media", { purpose })
      if (mounted.current && result.path) onChange(result.path)
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "Could not open the file chooser",
        )
    } finally {
      if (mounted.current) {
        setBusy(false)
        onBusyChange?.(false)
      }
    }
  }
  return (
    <div className="min-w-0 flex-1">
      <label className="block text-xs text-zinc-400">
        {label}
        <input
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || busy}
          placeholder={placeholder}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-sm text-white"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {available ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-9"
            disabled={disabled || busy}
            onClick={() => void browse()}
          >
            {busy ? "File chooser open…" : "Browse…"}
          </Button>
        ) : null}
        <span className="text-xs text-zinc-500">
          {available
            ? "Choose a file or paste its path. No upload or copy."
            : "Paste a local path. Native Browse is available on macOS."}
        </span>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  )
}
