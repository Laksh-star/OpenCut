import { createFileRoute } from "@tanstack/react-router"
import { ProjectEditor } from "#/components/project-editor.tsx"
export const Route = createFileRoute("/editor")({ component: ProjectEditor })
