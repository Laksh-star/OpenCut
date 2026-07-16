export type CaptionCue = {
  start: number
  end: number
  text: string
}

function parseTimestamp(value: string) {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/)
  if (!match) return null
  const [, hours = "0", minutes, seconds, milliseconds] = match
  return (
    Number(hours) * 3_600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1_000
  )
}

export function parseCaptionFile(contents: string): CaptionCue[] {
  return contents
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
      const timingIndex = lines.findIndex((line) => line.includes("-->"))
      if (timingIndex === -1) return []

      const [rawStart, rawEndWithSettings] = lines[timingIndex].split("-->")
      const rawEnd = rawEndWithSettings?.trim().split(/\s+/)[0]
      const start = rawStart ? parseTimestamp(rawStart) : null
      const end = rawEnd ? parseTimestamp(rawEnd) : null
      const text = lines.slice(timingIndex + 1).join("\n")
      if (start === null || end === null || end <= start || !text) return []
      return [{ start, end, text }]
    })
    .sort((left, right) => left.start - right.start)
}
