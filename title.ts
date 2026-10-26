// opencode-brief — título propuesto junto al brief.
//
// Las reglas son las del propio host para nombrar sesiones (`session_rename`):
// se reusan acá para que el título que propone el panel se lea igual que uno
// generado por OpenCode. El brief y el título salen de la misma llamada, así
// que no cuesta un request extra: el modelo devuelve `TITLE: …` en la primera
// línea y el cuerpo después del separador.

/** Reglas del host, adaptadas a "el brief y además un título". */
export const TITLE_RULES = `You also name this conversation, because the user finds it later in a list of past sessions.

Reply with a title for it: one line, no quotes, no trailing period, no label such as "Title:".

Aim for three to five words. Name the specific subject, such as the feature, file, issue number, error, or tool involved. Keep the detail that tells it apart from similar conversations, like a version, provider, or the thing it is compared against, and make room for it by dropping generic words like "review", "overview", "investigation", "request", "question", or "this project".

The title should read naturally as a short phrase, not as a stack of nouns. Write it in your own words rather than copying a heading, commit message, command, or long path.

Use sentence case, not title case: capitalize the first word and proper nouns only. Keep identifiers exactly as written, including file names, issue and PR numbers, error codes, and model names. Use the same language as the session.`

/** Contrato de salida: el título primero, después el brief. */
export const TITLE_FORMAT = `Return exactly this shape, with nothing before the TITLE line. The brief keeps the format and sections you would have used anyway:

TITLE: <the title>
---
<the brief>`

const TITLE_LINE = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?TITLE(?:\*\*|__)?[ \t]*:[ \t]*(?:\*\*|__)?[ \t]*(.+?)[ \t]*$/im

/** Línea que separa el título del cuerpo (`---`, `***`, `___`). */
const SEPARATOR = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/
const MAX_TITLE_CHARS = 100
const MAX_TITLE_WORDS = 10

/**
 * Normaliza lo que devolvió el modelo. Devuelve `undefined` cuando no queda un
 * título usable; en ese caso el panel no ofrece renombrar.
 */
export function sanitizeTitle(raw: string): string | undefined {
  let title = raw
    .replace(/^[\s"'`“”‘’*_]+/, "")
    .replace(/[\s"'`“”‘’*_]+$/, "")
    .replace(/[.。;:,]+$/, "")
    .replace(/\s+/g, " ")
    .trim()

  if (!title) return undefined
  if (title.split(" ").length > MAX_TITLE_WORDS) return undefined
  if (title.length > MAX_TITLE_CHARS) {
    const cut = title.slice(0, MAX_TITLE_CHARS)
    const lastSpace = cut.lastIndexOf(" ")
    title = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()
  }
  return title || undefined
}

/**
 * Separa el título del cuerpo del brief. Si no hay línea `TITLE:` —o el valor
 * no es usable— devuelve el texto completo como cuerpo, sin tocarlo.
 */
export function parseBrief(raw: string): { title?: string; body: string } {
  const match = TITLE_LINE.exec(raw)
  if (!match) return { body: raw.trim() }

  const title = sanitizeTitle(match[1])
  if (!title) return { body: raw.trim() }

  const before = raw.slice(0, match.index)
  const after = raw.slice(match.index + match[0].length)
  // Sólo se acepta como encabezado: lo que precede al título tiene que ser vacío
  // o algún adorno (una línea de separación que el modelo haya puesto de más).
  const head = before.trim()
  if (head && !head.split("\n").every((line) => SEPARATOR.test(line))) {
    return { body: raw.trim() }
  }

  const lines = after.split("\n")
  while (lines.length > 0 && (lines[0].trim() === "" || SEPARATOR.test(lines[0]))) lines.shift()

  const body = lines.join("\n").trim()
  return body ? { title, body } : { body: raw.trim() }
}
