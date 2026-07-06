import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// ponytail: agents/command prompts live as sibling .md files (read at runtime
// via import.meta.url, same pattern ponytail's own published plugin uses) so
// the prompts stay editable markdown and we never fight backticks/code fences
// inside TS template literals. Metadata that opencode needs as structured
// fields (description/mode/model/permission) lives here as data; the .md bodies
// are the prompts. One source file, one built file, zero runtime deps.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

type ModelKey = "conductor" | "research" | "reader" | "implementer" | "qa"

type AgentDef = {
  name: string
  modelKey: ModelKey
  description: string
  mode: "primary" | "subagent"
  hidden?: boolean
  color?: string
  // ponytail: left loose — matches opencode's per-agent permission map which
  // mixes flat actions and nested pattern objects (task/external_directory).
  permission: Record<string, unknown>
  promptFile: string
}

type CommandDef = {
  name: string
  description: string
  agent: string
  templateFile: string
}

const SUBAGENTS = ["go-research", "go-reader", "go-implementer", "go-qa"] as const

const FLEET: AgentDef[] = [
  {
    name: "conductor",
    modelKey: "conductor",
    description:
      "The conductor. Plans, reasons, and delegates research/reading/bulk-editing to cheaper Go subagents. Think, don't trawl.",
    mode: "primary",
    color: "accent",
    permission: {
      todowrite: "allow",
      question: "allow",
      skill: "allow",
      lsp: "allow",
      doom_loop: "allow",
      task: {
        "*": "deny",
        "go-research": "allow",
        "go-reader": "allow",
        "go-implementer": "allow",
        "go-qa": "allow",
      },
    },
    promptFile: "agents/conductor.md",
  },
  {
    name: "go-research",
    modelKey: "research",
    description:
      "Budget research subagent. websearch, webfetch, and read-only exploration of unfamiliar code or upstream dependencies. Invoke via Task from the Conductor.",
    mode: "subagent",
    hidden: true,
    permission: {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      websearch: "allow",
      webfetch: "allow",
      question: "allow",
      edit: "deny",
      bash: "deny",
      task: "deny",
      external_directory: { "*": "allow" },
    },
    promptFile: "agents/go-research.md",
  },
  {
    name: "go-reader",
    modelKey: "reader",
    description:
      "Budget reader subagent. Targeted reads of code you already know the location of — grep a symbol, read a file, summarize a subtree. Invoke via Task from the Conductor.",
    mode: "subagent",
    hidden: true,
    permission: {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      edit: "deny",
      bash: "deny",
      task: "deny",
      websearch: "deny",
      webfetch: "deny",
      question: "deny",
      lsp: "deny",
      todowrite: "deny",
      skill: "deny",
      external_directory: "deny",
    },
    promptFile: "agents/go-reader.md",
  },
  {
    name: "go-implementer",
    modelKey: "implementer",
    description:
      "Mid-tier implementer subagent. Applies planned edits and mechanical refactors across files, keeping the Conductor's steps cheap. Invoke via Task from the Conductor.",
    mode: "subagent",
    hidden: true,
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "allow",
      lsp: "allow",
      todoread: "allow",
      todowrite: "deny",
      question: "deny",
      task: "deny",
      websearch: "deny",
      webfetch: "deny",
    },
    promptFile: "agents/go-implementer.md",
  },
  {
    name: "go-qa",
    modelKey: "qa",
    description:
      "Small QA subagent. Reads what go-implementer just wrote and judges whether it's testable; recommends the cheapest change that makes it cleanly so. Read-only. Invoke via Task from the Conductor, right after go-implementer returns.",
    mode: "subagent",
    hidden: true,
    permission: {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      lsp: "allow",
      edit: "deny",
      bash: "deny",
      task: "deny",
      todowrite: "deny",
      question: "deny",
      websearch: "deny",
      webfetch: "deny",
      skill: "deny",
      external_directory: "deny",
    },
    promptFile: "agents/go-qa.md",
  },
]

const COMMANDS: CommandDef[] = [
  {
    name: "test",
    description:
      "Run the go-qa testability reviewer on recently changed paths, or a path you name.",
    agent: "conductor",
    templateFile: "commands/test.md",
  },
]

const DEFAULT_MODELS: Record<ModelKey, string> = {
  conductor: "opencode-go/glm-5.2",
  research: "opencode-go/deepseek-v4-flash",
  reader: "opencode-go/mimo-v2.5",
  implementer: "opencode-go/deepseek-v4-pro",
  qa: "opencode-go/deepseek-v4-flash",
}

type Options = {
  conductorModel?: string
  researchModel?: string
  readerModel?: string
  implementerModel?: string
  qaModel?: string
  defaultAgent?: string
  logDelegations?: boolean
}

function readPrompt(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf8")
}

export default (async ({ client }, options = {}) => {
  const opts = options as Options
  const models: Record<ModelKey, string> = {
    conductor: opts.conductorModel ?? DEFAULT_MODELS.conductor,
    research: opts.researchModel ?? DEFAULT_MODELS.research,
    reader: opts.readerModel ?? DEFAULT_MODELS.reader,
    implementer: opts.implementerModel ?? DEFAULT_MODELS.implementer,
    qa: opts.qaModel ?? DEFAULT_MODELS.qa,
  }
  const log = opts.logDelegations ?? true

  return {
    // Single pass: inject any fleet agent the user hasn't already defined,
    // then force-stamp the conductor's task gating so the fleet boundary
    // holds even when the conductor IS user-defined.
    config: (cfg) => {
      cfg.agent = cfg.agent ?? {}
      for (const def of FLEET) {
        if (cfg.agent[def.name]) continue
        cfg.agent[def.name] = {
          description: def.description,
          mode: def.mode,
          model: models[def.modelKey],
          ...(def.hidden ? { hidden: true } : {}),
          ...(def.color ? { color: def.color } : {}),
          permission: def.permission,
          prompt: readPrompt(def.promptFile),
        } as (typeof cfg.agent)[string]
      }
      const conductor = cfg.agent.conductor
      if (conductor) {
        conductor.permission = conductor.permission ?? {}
        ;(conductor.permission as Record<string, unknown>).task = {
          "*": "deny",
          ...Object.fromEntries(SUBAGENTS.map((n) => [n, "allow"])),
        }
      }

      cfg.command = cfg.command ?? {}
      for (const cmd of COMMANDS) {
        if (cfg.command[cmd.name]) continue
        cfg.command[cmd.name] = {
          description: cmd.description,
          agent: cmd.agent,
          template: readPrompt(cmd.templateFile),
        } as (typeof cfg.command)[string]
      }

      if (opts.defaultAgent && !cfg.default_agent) {
        cfg.default_agent = opts.defaultAgent
      }
    },

    // Audit trail: every Task delegation gets a log line. Mirrors the
    // pre-package go-orchestrator.ts; input.input is read via cast because the
    // plugin type's tool.execute.before input omits the runtime args field.
    "tool.execute.before": async (input) => {
      if (!log || input.tool !== "task") return
      const args = ((input as { input?: Record<string, unknown> }).input ?? {}) as Record<string, unknown>
      const subagent = args.subagent ?? args.agent ?? args.description ?? "?"
      const description =
        String(args.description ?? "").slice(0, 120) || "(no description)"
      await client.app.log({
        body: {
          service: "go-orchestrator",
          level: "info",
          message: `delegate -> ${String(subagent)}`,
          extra: { description },
        },
      })
    },
  }
}) satisfies Plugin
