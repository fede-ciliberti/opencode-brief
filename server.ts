// opencode-brief — lado server: baja el esfuerzo de razonamiento de la
// generación transitoria del brief sin tocar los turnos de la sesión.
//
// `session.generate` no acepta un parámetro de thinking: hereda el modelo y el
// variant de la sesión. La vía prevista para un request auxiliar es el hook
// `session.hook("generate")`, que recibe el request mutable antes de armarlo
// (`SessionRequestKind` incluye "generate" justo para distinguirlo del loop
// principal). Todo lo que se escribe en `options` viaja como providerOptions:
// las claves tipadas van a `generation` y el resto, tal cual, al provider.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Plugin } from "@opencode/plugin"

const LOG_DIR = path.join(os.homedir(), ".local", "share", "opencode-brief")
const LOG_FILE = path.join(LOG_DIR, "brief.log")
/** Marca que el plugin de TUI agrega al prompt del brief. Misma constante en tui.tsx. */
const MARKER = "<!-- opencode-brief -->"

// Sólo longitudes y valores de esfuerzo: nunca el contenido del prompt ni del brief.
function log(event: string, data: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`)
  } catch {}
}

/**
 * `thinking` en las opciones del plugin: `low` (default), `none`, `minimal`,
 * `medium`, `high`, `max`, o `inherit` para no tocar el request.
 */
function effortOf(options: Record<string, any>): string {
  const raw = options?.thinking
  if (raw === undefined || raw === null || raw === true) return "low"
  if (raw === false) return "inherit"
  return String(raw)
}

/** El hook se aplica sólo al request del brief, no a cualquier generate de la sesión. */
function mentionsBrief(messages: unknown): boolean {
  try {
    const tail = Array.isArray(messages) ? messages.slice(-2) : messages
    return JSON.stringify(tail ?? "").includes(MARKER)
  } catch {
    return false
  }
}

export default Plugin.define({
  id: "opencode-brief-server",
  async setup(context) {
    // Este entry también puede resolverse en el proceso de la TUI, donde no
    // existe el dominio de sesión: ahí no hay nada que registrar.
    if (!context?.session?.hook) {
      log("server.skip", { reason: "no session domain" })
      return
    }

    const effort = effortOf(context.options)
    log("server.init", { thinking: effort })
    if (effort === "inherit") return

    const registrations: Array<{ dispose: () => Promise<void> }> = []
    try {
      registrations.push(
        await context.session.hook("generate", (request) => {
          if (!mentionsBrief(request.messages)) {
            // Diagnóstico: si el brief no aparece acá, la marca no está llegando
            // en los mensajes y hay que aflojar el criterio de alcance.
            log("generate.hook.skip", { messages: request.messages.length })
            return
          }
          // El provider openai-compatible lee `reasoningEffort` (camel) y arma
          // `reasoning_effort` en el body; la forma snake queda como respaldo
          // para las rutas que leen las opciones crudas.
          request.options.reasoningEffort = effort
          request.options.reasoning_effort = effort
          log("generate.hook", { effort, model: request.model })
        }),
      )
    } catch (error) {
      log("generate.hook.error", { error: error instanceof Error ? error.message : String(error) })
    }

    return async () => {
      for (const registration of registrations) await registration.dispose()
    }
  },
})
