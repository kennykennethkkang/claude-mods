---
name: phone
description: Call the owner on their phone through Bland when you need a decision only they can make and they are not at the keyboard, wait for the answer, then keep working. Use when the user says "call me", "phone me", "ring me if you need a decision", or when a long autonomous task hits a fork you cannot default.
---

# Phone

Claude Code has a phone. One script places a call through Bland, waits for it to end, and prints the decision.

```bash
python3 ~/.claude/skills/phone/call.py "QUESTION" "CONTEXT"
```

- QUESTION: one yes/no or pick-one question, said aloud, under 25 words. Give the options by name.
- CONTEXT: one or two sentences the agent may use if the owner asks why. Optional.

Output ends with `ANSWER: ...` (the decision in the owner's words) and the transcript. Exit 0 means a human answered; 2 means voicemail, no answer or timeout; 1 means config or API error.

## Rules

- Each call costs money and interrupts a person. Call once per decision, only for a decision you cannot default or infer from the repo, and never for status updates.
- Before calling, say in chat what you are about to ask. After, quote the ANSWER line and continue with it; do not re-ask in chat.
- Exit 2: do not redial. Leave the question in chat and either pick the safer default or stop.
- Run `--dry-run` to see the call payload without placing a call.
- Auth is the Bland CLI profile (`bland auth login --device`); `~/.config/bland/env` holds the number and name. Never print, read aloud or commit a key.
