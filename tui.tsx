// opencode-brief — plugin de TUI: /brief abre un panel con el brief ejecutivo
// de la sesión. Una sola llamada al modelo, sin tocar el historial.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import type { SessionMessageInfo } from "@opencode/client"

const SKILL_PATH = path.join(os.homedir(), ".config", "opencode", "skills", "brief", "SKILL.md")
const MAX_TRANSCRIPT_CHARS = 40_000
const MODE = "opencode-brief"

const FALLBACK = `Sos un asistente que resume el estado de una sesión de trabajo para alguien que tiene 40 segundos.
Devolvé exactamente estas secciones, omitiendo las que queden vacías:
Hecho — 2 a 5 bullets de resultados, no de actividades.
Estado — una o dos líneas: dónde está parado el trabajo ahora.
Sigue — pasos concretos, en orden de ejecución.
Decisiones y bloqueos — sólo si existen.
Lenguaje de usuario: resultados y consecuencias, sin rutas de archivos, nombres de funciones ni jerga técnica. Máximo 15 líneas.`

// El texto vive en la skill para no duplicarlo: el panel y el comando /brief
// en el chat comparten las mismas reglas.
function instructions(): string {
  try {
    const raw = fs.readFileSync(SKILL_PATH, "utf8")
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim()
    return body || FALLBACK
  } catch {
    return FALLBACK
  }
}

type ModelRefValue = { id: string; providerID: string; variant?: string }

function modelOption(context: Context): ModelRefValue | undefined {
  const raw = context.options?.model
  if (!raw) return undefined
  if (typeof raw === "string") {
    const [providerID, id, variant] = raw.split("/")
    if (!providerID || !id) return undefined
    return variant ? { providerID, id, variant } : { providerID, id }
  }
  if (typeof raw === "object" && typeof raw.id === "string" && typeof raw.providerID === "string") {
    return raw.variant ? { id: raw.id, providerID: raw.providerID, variant: raw.variant } : { id: raw.id, providerID: raw.providerID }
  }
  return undefined
}

// Camino alternativo: `generate.text` acepta modelo pero no ve la sesión, así
// que hay que mandarle la transcripción como texto.
function assistantText(message: SessionMessageInfo): string {
  if (message.type !== "assistant") return ""
  const parts: Array<{ type?: string; text?: string }> = message.content
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
}

function transcript(context: Context, sessionID: string): string {
  const messages = context.data.session.message.list(sessionID) ?? []
  const chunks: string[] = []
  for (const message of messages) {
    if (message.type === "user") {
      chunks.push(`Usuario: ${message.text}`)
    } else if (message.type === "assistant") {
      const text = assistantText(message)
      if (text) chunks.push(`Asistente: ${text}`)
    }
  }
  const joined = chunks.join("\n\n")
  return joined.length > MAX_TRANSCRIPT_CHARS ? joined.slice(-MAX_TRANSCRIPT_CHARS) : joined
}

function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1")
}

function Panel(props: { title: string; text: string; theme: Context["theme"] }) {
  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      <text fg={props.theme.text.muted}>{props.title}</text>
      <text fg={props.theme.text.base}>{props.text}</text>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-brief",
  setup(context) {
    // El server también carga este entrypoint, sin renderer: no hay nada que hacer ahí.
    if (!context?.renderer) return

    let last: string | null = null
    let popMode: (() => void) | null = null

    function copy(text: string) {
      const ok = context.renderer.copyToClipboardOSC52?.(text) === true
      context.ui.toast.show({
        message: ok ? "Brief copiado" : "No se pudo copiar (la terminal no soporta OSC52)",
        variant: ok ? "success" : "warning",
      })
    }

    async function show(focus: string) {
      const route = context.ui.router.current()
      if (route?.type !== "session") {
        context.ui.toast.show({ message: "Abrí una sesión primero", variant: "warning" })
        return
      }

      const prompt = [
        instructions(),
        focus ? `Foco: ${focus}` : "",
        "Respondé sólo con el brief, sin preámbulo ni meta-comentario.",
      ]
        .filter(Boolean)
        .join("\n\n")

      const model = modelOption(context)
      context.ui.toast.show({ title: "brief", message: "Generando…", duration: 1500 })

      let text = ""
      try {
        if (model) {
          const body = transcript(context, route.sessionID)
          const result = await context.client.generate.text({
            prompt: `${prompt}\n\n--- TRANSCRIPCIÓN DE LA SESIÓN ---\n${body}`,
            model,
          })
          text = result.text.trim()
        } else {
          const result = await context.client.session.generate({ sessionID: route.sessionID, prompt })
          text = result.text.trim()
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        context.ui.toast.show({ message: `No se pudo generar el brief: ${message}`, variant: "error" })
        return
      }

      if (!text) {
        context.ui.toast.show({ message: "El brief vino vacío", variant: "warning" })
        return
      }

      last = plain(text)
      popMode?.()
      popMode = context.keymap.mode.push(MODE)
      context.ui.dialog.set({ size: "large", centered: true })
      context.ui.dialog.show(
        () => <Panel title={focus ? `/brief ${focus}` : "/brief"} text={last ?? ""} theme={context.theme} />,
        () => {
          last = null
          popMode?.()
          popMode = null
        },
      )
    }

    // Modo propio: sólo mientras el panel está abierto, `c` copia y `escape` cierra.
    context.keymap.layer(() => ({
      mode: MODE,
      commands: [
        {
          id: "brief.copy",
          title: "Copiar brief",
          bind: "c",
          run: () => {
            if (!last) return false
            copy(last)
          },
        },
        {
          id: "brief.close",
          title: "Cerrar brief",
          bind: "escape",
          run: () => context.ui.dialog.clear(),
        },
      ],
    }))

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "brief.show",
          title: "Brief ejecutivo de la sesión",
          description: "Resumen de lo hecho y lo que sigue, en un panel",
          group: "Session",
          palette: true,
          slash: { name: "brief", arguments: true },
          run: (input) => show(input ?? ""),
        },
      ],
    }))
  },
})
