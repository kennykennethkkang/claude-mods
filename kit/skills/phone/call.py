#!/usr/bin/env python3
"""Phone the owner through the Bland CLI, wait for the call to end, print their answer.

usage: call.py "question" ["context"] [--dry-run]
reads ~/.config/bland/env (PHONE_TO, PHONE_NAME, optional BLAND_API_KEY)
auth: the bland CLI profile (bland auth login --device) or BLAND_API_KEY
exit 0 answered, 2 no human, 1 config or API error
"""
import json, os, subprocess, sys, time

ENV = os.path.expanduser("~/.config/bland/env")

def load_env():
    cfg = {}
    if not os.path.exists(ENV):
        return cfg
    for line in open(ENV):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"')
    return cfg

def bland(*args):
    out = subprocess.run(["bland", *args, "--json"], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError((out.stderr or out.stdout).strip()[:500])
    text = out.stdout.strip()
    return json.loads(text[text.index("{"):]) if "{" in text else {}

def main():
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    dry = "--dry-run" in sys.argv
    if not args:
        print(__doc__); return 1
    question, context = args[0], (args[1] if len(args) > 1 else "")
    cfg = load_env()
    to, name = cfg.get("PHONE_TO"), cfg.get("PHONE_NAME") or "there"
    if cfg.get("BLAND_API_KEY"):
        os.environ["BLAND_API_KEY"] = cfg["BLAND_API_KEY"]
    if not dry and not to:
        print(f"fill PHONE_TO in {ENV}"); return 1
    task = (
        f"You are calling {name} on behalf of their coding agent, Claude Code, which is paused "
        f"waiting for one decision. Be brief and plain. "
        f"Ask exactly this question: \"{question}\" "
        + (f"Background they may want: {context} " if context else "")
        + "If a screener or assistant asks who is calling or why, say: 'This is Claude Code, "
        f"{name}'s coding agent, calling about a quick decision', then wait to be put through; "
        f"do not hang up until you have spoken with {name} or the line ends. "
        "If they ask for more detail, answer only from the background. Once they decide, "
        "repeat their decision back in one sentence starting with the words 'So your decision is' "
        "and ask if that is right. When they confirm, say you will pass it on and end the call. "
        "If they say call back later or cannot decide, say okay and end the call."
    )
    cmd = ["call", "send", to or "+1XXXXXXXXXX", "--task", task,
           "--first-sentence", f"Hi {name}, this is Claude Code. I need a quick decision from you.",
           "--max-duration", "5"]
    if dry:
        print("bland " + " ".join(json.dumps(c) if " " in c else c for c in cmd)); return 0
    try:
        res = bland(*cmd)
    except RuntimeError as e:
        print("bland error:", e); return 1
    call_id = res.get("call_id")
    if not call_id:
        print("bland error:", res); return 1
    print("calling", to, "call_id", call_id, flush=True)
    deadline = time.time() + 60 * 8
    call = {}
    while time.time() < deadline:
        time.sleep(5)
        call = bland("call", "get", call_id)
        if call.get("completed"):
            break
    if not call.get("completed"):
        print("timed out waiting for the call to end"); return 2
    # the summary can lag the hangup by up to a minute
    for _ in range(12):
        if call.get("summary"): break
        time.sleep(5); call = bland("call", "get", call_id)
    decision = next((t["text"] for t in reversed(call.get("transcripts") or [])
                     if t.get("user") == "assistant" and "decision is" in t.get("text", "").lower()), None)
    print("status:", call.get("status"), "answered_by:", call.get("answered_by"))
    print("ANSWER:", decision or call.get("summary") or "NO DECISION")
    print("--- transcript")
    print(call.get("concatenated_transcript") or "(none)")
    return 0 if call.get("answered_by") == "human" and call.get("status") == "completed" else 2

if __name__ == "__main__":
    sys.exit(main())
