// Tests del parseo del título: contrato de salida del modelo y tolerancia a
// las variantes que aparecen en la práctica (negritas, comillas, sin separador).
import { describe, expect, test } from "bun:test"
import { parseBrief, sanitizeTitle } from "../title"

describe("sanitizeTitle", () => {
  test("saca comillas, punto final y espacios de más", () => {
    expect(sanitizeTitle('"Production 500 errors."')).toBe("Production 500 errors")
    expect(sanitizeTitle("  `Credential refresh tokens`  ")).toBe("Credential refresh tokens")
  })

  test("rechaza vacío y frases largas", () => {
    expect(sanitizeTitle("   ")).toBeUndefined()
    expect(sanitizeTitle('""')).toBeUndefined()
    expect(sanitizeTitle("una frase que claramente no es un titulo sino una oracion entera con muchas palabras")).toBeUndefined()
  })

  test("recorta títulos largos en un límite de palabra", () => {
    const long = "a".repeat(60) + " " + "b".repeat(60)
    const result = sanitizeTitle(long)
    expect(result).toBeDefined()
    expect(result!.length).toBeLessThanOrEqual(100)
    expect(result!.endsWith("b")).toBe(false)
  })
})

describe("parseBrief", () => {
  test("separa título y cuerpo con el separador del contrato", () => {
    const raw = "TITLE: Credential refresh tokens\n---\n**Done**\n- something"
    expect(parseBrief(raw)).toEqual({
      title: "Credential refresh tokens",
      body: "**Done**\n- something",
    })
  })

  test("acepta la línea con negritas y sin separador", () => {
    const raw = "**TITLE:** Brief plugin title\n\n**Done**\n- x"
    expect(parseBrief(raw)).toEqual({ title: "Brief plugin title", body: "**Done**\n- x" })
  })

  test("sin título devuelve el texto intacto", () => {
    const raw = "**Done**\n- x\n**Next**\n- y"
    expect(parseBrief(raw)).toEqual({ body: raw })
  })

  test("un TITLE a mitad del cuerpo no se come el brief", () => {
    const raw = "**Done**\n- x\nTITLE: algo\n- y"
    const parsed = parseBrief(raw)
    expect(parsed.title).toBeUndefined()
    expect(parsed.body).toBe(raw)
  })

  test("un título no usable deja el cuerpo intacto", () => {
    const raw = "TITLE: una oracion larguisima que no es un titulo de ninguna manera posible\n---\n**Done**\n- x"
    const parsed = parseBrief(raw)
    expect(parsed.title).toBeUndefined()
    expect(parsed.body).toBe(raw)
  })

  test("título sin cuerpo cae al texto completo", () => {
    const raw = "TITLE: Only a title\n---"
    expect(parseBrief(raw)).toEqual({ body: raw })
  })

  test("tolera una línea decorativa antes del título", () => {
    const raw = "---\nTITLE: Decorative separator\n---\n**Done**\n- x"
    expect(parseBrief(raw)).toEqual({ title: "Decorative separator", body: "**Done**\n- x" })
  })
})
