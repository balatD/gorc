// src/index.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var __dirname2 = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(__dirname2, "..");
var SUBAGENTS = ["go-research", "go-reader", "go-implementer", "go-qa"];
var FLEET = [
  {
    name: "conductor",
    modelKey: "conductor",
    description: "The conductor. Plans, reasons, and delegates research/reading/bulk-editing to cheaper Go subagents. Think, don't trawl.",
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
        "go-qa": "allow"
      }
    },
    promptFile: "agents/conductor.md"
  },
  {
    name: "go-research",
    modelKey: "research",
    description: "Budget research subagent. websearch, webfetch, and read-only exploration of unfamiliar code or upstream dependencies. Invoke via Task from the Conductor.",
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
      external_directory: { "*": "allow" }
    },
    promptFile: "agents/go-research.md"
  },
  {
    name: "go-reader",
    modelKey: "reader",
    description: "Budget reader subagent. Targeted reads of code you already know the location of — grep a symbol, read a file, summarize a subtree. Invoke via Task from the Conductor.",
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
      external_directory: "deny"
    },
    promptFile: "agents/go-reader.md"
  },
  {
    name: "go-implementer",
    modelKey: "implementer",
    description: "Mid-tier implementer subagent. Applies planned edits and mechanical refactors across files, keeping the Conductor's steps cheap. Invoke via Task from the Conductor.",
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
      webfetch: "deny"
    },
    promptFile: "agents/go-implementer.md"
  },
  {
    name: "go-qa",
    modelKey: "qa",
    description: "Small QA subagent. Reads what go-implementer just wrote and judges whether it's testable; recommends the cheapest change that makes it cleanly so. Read-only. Invoke via Task from the Conductor, right after go-implementer returns.",
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
      external_directory: "deny"
    },
    promptFile: "agents/go-qa.md"
  }
];
var COMMANDS = [
  {
    name: "test",
    description: "Run the go-qa testability reviewer on recently changed paths, or a path you name.",
    agent: "conductor",
    templateFile: "commands/test.md"
  }
];
var DEFAULT_MODELS = {
  conductor: "opencode-go/glm-5.2",
  research: "opencode-go/deepseek-v4-flash",
  reader: "opencode-go/mimo-v2.5",
  implementer: "opencode-go/deepseek-v4-pro",
  qa: "opencode-go/deepseek-v4-flash"
};
function readPrompt(rel) {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf8");
}
var src_default = async ({ client }, options = {}) => {
  const opts = options;
  const models = {
    conductor: opts.conductorModel ?? DEFAULT_MODELS.conductor,
    research: opts.researchModel ?? DEFAULT_MODELS.research,
    reader: opts.readerModel ?? DEFAULT_MODELS.reader,
    implementer: opts.implementerModel ?? DEFAULT_MODELS.implementer,
    qa: opts.qaModel ?? DEFAULT_MODELS.qa
  };
  const log = opts.logDelegations ?? true;
  return {
    config: (cfg) => {
      cfg.agent = cfg.agent ?? {};
      for (const def of FLEET) {
        if (cfg.agent[def.name])
          continue;
        cfg.agent[def.name] = {
          description: def.description,
          mode: def.mode,
          model: models[def.modelKey],
          ...def.hidden ? { hidden: true } : {},
          ...def.color ? { color: def.color } : {},
          permission: def.permission,
          prompt: readPrompt(def.promptFile)
        };
      }
      const conductor = cfg.agent.conductor;
      if (conductor) {
        conductor.permission = conductor.permission ?? {};
        conductor.permission.task = {
          "*": "deny",
          ...Object.fromEntries(SUBAGENTS.map((n) => [n, "allow"]))
        };
      }
      cfg.command = cfg.command ?? {};
      for (const cmd of COMMANDS) {
        if (cfg.command[cmd.name])
          continue;
        cfg.command[cmd.name] = {
          description: cmd.description,
          agent: cmd.agent,
          template: readPrompt(cmd.templateFile)
        };
      }
      if (opts.defaultAgent && !cfg.default_agent) {
        cfg.default_agent = opts.defaultAgent;
      }
    },
    "tool.execute.before": async (input) => {
      if (!log || input.tool !== "task")
        return;
      const args = input.input ?? {};
      const subagent = args.subagent ?? args.agent ?? args.description ?? "?";
      const description = String(args.description ?? "").slice(0, 120) || "(no description)";
      await client.app.log({
        body: {
          service: "go-orchestrator",
          level: "info",
          message: `delegate -> ${String(subagent)}`,
          extra: { description }
        }
      });
    }
  };
};
export {
  src_default as default
};
