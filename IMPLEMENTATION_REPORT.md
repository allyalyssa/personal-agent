# Implementation report

October 19, 2026; pre-install audit the same evening. Built against Claude Code 2.1.304, whose generated type definitions are the source for every hook and API used.

## What is on the PC

| Path | What |
| --- | --- |
| `%USERPROFILE%\repos\claude-workbench\` | Local plugin marketplace: `plugins\workbench\` (the plugin), `scripts\install.ps1`, `scripts\uninstall.ps1`, README, this report |
| `%USERPROFILE%\repos\second-brain\` | Notes folder (Obsidian-compatible): 2 preference notes copied from your saved Claude memory, 1 workflow, 1 project, 1 decision, templates |

Nothing is installed or activated yet. `install.ps1` is the only thing that changes Claude Code's configuration (see README, "Install, update, uninstall").

## Commands the plugin registers

Verified from Claude Code's debug log (`$.command.register (workbench): /system listed`, plus the same for `/dash` and `/brain`) and the session init listing:

| Purpose | Command |
| --- | --- |
| Diagnostics | `/system doctor` |
| Status overview | `/system status` |
| Dashboard | `/dash` (`/dash help`, `/dash text`, `/dash compact`, `/dash detailed`, `/dash mode <m>`) or `/system dashboard` |
| Memory | `/brain` (`/brain search <words>`, `/brain show <note>`, `/brain recent`, `/brain edit <note>`, `/brain delete <note>`, `/brain export`, `/brain backup`, `/brain rebuild`) or `/system memory ...` |
| Budget and usage | `/system budget` |
| Agents and models | `/system agents` |
| Options | `/system config` (change them in `/plugin` → workbench → Configure) |
| Resume or checkpoint work | `/system resume`, `/system checkpoint` |
| Backup | `/system backup` |

`/wb` existed only in the first build and is not registered by this one. The audit found it still printed by `install.ps1` and mentioned in one note; both are fixed.

## Repository evaluation

| Repo | Verdict | Why |
| --- | --- | --- |
| jpeggdev/humanize-writing (MIT) | Adapted as `skills/natural-writing` | Its npm postinstall script only copies two files into `~/.claude`, `~/.cursor` and `~/.windsurf`. The editing passes are good. Its examples invent interviewees and studies, so those were cut and a no-invention rule added. |
| Gerstep/HumanCompiler (MIT) | Ideas adapted as `skills/personal-profile`; not installed | Needs Bun plus handlebars and yaml, and runs `bun run scripts/...` relative to the working directory, which breaks when it's installed as a plugin. Its interview areas went into a five-question, editable version. |
| humanlayer/humanlayer CLAUDE.md | Principles adapted in `skills/team-routing` | The file is a guide to its own monorepo. Its research, plan, implement and verify discipline still holds. Its daemon and cloud approvals depend on HumanLayer's service and were not installed. |
| Leechael/claude-code-mod-agent-skills | Not installed | Fails `claude plugin validate` on 2.1.304 and calls APIs that don't exist (`$.fs.readdir`, `additionalContext`, `handled`). There is no `~/.agents/skills` folder on the PC to bridge. |

## Version compatibility

- **Your PC's version is unknown to me.** The native installer's folder (`%USERPROFILE%\.local\share\claude`) exists, but it's a protected location this session can't read. `install.ps1` reads `claude --version` and stops below 2.1.304.
- **Required:** mods need 2.1.287 or later. This plugin was tested only on 2.1.304 and uses APIs from that build (`$.session.usage().rateLimits`, `$.session.compact`, `classic.Stop`, panes, `$.agent.list`), so 2.1.304 is the minimum the script accepts.
- **Newer versions:** the mod API is marked early access. `install.ps1` runs `claude plugin validate` and `claude plugin test` with your installed Claude Code before changing anything, so incompatibilities surface as a stop, not a broken install.
- **Desktop app:** a user-scope plugin installed from the terminal also loads in the desktop app's Code tab (local sessions). The desktop bundles its own Claude Code build, which may differ from the terminal's. `/system doctor` prints the engine version in each.
- **Agents and models:** agent files use the aliases `opus`, `sonnet` and `haiku`, which this build accepts. Whether your plan allows Opus in Claude Code is up to Anthropic. If it doesn't, critic and architect calls fail, and Claude is told to retry on sonnet.

## Agent collaboration: subagents vs agent teams

Native agent teams are experimental and off unless `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. They work only in interactive sessions (in-process on Windows Terminal), and the docs say they use significantly more tokens. Turning them on also makes any *named* subagent launch as a teammate. Recommendation: keep subagents as the default, as built. Use a team only for long, parallel work where teammates need to argue as they go, enabled for that one terminal (see README, "Agent teams").

The audit corrected one claim. Subagents given a `name` *can* message each other on this build. The policy and team-routing skill now say so, and tell Claude to leave `name` unset unless messaging is needed. That keeps reviews independent and keeps named spawns from turning into teammates if teams are ever enabled.

## Verification: where each check actually ran

Every real-model check ran in the **build sandbox**, not on your PC. The sandbox was Linux with Claude Code 2.1.304, running headless sessions (`claude -p`, some kept open with streaming input) under an isolated `CLAUDE_CONFIG_DIR` and a fake home folder. It was a managed environment where the security guard is active, and the default main model was Sonnet 5.5. The plugin source was byte-identical to the PC copy (checksums compared).

| Check | Environment | Result |
| --- | --- | --- |
| `claude plugin validate`, `tsc` | Sandbox | Pass |
| 29 unit and UI tests (`claude plugin test`) | Claude Code's test kit; engine mocked beneath the plugin | 29/29 pass |
| `install.ps1` twice, then `uninstall.ps1` | PowerShell 7.4.6 on Linux, isolated config | Install, idempotent re-run, backups and uninstall all behaved; existing settings keys preserved. Not run under Windows PowerShell 5.1 or on Windows paths. |
| `install.ps1` with an old `claude` | PowerShell 7, fake `claude` printing 2.1.200 | Stopped before any change |
| CLI install with network blocked | Sandbox | Succeeded (no network needed) |
| Fresh session loads plugin | Sandbox, headless | 7 agents, 4 skills, 3 tools, 3 commands |
| Commands registered | Sandbox debug log | `/system`, `/dash`, `/brain` |
| Simple question, no agents | Sandbox, real model | Pass |
| Model routing | Sandbox, real model | efficiency ran on `claude-haiku-5-5`, critic on `claude-opus-5-5`, main on `claude-sonnet-5-5` |
| Budget enforcement | Sandbox, real model, `taskBudgetUsd` 0.01 | Agent call refused with the budget message; Claude wrapped up. The first web search slipped through: the check trails spend by one response |
| Review gate | Sandbox, real model | Fired through the follow-up-prompt route (the Stop route was skipped by the security guard); QA review found and fixed 2 issues |
| Independent views, disagreement surfaced | Sandbox, real model | Pass |
| Memory across sessions | Sandbox, two headless sessions | Recorded in one, retrieved and cited in the next |
| Missing notes folder | Sandbox | Reported by `/system doctor`; search returns nothing; no crash |
| Writing | Sandbox, real model | Facts kept, saved voice applied, one added sentence flagged |

**Verified on your PC (Windows, Claude Code 2.1.304, terminal, October 19 evening):** `claude plugin list` shows the plugin enabled and read from `repos\claude-workbench\plugins\workbench`. The debug log shows the hooks module loaded and admitted, and the security guard not active (Pro account, no managed settings). `/system doctor` and `/system budget` ran. All 5 notes were found. The dashboard pane opened in the terminal. Real account windows were read (five-hour 90%, seven-day 23%, with reset times).

**Still not verified on your PC:** the Windows install run; Windows PowerShell 5.1; Windows path handling inside the plugin; which policy and review-gate route applies (depends on whether the guard loads there); the dashboard pane in the desktop app or an interactive terminal; your actual Claude Code version.

**Not verified anywhere with real data:** the downgrade of opus subagents under usage pressure, in a real session (the windows themselves are now confirmed on your PC); a real model-unavailable error; the system-prompt policy route and the Stop-hook review route (kit-tested only, because the guard bypassed both in the sandbox); compaction in a real session.

## Issues found in the audit and fixed

1. `install.ps1` printed `/wb doctor`, which isn't registered. It now prints `/system doctor` and `/system budget`.
2. `install.ps1` didn't stop when a `claude` command failed, because PowerShell doesn't treat native exit codes as errors. Every step now checks `$LASTEXITCODE`.
3. `install.ps1` accepted 2.1.287 but was only tested on 2.1.304. It now requires 2.1.304+ and runs validation and the plugin tests before changing anything.
4. Backups went to `.claude\backups\` alongside Claude Code's own backups, and rollback relied on "the oldest file". They now go to `backups\workbench\`, with a `pre-install\` copy written once, and also cover the two plugin registry files.
5. The scripts ignored `CLAUDE_CONFIG_DIR`. Both now respect it.
6. The policy and team-routing skill claimed subagents can't message each other. Corrected.
7. The writing voice file contained one phrase I'd added as an example; it was removed. The voice and preference notes now say they were copied from your saved memory.
8. The marketplace description named you; it is now neutral.
9. The test kit's file stubs assumed POSIX paths; they now normalize Windows paths, which should let the install-time test run pass on Windows (not verified there; `-SkipTests` is the fallback).
10. The README and this report overstated what was verified and how hard the budgets are. Both are rewritten.
11. Found while installing: if any startup step failed, the mod silently skipped registering its commands. Commands now register first, and every later step records its error for `/system doctor` instead of stopping the rest. A test covers this.

## Rollback

```powershell
& "$env:USERPROFILE\repos\claude-workbench\scripts\uninstall.ps1"
# optional: settings.json exactly as it was before the first install
Copy-Item "$env:USERPROFILE\.claude\backups\workbench\pre-install\settings.json" "$env:USERPROFILE\.claude\settings.json"
```

Uninstalling never removes `repos\second-brain`, `repos\claude-workbench` or any backup.
