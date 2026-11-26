// Replay frames from PROMPT-STATE-1 and the LIVENESS-1 veteran cases.
export const promptFrames = {
  claude: [
    ['trust-dialog', 'Accessing workspace:\n/tmp/fixture\n❯ No, exit\n  Yes, I trust this folder\nEnter to confirm · Esc to cancel'],
  ],
  codex: [
    ['awaiting-user', 'Update available!\n  1. Update now\n  2. Skip\nEnter continue · Esc skip'],
    ['awaiting-user', 'Choose working directory to resume\n  1. Original directory\n  2. Current directory\nEnter select · Esc back'],
    ['choice', 'Which colour?\n  1. Blue\n  2. Green\nEnter to submit answer'],
  ],
  agy: [
    ['overlay', "Error: HTTP 429 Too Many Requests\nHow's the CLI experience so far? Help us improve:\n[1] Good [2] Fine [3] Bad [0] Skip", '0'],
    ['overlay', '┃ Introducing Gemini 4 Neon ┃\n┃ esc to dismiss ┃', 'esc'],
    ['awaiting-user', 'Welcome to the Antigravity CLI\n↑/↓ Navigate · enter Confirm'],
  ],
  opencode: [
    ['permission', '△ Permission required\nAllow once    Always allow    Reject\nenter confirm    esc reject'],
    ['choice', '◆ Questions\nWhich colour?\n↑↓ select  enter choose  tab next  esc dismiss'],
  ],
};
