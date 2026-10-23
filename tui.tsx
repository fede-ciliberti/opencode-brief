// opencode-brief — plugin de TUI: /brief abre el brief ejecutivo de la sesión
// en el mismo diálogo que usa el /btw nativo: `dialog.show` + `dialog.set`
// (en ese orden), capa de teclas en modo "modal" registrada por el componente
// y marco del diálogo con los mismos inset y colores del host.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createSignal } from "solid-js"
import { SyntaxStyle } from "@opentui/core"
import type { ThemeTokenStyle } from "@opentui/core"
import type { ScrollBoxRenderable } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import type { SessionMessageInfo } from "@opencode/client"

const SKILL_PATH = path.join(os.homedir(), ".config", "opencode", "skills", "brief", "SKILL.md")
const LOG_DIR = path.join(os.homedir(), ".local", "share", "opencode-brief")
const LOG_FILE = path.join(LOG_DIR, "brief.log")
const MAX_TRANSCRIPT_CHARS = 40_000
/** Inset lateral del diálogo nativo (bf en el host): padding de cabecera y sangría del cuerpo. */
const INSET = 3
/** Marca que el server hook usa para reconocer el request del brief. Misma constante en server.ts. */
const MARKER = "<!-- opencode-brief -->"

// Sólo longitudes y resultado: nunca el contenido del prompt ni del brief.
function log(event: string, data: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`)
  } catch {}
}

const FALLBACK = `Sos un asistente que resume el estado de una sesión de trabajo para alguien que tiene 40 segundos.
Devolvé exactamente estas secciones, omitiendo las que queden vacías:
**Hecho** — 2 a 5 bullets de resultados, no de actividades.
**Estado** — una o dos líneas: dónde está parado el trabajo ahora.
**Sigue** — pasos concretos, en orden de ejecución.
**Decisiones y bloqueos** — sólo si existen.
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
    // `provider/modelo#variant` (documentado) y `provider/modelo/variant`.
    const [head, hashed] = raw.split("#")
    const segments = head.split("/")
    const [providerID, id] = segments
    const variant = hashed || segments[2]
    if (!providerID || !id) return undefined
    return variant ? { providerID, id, variant } : { providerID, id }
  }
  if (typeof raw === "object" && typeof raw.id === "string" && typeof raw.providerID === "string") {
    return raw.variant ? { id: raw.id, providerID: raw.providerID, variant: raw.variant } : { id: raw.id, providerID: raw.providerID }
  }
  return undefined
}

function assistantText(message: SessionMessageInfo): string {
  if (message.type !== "assistant") return ""
  const parts: Array<{ type?: string; text?: string }> = message.content
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
}

// Camino alternativo: `generate.text` acepta modelo pero no ve la sesión, así
// que hay que mandarle la transcripción como texto. La caché de la TUI guarda
// sólo una ventana de mensajes: se pide una página más grande al server y se
// cae a la caché si la llamada falla.
async function transcript(context: Context, sessionID: string): Promise<string> {
  let messages: SessionMessageInfo[] = []
  try {
    const response = await context.client.message.list({ sessionID, limit: 200, order: "desc" })
    messages = [...response.data].reverse()
  } catch (error) {
    log("transcript.cache", { error: error instanceof Error ? error.message : String(error) })
    messages = context.data.session.message.list(sessionID) ?? []
  }

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
  log("transcript", { messages: messages.length, chunks: chunks.length, chars: joined.length })
  return joined.length > MAX_TRANSCRIPT_CHARS ? joined.slice(-MAX_TRANSCRIPT_CHARS) : joined
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Mismo mapeo de scopes que usa el host para el markdown (`generateSyntax` de
// @opencode/theme), limitado a lo que puede traer un brief: markdown y los
// tokens de los bloques de código. Sin esto el panel renderiza la estructura
// pero los encabezados y el énfasis salen planos.
function syntaxStyle(theme: Context["theme"], owner: Parameters<typeof SyntaxStyle.fromTheme>[1]): SyntaxStyle {
  const markdown = theme.markdown
  const syntax = theme.syntax
  const rules: Array<ThemeTokenStyle> = [
    { scope: ["default"], style: { foreground: theme.text.base } },
    { scope: ["comment", "comment.documentation"], style: { foreground: syntax.comment, italic: true } },
    { scope: ["string", "symbol", "character"], style: { foreground: syntax.string } },
    { scope: ["number", "boolean", "constant", "float"], style: { foreground: syntax.number } },
    { scope: ["keyword"], style: { foreground: syntax.keyword, italic: true } },
    { scope: ["function", "function.call", "function.method"], style: { foreground: syntax.function } },
    { scope: ["type", "class", "namespace", "module"], style: { foreground: syntax.type } },
    { scope: ["variable", "variable.parameter", "property", "field", "parameter"], style: { foreground: syntax.variable } },
    {
      scope: ["operator", "punctuation", "punctuation.bracket", "punctuation.delimiter"],
      style: { foreground: syntax.operator },
    },
    {
      scope: ["markup.heading", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"],
      style: { foreground: markdown.heading, bold: true },
    },
    { scope: ["markup.heading.1"], style: { foreground: markdown.heading, bold: true, underline: true } },
    { scope: ["markup.bold", "markup.strong"], style: { foreground: markdown.strong, bold: true } },
    { scope: ["markup.italic"], style: { foreground: markdown.emphasis, italic: true } },
    { scope: ["markup.list"], style: { foreground: markdown.listItem } },
    { scope: ["markup.quote"], style: { foreground: markdown.blockQuote, italic: true } },
    { scope: ["markup.raw", "markup.raw.block"], style: { foreground: markdown.code } },
    { scope: ["markup.raw.inline"], style: { foreground: markdown.code, background: theme.background.base } },
    {
      scope: ["markup.link", "markup.link.url", "string.special", "string.special.url"],
      style: { foreground: markdown.link, underline: true },
    },
    { scope: ["markup.link.label"], style: { foreground: markdown.linkText, underline: true } },
    { scope: ["label"], style: { foreground: markdown.linkText } },
  ]
  return SyntaxStyle.fromTheme(rules, owner)
}


function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1")
}

// Mismo esqueleto que el diálogo del /btw: cabecera con título y la pista de
// cierre, cuerpo con el markdown sobre la superficie elevada y pie con las
// acciones. La capa de teclas vive acá y muere con el componente.
function Panel(props: {
  context: Context
  note: string
  answer: string
  style: SyntaxStyle
}) {
  const theme = props.context.theme
  const surface = theme.surface("dialog")
  const [copied, setCopied] = createSignal(false)
  let scroll: ScrollBoxRenderable | null = null

  const page = () => Math.max(8, Math.floor(props.context.renderer.height * 0.6))

  function copy() {
    const ok = props.context.renderer.copyToClipboardOSC52?.(plain(props.answer)) === true
    if (ok) {
      setCopied(true)
      return
    }
    props.context.ui.toast.show({
      message: "No se pudo copiar (la terminal no soporta OSC52)",
      variant: "warning",
    })
  }

  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { id: "brief.copy", title: "Copiar brief", group: "Dialog", bind: "c", run: () => copy() },
      { id: "brief.up", title: "Subir", group: "Dialog", bind: "k", run: () => scroll?.scrollBy(-1) },
      { id: "brief.down", title: "Bajar", group: "Dialog", bind: "j", run: () => scroll?.scrollBy(1) },
      { id: "brief.up.arrow", title: "Subir", group: "Dialog", bind: "up", run: () => scroll?.scrollBy(-1) },
      { id: "brief.down.arrow", title: "Bajar", group: "Dialog", bind: "down", run: () => scroll?.scrollBy(1) },
      { id: "brief.pageup", title: "Página arriba", group: "Dialog", bind: "pageup", run: () => scroll?.scrollBy(-page()) },
      { id: "brief.pagedown", title: "Página abajo", group: "Dialog", bind: "pagedown", run: () => scroll?.scrollBy(page()) },
      { id: "brief.home", title: "Ir al inicio", group: "Dialog", bind: "home", run: () => scroll?.scrollTo(0) },
      { id: "brief.end", title: "Ir al final", group: "Dialog", bind: "end", run: () => scroll?.scrollTo(scroll.scrollHeight) },
    ],
  }))

  return (
    <box flexDirection="column" paddingLeft={INSET} paddingRight={INSET} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={2} flexShrink={0}>
        <box flexDirection="row" gap={2} flexShrink={1} minWidth={0}>
          <text fg={surface.text.base} flexShrink={0}>
            <strong>/brief</strong>
          </text>
          <text fg={surface.text.muted} wrapMode="none" truncate flexGrow={1}>
            {props.note}
          </text>
        </box>
        <text fg={surface.text.muted} flexShrink={0}>
          esc
        </text>
      </box>
      <box marginLeft={-INSET} marginRight={-INSET} minHeight={0} flexGrow={1}>
        <scrollbox
          ref={(el: ScrollBoxRenderable | null) => {
            scroll = el
          }}
          maxHeight={page()}
          backgroundColor={theme.background.raised.high}
          contentOptions={{ minHeight: 0 }}
          scrollbarOptions={{ visible: false }}
        >
          <box paddingLeft={INSET} paddingRight={INSET} paddingTop={1} paddingBottom={1}>
            <markdown
              content={props.answer}
              syntaxStyle={props.style}
              conceal
              internalBlockMode="top-level"
              tableOptions={{ style: "grid", cellPaddingX: 1 }}
              fg={theme.markdown.text}
              bg={theme.background.raised.high}
            />
          </box>
        </scrollbox>
      </box>
      <box
        flexDirection="row"
        justifyContent="space-between"
        backgroundColor={surface.background.raised.high}
        paddingLeft={INSET - 1}
        paddingRight={INSET - 1}
        flexShrink={0}
      >
        <text fg={surface.text.faint} wrapMode="none" flexShrink={0}>
          {copied() ? "✓ copiado c" : "copiar c"}
        </text>
        <text fg={surface.text.faint} wrapMode="none" flexShrink={0}>
          scroll j/k ↑/↓
        </text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-brief",
  setup(context) {
    // El server también carga este entrypoint, sin renderer: no hay nada que hacer ahí.
    if (!context?.renderer) return

    // Contador de briefs en vuelo: el host muestra el indicador del pie del
    // prompt mientras haya trabajo, igual que el /btw nativo.
    const [pending, setPending] = createSignal(0)

    // Camino stateless: no depende del estado de la sesión, pero hay que
    // mandarle la transcripción como texto.
    async function stateless(prompt: string, model?: ModelRefValue): Promise<string> {
      const result = await context.client.generate.text(model ? { prompt, model } : { prompt })
      const text = (result.text ?? "").trim()
      log("generate.text", { chars: text.length, model: model ? `${model.providerID}/${model.id}` : "default" })
      return text
    }

    async function generate(sessionID: string, prompt: string): Promise<{ text: string; via: string }> {
      const chosen = modelOption(context)
      if (chosen) {
        return { text: await stateless(prompt, chosen), via: "generate.text(model)" }
      }

      // Camino barato: ve la sesión nativamente y no escribe en el historial.
      try {
        const result = await context.client.session.generate({ sessionID, prompt })
        const text = (result.text ?? "").trim()
        log("session.generate", { chars: text.length })
        if (text) return { text, via: "session.generate" }
      } catch (error) {
        log("session.generate.error", { error: errorText(error) })
      }

      // La generación transitoria sobre la sesión devuelve vacío en sesiones
      // largas u ocupadas. El camino stateless no depende de ese estado.
      const current = context.ui.model.current()
      const fallback: ModelRefValue | undefined = current
        ? current.variant
          ? { providerID: current.providerID, id: current.modelID, variant: current.variant }
          : { providerID: current.providerID, id: current.modelID }
        : undefined
      const body = await transcript(context, sessionID)
      const text = await stateless(`${prompt}\n\n--- TRANSCRIPCIÓN DE LA SESIÓN ---\n${body}`, fallback)
      return { text, via: `generate.text(fallback, ${body.length} chars)` }
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
        // El hook server-side reconoce el request del brief por esta marca.
        MARKER,
      ]
        .filter(Boolean)
        .join("\n\n")

      let text = ""
      let via = ""
      setPending((count) => count + 1)
      try {
        const result = await generate(route.sessionID, prompt)
        text = result.text
        via = result.via
      } catch (error) {
        log("brief.error", { error: errorText(error) })
        context.ui.toast.show({ message: `No se pudo generar el brief: ${errorText(error)}`, variant: "error" })
        return
      } finally {
        setPending((count) => count - 1)
      }

      if (!text) {
        log("brief.empty", { via })
        context.ui.toast.show({ message: `El brief vino vacío (ver ${LOG_FILE})`, variant: "warning" })
        return
      }
      log("brief.ok", { via, chars: text.length })

      const style = syntaxStyle(context.theme, context.renderer.nativeScene)
      // El orden importa: `show` reemplaza el diálogo y resetea tamaño y
      // centrado a medium/no centrado; `set` tiene que venir después.
      context.ui.dialog.show(
        () => <Panel context={context} note={focus} answer={text} style={style} />,
        () => {
          void context.renderer.idle().then(() => style.destroy())
        },
      )
      context.ui.dialog.set({ size: "large", centered: true })
    }

    // Indicador cosmético: si el host no publica slots, el plugin sigue cargando.
    try {
      context.ui.slot({
        append: "prompt.footer.status",
        render: () =>
          pending() > 0 ? (
            <text fg={context.theme.hue.interactive[200]} flexShrink={0}>
              /brief
            </text>
          ) : null,
      })
    } catch (error) {
      log("slot.unavailable", { error: errorText(error) })
    }

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
