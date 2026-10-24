// Tests del hook de razonamiento: alcance por marca y parseo de la opción
// `thinking`. No tocan la TUI ni el renderer, así que corren sin opentui.
import { describe, expect, test } from "bun:test"
import { MARKER, registerReasoningHook } from "../reasoning"

process.env.OPENCODE_BRIEF_LOG = "/tmp/opencode-brief-test.log"

function harness(options: Record<string, any> = {}) {
  const calls: Array<{ name: string; callback: (request: any) => void }> = []
  let disposed = 0
  const context = {
    options,
    session: {
      hook: async (name: string, callback: (request: any) => void) => {
        calls.push({ name, callback })
        return { dispose: async () => void disposed++ }
      },
    },
  }
  return { context, calls, disposed: () => disposed }
}

const briefRequest = () => ({
  model: { providerID: "litellm", id: "deepseek-v4.1-flash", variant: "high" },
  options: {} as Record<string, any>,
  messages: [{ role: "user", content: [{ type: "text", text: `resumen…\n\n${MARKER}` }] }],
})

const plainRequest = () => ({
  model: { providerID: "litellm", id: "deepseek-v4.1-flash" },
  options: {} as Record<string, any>,
  messages: [{ role: "user", content: [{ type: "text", text: "un turno normal" }] }],
})

describe("registerReasoningHook", () => {
  test("default: baja a low sólo el request del brief", async () => {
    const h = harness()
    await registerReasoningHook(h.context)

    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].name).toBe("generate")

    const brief = briefRequest()
    h.calls[0].callback(brief)
    expect(brief.options.reasoningEffort).toBe("low")
    expect(brief.options.reasoning_effort).toBe("low")

    const plain = plainRequest()
    h.calls[0].callback(plain)
    expect(plain.options).toEqual({})
  })

  test("respeta el nivel configurado", async () => {
    const h = harness({ thinking: "none" })
    await registerReasoningHook(h.context)

    const brief = briefRequest()
    h.calls[0].callback(brief)
    expect(brief.options.reasoningEffort).toBe("none")
  })

  test("inherit no registra nada", async () => {
    const h = harness({ thinking: "inherit" })
    await registerReasoningHook(h.context)
    expect(h.calls).toHaveLength(0)
  })

  test("sin dominio de sesión no rompe", async () => {
    await expect(registerReasoningHook({ options: {} })).resolves.toBeUndefined()
  })

  test("el cleanup libera la registración", async () => {
    const h = harness()
    const cleanup = await registerReasoningHook(h.context)
    expect(h.disposed()).toBe(0)
    await cleanup?.()
    expect(h.disposed()).toBe(1)
  })
})
