# Claude workbench

A Claude Code plugin that gives every Claude Code session on this computer:

- an agent team (critic, researcher, architect, engineer, QA/security, efficiency, writer) with routing rules and limits;
- a dashboard pane that changes with the task (coding, debugging, research, writing, planning);
- a local second brain (Markdown in `repos\second-brain`) that is searched on each prompt and written at the end of meaningful work;
- a natural-writing skill adapted from jpeggdev/humanize-writing, and a personal-profile skill adapted from HumanCompiler's interview;
- model routing, per-request and per-session budgets, account-usage warnings, loop detection, a required review for larger code changes, and a resumable task ledger.

Built for Claude Code 2.1.304. Mods need 2.1.287 or later.

## Where it works

| Place | Works? |
| --- | --- |
| Claude Code in a terminal (`claude`) | Everything. The pane docks beside the transcript in the fullscreen layout, and opens inline on the main screen. |
| Claude Code tab of the desktop app (local sessions) | Everything; the pane is drawn by the desktop. |
| `claude -p`, SDK | Agents, skills, policy, memory, limits, commands. No pane; `/dash text` prints the dashboard. |
| VS Code extension | Mods run, but pane support depends on the extension build. `/dash text` always works. |
| Cloud sessions, claude.ai chats, the Chat tab | Not loaded. This plugin lives on this computer. |

## Install, update, uninstall

Check your version first: `claude --version` must print 2.1.304 or later (run `claude update` if not). Then, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\repos\claude-workbench\scripts\install.ps1"
```

`-ExecutionPolicy Bypass` applies to that one PowerShell process only; it changes no system setting. The script:

1. Stops unless `claude` is on PATH and is 2.1.304 or newer.
2. Runs `claude plugin validate` on the marketplace and the plugin, and `claude plugin test` on the plugin. Both are read-only, and the tests run in Claude Code's sandbox with no file, network or process access. If either fails, it stops before changing anything. `-SkipTests` skips the tests, not the validation.
3. Copies `settings.json`, `plugins\known_marketplaces.json` and `plugins\installed_plugins.json` from your Claude config folder (`%USERPROFILE%\.claude`, or `CLAUDE_CONFIG_DIR` if you set it) into `backups\workbench\<timestamp>\`. On the first run it also saves `backups\workbench\pre-install\`, which later runs never overwrite.
4. Runs `claude plugin marketplace add <this folder>` and `claude plugin install workbench@claude-workbench --scope user`. These merge two keys into `settings.json` (`extraKnownMarketplaces.claude-workbench` and `enabledPlugins["workbench@claude-workbench"]`), update the two plugin registry files, and make a cached copy under `plugins\cache\`. Other keys, plugins and marketplaces are left as they are.
5. Creates `repos\second-brain` only if it's missing.

It downloads nothing and installs no packages. In testing, the install also succeeded with the network blocked. It never reads or touches credential files. The backups are plain copies of the files above: if you keep API keys in `settings.json`'s `env` block, the copies contain them too, in the same folder.

`.\scripts\uninstall.ps1` runs `claude plugin uninstall` and `claude plugin marketplace remove`, which remove only the plugin's own two entries. It deletes none of your files: this folder, your notes, the backups, the plugin's small data file (`plugins\store\workbench_*.json`) and the inert cache copy all stay. It prints the command to restore `pre-install\settings.json` if you want the file exactly as it was.

**Updating:** the plugin is read straight from `plugins\workbench`, so edits take effect in the next session, or after `/reload-plugins` in a running one. There is nothing to reinstall.

## Commands

| Command | What it does |
| --- | --- |
| `/system` | Help |
| `/system status` | Dashboard summary plus budget |
| `/system dashboard ...` | Same as `/dash` |
| `/system agents` | The team, default models, this session's delegation by model |
| `/system memory ...` | Same as `/brain` |
| `/system budget` | Spend for this request and session, context %, the account's five-hour and seven-day usage windows, tool and agent counts |
| `/system resume` | Show this project's ledger and put a resume request in the prompt box |
| `/system checkpoint` | Write the ledger now |
| `/system doctor` | Diagnostics: version, surfaces, model, brain, index, ledger, policy delivery, limits, budgets |
| `/system config` | Current option values |
| `/system backup` | Copy `~\.claude\settings.json` to `~\.claude\backups\` and the brain to `_backups\` |
| `/dash` | Open the dashboard pane (`/dash help` for the rest) |
| `/dash compact` / `/dash detailed` | Switch views (also a button in the pane) |
| `/dash hide <panel>` / `/dash unhide <panel>` | Panels: objective, agents, files, tests, tasks, blockers, questions, sources, findings, draft, decisions, memory, errors, budget |
| `/dash mode <mode>` / `/dash mode auto` | Pin the layout to coding, debugging, research, writing, planning or general, or let it follow the task |
| `/dash text` | The dashboard as text, for surfaces without panes |
| `/brain` | Note counts and help |
| `/brain search <words>` / `show <note>` / `recent` | Find and read notes (`show` includes backlinks) |
| `/brain edit <note>` | Puts an edit request for that note in the prompt box |
| `/brain delete <note>` | Deletes it after copying it to `_trash\` |
| `/brain export` / `backup` / `rebuild` | Write `_exports\`, copy everything to `_backups\<stamp>\`, rebuild `index.md` |

Routine behaviour needs no commands: the policy, note retrieval, dashboard tracking, budgets, review gate and ledger all run automatically. Say "no review" or "quick" in a request to skip the review gate for it.

## How the pieces fit

```
plugins/workbench/
  .claude-plugin/plugin.json   manifest and options (userConfig)
  agents/*.md                  7 subagents, each with a fixed model and tool limits
  skills/team-routing/         how to size, brief, debate, review and synthesize
  skills/natural-writing/      writing passes; references/my-voice.md is yours to edit
  skills/second-brain/         note types, layout, what to record and what not to
  skills/personal-profile/     short, editable profile interview (from HumanCompiler's areas)
  hooks/register.tsx           the mod: policy, retrieval, limits, budgets, review gate, dashboard, commands, tools
  hooks/brain.ts               note parsing, search, backlinks, index, secret detection and redaction
  hooks/mode.ts                task classification, test detection, files written by shell commands
  hooks/budget.ts              budget and usage-window thresholds, identical-call keys
  hooks/ledger.ts              the resumable ledger's format and resume summary
  types/index.d.ts             the dashboard's state contract
  tests/workbench.test.tsx     29 tests, run with: claude plugin test plugins/workbench
```

The main conversation is the orchestrator: subagents can't spawn subagents. Claude Code lets subagents that were given a `name` message each other, but the policy keeps agents unnamed unless that's needed, so findings flow through the orchestrator and independent reviews stay independent. The mod hands the orchestrator a short routing policy and enforces the limits itself:

- **Policy.** Sent as hidden context with the first prompt of each session, and again after compaction or `/clear`. It also tries the system prompt; Claude Code's built-in security guard (on Team/Enterprise accounts and managed machines) skips user plugins there, so the context route is the dependable one. `/system doctor` shows which route was used.
- **Limits.** Agent calls are refused past `maxParallelAgents` running subagents and past `maxReviewRounds` critic or QA reviews per request. WebSearch and WebFetch stop after `maxSearchesPerRequest`. The fifth identical tool call in a request is refused, and the third gets a warning. Two running subagents can't edit the same file.
- **Model routing.** Each agent has a fixed default model in its file: opus for critic and architect; sonnet for researcher, engineer, qa-security and writer; haiku for efficiency. Claude may override per call with the Agent tool's `model` (`haiku`, `sonnet`, `opus`, plus `fable` where your account has it). While an account usage window is past `usageWarnPercent`, opus subagents are run on sonnet. If an agent's model is unavailable, Claude is told to retry on sonnet, then do the work itself. A plugin cannot change the main session's model; `/system budget` suggests `/model sonnet` when you're on an expensive model.
- **Budgets and usage.** See "What the budgets measure" below.
- **Review gate.** When one request edits `reviewMinFiles` or more code files (Edit/Write or shell redirects, `sed -i`, `mv`) and no critic or QA review ran, Claude is sent back once to get a `workbench:qa-security` review. It uses the Stop hook where that runs, and otherwise a visible follow-up prompt.
- **Ledger.** At the end of every turn with real progress, `second-brain\_ledgers\<project>.md` is rewritten: objective, tasks, next steps, blockers, decisions, files modified, check results, usage, and earlier objectives. The first prompt of the next session in that project mentions unfinished work, and `/system resume` picks it up.
- **Retrieval.** On each substantive prompt, up to `maxMemoriesPerPrompt` matching notes are attached as hidden context, with their paths. Active notes in `profile\` are always included with the policy.
- **Tools the model gets.** `mcp__workbench__dashboard_update`, `mcp__workbench__brain_search`, `mcp__workbench__brain_record`. The last one is loaded on demand, merges into existing notes instead of duplicating them, marks superseded decisions, and refuses text that looks like a credential.
- **Dashboard.** Built from what actually happens: Agent calls (via the live agent list), Read/Edit/Write calls, test and lint commands with their real exit status, WebSearch/WebFetch, the task list, and session cost and context from Claude Code's own usage figures. Objectives, findings, decisions, blockers and draft state come from the model through `dashboard_update`. A one-line summary also goes to the status line, so it degrades to that where panes can't be drawn.

## What the budgets measure

- **Dollar figures** are Claude Code's own session cost (what `/cost` reports): tokens from every API response in this session, its subagents included, priced at list rates. On a Pro or Max subscription that's an estimate of usage, not a charge. The "request" budget is the increase since you sent the current prompt. The "session" budget is the total for the session.
- **When thresholds are reached.** The checks run at every tool call (main conversation and subagents).
  - *Request budget, last 15%:* Claude is told to stop exploring and wrap up, and new subagents are refused.
  - *Request budget reached:* new subagents and web searches/fetches in the main conversation are refused for the rest of that request.
  - *Session budget at 80%:* a warning. *At 100%:* no new subagents.
  - Each new level shows you a toast and puts a note in Claude's context.
- **What it can't stop.** It can't interrupt a model response mid-stream or stop subagents that are already running. Ordinary tools (Read, Edit, Bash) keep working past the budget, so Claude can finish and verify. A subagent's own web lookups aren't capped. Claude Code starts a tool as soon as the model emits the call, before that response's cost is recorded, so a check can trail actual spend by one model response. This was seen in testing.
- **Five-hour and seven-day warnings** come from `$.session.usage().rateLimits`: the account-wide percentages Anthropic's API sends back with each response on subscription plans. They refresh only when this session makes a request, and they're empty on API-key billing. At 80% (`usageWarnPercent`) you get a warning and opus subagents run on sonnet. At 95%, Claude is told to checkpoint, and new subagents and web research stop. **Not verified with real data:** the build sandbox reported no windows, so this path has only been tested with simulated figures. `/system budget` shows whether your sessions report them.
- **Only Anthropic enforces your actual usage limits.** The plugin sees nothing from claude.ai chats or other devices, except as those windows reflect it, and it can't raise, reserve or reset limits. It never switches provider, buys usage or uses API credit.
- **Things that themselves use usage:** early compaction (`compactAtPercent`, one summarizing request) and the review gate's follow-up turn. Set `compactAtPercent` to 0 or `requireReview` to false to turn them off.

## Agent teams

Claude Code's native agent teams are experimental and off by default (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Each teammate is a separate full session with a shared task list and direct messaging. They work only in interactive sessions, in-process mode on Windows Terminal (split panes need tmux or iTerm2), and the docs say they use significantly more tokens. The workbench keeps subagents as the default and doesn't enable teams. To try a team for one big parallel task without changing settings:

```powershell
$env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"; claude
```

Then ask for teammates, using the workbench agent types if you like (for example, "spawn a teammate using the workbench:critic agent type"). Close that terminal to go back. Agent definitions' `skills` don't apply to teammates.

## Options

Change them in `/plugin` (workbench, Configure), or in `~\.claude\settings.json` under `pluginConfigs` → `workbench@claude-workbench` → `options`.

| Option | Default | Meaning |
| --- | --- | --- |
| `brainPath` | empty, meaning `<home>\repos\second-brain` | Where the notes live |
| `injectMemories` / `maxMemoriesPerPrompt` | true / 3 | Attach matching notes to prompts, and how many |
| `teamPolicy` | true | Send the routing policy |
| `autoOpenDashboard` | true | Open the pane at session start |
| `maxParallelAgents` | 3 | Running subagents allowed at once |
| `maxReviewRounds` | 2 | Critic/QA reviews per request |
| `maxSearchesPerRequest` | 12 | Web searches and fetches per request |
| `taskBudgetUsd` | 5 | Per-request budget (0 is off) |
| `reservePercent` | 15 | Last part of the request budget kept for verifying and answering |
| `sessionBudgetUsd` | 20 | Per-session budget: warning at 80%, no new subagents at 100% (0 is off) |
| `usageWarnPercent` | 80 | Warning level for the session budget and account usage windows |
| `downgradeUnderPressure` | true | Run opus subagents on sonnet while usage is high |
| `compactAtPercent` | 80 | Compact after a turn past this context fill (0 leaves it to Claude Code) |
| `requireReview` / `reviewMinFiles` | true / 3 | Review gate for larger code changes |
| `ledger` | true | Keep the per-project ledger |

## Customizing

- **Agents:** edit `agents\<name>.md`. `model:` takes `haiku`, `sonnet`, `opus` or a full model id; `disallowedTools:` and `maxTurns:` limit what the agent can do.
- **Routing:** the short policy is `policy()` in `hooks\register.tsx`; the long form is `skills\team-routing\SKILL.md`.
- **Dashboard panels:** the `PANELS` table in `hooks\register.tsx` picks the panels each mode shows.
- **Your voice:** `skills\natural-writing\references\my-voice.md`.
- **Standing preferences:** add notes with `type: preference` under `repos\second-brain\profile\`.

## Troubleshooting

- `/system doctor` first.
- Run `claude --debug` and search the log for `workbench`. A skipped hook is logged with the reason.
- After editing the plugin, run `claude plugin validate plugins\workbench` and `claude plugin test plugins\workbench`.
- If the pane doesn't appear in a narrow terminal, widen it or use `/dash text`; Claude Code only docks unasked panes on wide terminals.

## Credits

- `skills/natural-writing` adapts jpeggdev/humanize-writing (MIT, see `LICENSE-humanize-writing` there). Its examples that invent people and studies were dropped, and a rule against inventing facts was added.
- The research, plan, implement and verify discipline in team-routing follows HumanLayer's published workflow.
- `skills/personal-profile` borrows the interview areas from Gerstep/HumanCompiler (MIT). HumanCompiler itself is not installed.
