// Runs write only in their run dir: codex workspace-write (no network), claude's Bash sandbox with edits kept to the cwd. Neither prompts in headless mode.
export const codexArgs = (m, e, last) => ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--dangerously-bypass-hook-trust', '--color', 'never',
  '-m', m, ...(e ? ['-c', `model_reasoning_effort=${e}`] : []), '-o', last, '-']
export const CLAUDE_SANDBOX = ['--permission-mode', 'acceptEdits', '--settings', JSON.stringify({ sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false } })]
