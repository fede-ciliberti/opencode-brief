// opencode-brief — hook de razonamiento del brief.
//
// `session.generate` no acepta un parámetro de thinking: hereda el modelo y el
// variant de la sesión. La vía prevista para un request auxiliar es
// `session.hook("generate")`, que recibe el request mutable antes de armarlo
// (`SessionRequestKind` incluye "generate" justo para distinguirlo del loop
// principal). Todo lo que se escribe en `options` viaja como providerOptions:
// las claves tipadas van a `generation` y el resto, tal cual, al provider.
//
// Este módulo lo usa el entrypoint `./tui` cuando se lo carga sin renderer: el
// proceso del server importa el mismo archivo y le pasa el Context del server
// (con `session`, `shell`, `storage`…), no el de la TUI.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const LOG_FILE = process.env.OPENCODE_BRIEF_LOG ?? path.join(os.homedir(), ".local", "share", "opencode-brief", "brief.log")
/** Marca que el plugin agrega al prompt del brief para reconocer su request. */
export const MARKER = "<!-- opencode-brief -->"

/** Lo mínimo del Context del server que necesita este módulo. */
export interface ServerContext {
  readonly options?: Readonly<Record<string, any>>
  readonly session?: {
    hook(
      name: "generate",
      callback: (request: { messages: unknown; model: unknown; options: Record<string, any> }) => void,
      options?: { readonly providerID?: string },
    ): Promise<{ dispose: () => Promise<void> }>
  }
}

// Sólo longitudes y valores de esfuerzo: nunca el contenido del prompt ni del brief.
export function log(event: string, data: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`)
  } catch {}
}

/**
 * `thinking` en las opciones del plugin: `low` (default), `none`, `minimal`,
 * `medium`, `high`, `max`, o `inherit` para no tocar el request.
 */
function effortOf(options: Readonly<Record<string, any>> | undefined): string {
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

/** Registra el hook si el host expone el dominio de sesión. Devuelve el cleanup. */
export async function registerReasoningHook(context: ServerContext): Promise<(() => Promise<void>) | undefined> {
  if (!context?.session?.hook) {
    log("reasoning.skip", { reason: "no session domain" })
    return
  }

  const effort = effortOf(context.options)
  log("reasoning.init", { thinking: effort })
  if (effort === "inherit") return

  try {
    const registration = await context.session.hook("generate", (request) => {
      if (!mentionsBrief(request.messages)) {
        // Diagnóstico: si el brief no aparece acá, la marca no llega en los
        // mensajes y hay que aflojar el criterio de alcance.
        log("generate.skip", { messages: Array.isArray(request.messages) ? request.messages.length : null })
        return
      }
      // El provider openai-compatible lee `reasoningEffort` (camel) y arma
      // `reasoning_effort` en el body; la forma snake queda como respaldo para
      // las rutas que leen las opciones crudas.
      request.options.reasoningEffort = effort
      request.options.reasoning_effort = effort
      log("generate.hook", { effort, model: request.model })
    })
    return async () => {
      await registration.dispose()
    }
  } catch (error) {
    log("generate.hook.error", { error: error instanceof Error ? error.message : String(error) })
    return
  }
}
