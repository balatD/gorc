// Smoke check for the built plugin. Run with: bun run build && bun test/smoke.mjs
// Verifies the config hook injects the fleet, prompts load from disk, models
// and defaultAgent options work, user-defined agents win, the conductor's task
// gating is force-stamped, and delegation logging behaves.
import assert from "node:assert/strict"
import plugin from "../dist/index.js"

const logged = []
const client = { app: { log: async (entry) => { logged.push(entry) } } }

// 1. Empty config: all 5 agents + test command injected, prompts read from disk.
{
  const hooks = await plugin({ client })
  assert.equal(typeof hooks.config, "function")
  assert.equal(typeof hooks["tool.execute.before"], "function")

  const cfg = {}
  hooks.config(cfg)

  for (const name of ["conductor", "go-research", "go-reader", "go-implementer", "go-qa"]) {
    assert.ok(cfg.agent[name], `agent ${name} injected`)
    assert.ok(cfg.agent[name].prompt.length > 0, `${name} prompt read from disk`)
  }
  assert.ok(cfg.agent.conductor.prompt.includes("Conductor"), "conductor prompt body loaded")
  assert.ok(cfg.agent["go-qa"].prompt.includes("testable"), "go-qa prompt body loaded")
  assert.equal(cfg.agent.conductor.mode, "primary")
  assert.equal(cfg.agent["go-research"].mode, "subagent")
  assert.equal(cfg.agent["go-research"].hidden, true)

  // default models
  assert.equal(cfg.agent.conductor.model, "opencode-go/glm-5.2")
  assert.equal(cfg.agent["go-qa"].model, "opencode-go/deepseek-v4-flash")

  // conductor task force-gated to the 4 subagents
  assert.deepEqual(cfg.agent.conductor.permission.task, {
    "*": "deny",
    "go-research": "allow",
    "go-reader": "allow",
    "go-implementer": "allow",
    "go-qa": "allow",
  })

  // test command injected
  assert.ok(cfg.command.test, "test command injected")
  assert.equal(cfg.command.test.agent, "conductor")
  assert.ok(cfg.command.test.template.includes("$ARGUMENTS"), "test template loaded")
}

// 2. Options override models + defaultAgent; untouched agents keep defaults.
{
  const hooks = await plugin({ client }, {
    conductorModel: "anthropic/claude-sonnet-4-6",
    qaModel: "anthropic/claude-haiku-4-5",
    defaultAgent: "conductor",
  })
  const cfg = {}
  hooks.config(cfg)
  assert.equal(cfg.agent.conductor.model, "anthropic/claude-sonnet-4-6")
  assert.equal(cfg.agent["go-qa"].model, "anthropic/claude-haiku-4-5")
  assert.equal(cfg.agent["go-reader"].model, "opencode-go/mimo-v2.5")
  assert.equal(cfg.default_agent, "conductor")
}

// 3. User-defined agent is NOT overwritten, but conductor.task IS re-stamped.
{
  const hooks = await plugin({ client })
  const cfg = {
    agent: {
      conductor: { description: "mine", mode: "primary", permission: { todowrite: "allow" } },
    },
  }
  hooks.config(cfg)
  assert.equal(cfg.agent.conductor.description, "mine", "user conductor preserved")
  assert.ok(cfg.agent["go-research"], "subagents still injected")
  assert.deepEqual(cfg.agent.conductor.permission.task, {
    "*": "deny",
    "go-research": "allow",
    "go-reader": "allow",
    "go-implementer": "allow",
    "go-qa": "allow",
  })
  assert.equal(cfg.agent.conductor.permission.todowrite, "allow", "user permission kept")
}

// 4. defaultAgent does NOT clobber an existing default_agent.
{
  const hooks = await plugin({ client }, { defaultAgent: "conductor" })
  const cfg = { default_agent: "build" }
  hooks.config(cfg)
  assert.equal(cfg.default_agent, "build", "existing default_agent preserved")
}

// 5. tool.execute.before logs task delegations only; respects logDelegations:false.
{
  logged.length = 0
  const hooks = await plugin({ client })
  await hooks["tool.execute.before"]({ tool: "edit", input: { description: "x" } })
  assert.equal(logged.length, 0, "non-task tool not logged")
  await hooks["tool.execute.before"]({ tool: "task", input: { subagent: "go-reader", description: "read foo" } })
  assert.equal(logged.length, 1, "task delegation logged")
  assert.equal(logged[0].body.message, "delegate -> go-reader")

  const quiet = await plugin({ client }, { logDelegations: false })
  logged.length = 0
  await quiet["tool.execute.before"]({ tool: "task", input: { subagent: "go-qa" } })
  assert.equal(logged.length, 0, "logDelegations:false suppresses logging")
}

console.log("OK: all smoke checks passed")
