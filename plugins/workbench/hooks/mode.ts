import type { Mode } from '../types'

const SIGNALS: [Mode, RegExp][] = [
  ['debugging', /\b(bug|error|exception|traceback|stack ?trace|crash(es|ed)?|fail(s|ing|ed)?|broken|doesn'?t work|not working|regression|debug)\b/g],
  ['coding', /\b(code|function|class|implement|refactor|repo|script|compile|build|deploy|install|api|endpoint|unit tests?|typescript|python|java|rust|npm|pip|git|\w+\.(py|ts|tsx|js|java|rs|go|cpp|c|ipynb))\b/g],
  ['research', /\b(research|sources?|papers?|literature|studies|study|evidence|citations?|look up|find out|investigate|compare|what is known|survey|review of)\b/g],
  ['writing', /\b(write|draft|email|essay|rewrite|reword|proofread|edit (my|this)|tone|blog|letter|statement|cover letter|post|humani[sz]e|sounds? like ai|paragraph)\b/g],
  ['planning', /\b(plan|roadmap|schedule|prioriti[sz]e|priorities|strategy|timeline|milestones?|organi[sz]e|decide|next steps|outline)\b/g],
]

export function classify(text: string): Mode {
  const lower = text.toLowerCase()
  let best: Mode = 'general'
  let bestScore = 0
  for (const [mode, re] of SIGNALS) {
    const score = lower.match(re)?.length ?? 0
    if (score > bestScore) {
      best = mode
      bestScore = score
    }
  }
  return best
}

const TEST_COMMAND = /\b(pytest|jest|vitest|mocha|go test|cargo test|dotnet test|mvn test|gradle test|tox|ruff|eslint|tsc|mypy|make (check|test)|(npm|pnpm|yarn|bun)( run)? (test|lint|typecheck|check)|unittest|claude plugin (test|validate))\b/

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command)
}

export function testSummary(output: string): string {
  const counts = output.match(/(\d+)\s+(passed|failed|errors?|skipped)/gi)
  if (counts) return [...new Set(counts.map(c => c.toLowerCase()))].slice(0, 4).join(', ')
  const last = output.trim().split(/\r?\n/).pop() ?? ''
  return last.slice(0, 80)
}

const CODE_FILE = /\.(py|ts|tsx|js|jsx|mjs|cjs|java|rs|go|c|cc|cpp|h|hpp|cs|rb|php|swift|kt|scala|sh|ps1|ipynb|json|toml|yaml|yml|sql)$/i
const PROSE_FILE = /\.(md|txt|docx|rtf|tex)$/i

export function isCodeFile(path: string): boolean {
  return CODE_FILE.test(path) && !/\.(json|toml|ya?ml)$/i.test(path)
}

export function modeFromFile(path: string): Mode | null {
  if (CODE_FILE.test(path)) return 'coding'
  if (PROSE_FILE.test(path)) return 'writing'
  return null
}

const WRITE_TARGETS = [
  /(?:^|[\s;&|(])(?:\d?>>?|>\|)\s*["']?([^\s"'<>;&|()]+)/g,
  /\btee\s+(?:-a\s+)?["']?([^\s"'<>;&|()]+)/g,
  /\bsed\s+-i\S*\s+(?:-e\s+)?(?:'[^']*'|"[^"]*"|\S+)\s+["']?([^\s"'<>;&|()]+)/g,
  /\b(?:git\s+)?mv\s+(?:-\S+\s+)*\S+\s+["']?([^\s"'<>;&|()]+)/g,
  /\b(?:Set-Content|Add-Content|Out-File)\b[^;|]*?-(?:Path|FilePath|LiteralPath)\s+["']?([^\s"'<>;&|()]+)/gi,
]

export function bashWrites(command: string): string[] {
  const found = new Set<string>()
  for (const re of WRITE_TARGETS) {
    for (const m of command.matchAll(re)) {
      const target = m[1] ?? ''
      if (target && target !== '/dev/null' && !target.startsWith('&') && /\.[A-Za-z0-9]+$/.test(target)) found.add(target)
    }
  }
  return [...found]
}
