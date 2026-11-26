#!/usr/bin/env python3
"""First draft from a local Ollama model, checked against its sources.

draft.py TASK [SOURCE_FILE ...]
Prints the draft, then a LOCAL-LLM line. Exit 0 ok, 2 failed checks twice, 3 server down.
"""
import json, os, sys, urllib.request

HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
if "://" not in HOST:
    HOST = "http://" + HOST
MODEL = os.environ.get("LOCAL_DRAFT_MODEL", "gemma3:12b")
# 16GB Mac: 12B weights plus a 128k KV cache will not fit, so start smaller
CTX = int(os.environ.get("LOCAL_DRAFT_CTX", "16384"))
TIMEOUT = int(os.environ.get("LOCAL_DRAFT_TIMEOUT", "900"))
MAX_OUT = int(os.environ.get("LOCAL_DRAFT_MAX_TOKENS", "1024"))  # caps a runaway reply

SYSTEM = (
    "You write first drafts that a stronger model checks. Answer only from the text between the "
    "SOURCE markers; if something is not there, say it is absent. Output only what was asked. "
    "Return JSON: sources = the exact file names you were given, quotes = two or three short "
    "verbatim quotes from the sources that your draft rests on, draft = the draft itself."
)
SCHEMA = {
    "type": "object",
    "properties": {
        "sources": {"type": "array", "items": {"type": "string"}},
        "quotes": {"type": "array", "items": {"type": "string"}},
        "draft": {"type": "string"},
    },
    "required": ["sources", "quotes", "draft"],
}


def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(HOST + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.load(r)


def loaded_ctx():
    # a different num_ctx than the loaded one reloads the model
    for m in call("/api/ps").get("models", []):
        if m.get("name") == MODEL or m.get("model") == MODEL:
            return m.get("context_length") or CTX
    return CTX


def problems(reply, sources):
    """What fails the echo and quote checks; empty list = passes."""
    out = []
    if not reply.get("draft", "").strip():
        out.append("empty draft")
    if not sources:
        return out
    if sorted(reply.get("sources", [])) != sorted(sources):
        out.append(f"echoed sources {reply.get('sources')} != {sorted(sources)}")
    text = "\n".join(sources.values())
    quotes = reply.get("quotes", [])
    if not quotes:
        out.append("no quotes")
    out += [f"quote not in source: {q!r}" for q in quotes if q.strip() not in text]
    return out


def main(argv):
    if not argv:
        print(__doc__.strip(), file=sys.stderr)
        return 1
    task, files = argv[0], argv[1:]
    sources = {os.path.basename(f): open(f, encoding="utf-8", errors="replace").read() for f in files}
    user = task + "".join(f"\n\n<<SOURCE {n}>>\n{t}\n<<END SOURCE {n}>>" for n, t in sources.items())
    try:
        ctx = loaded_ctx()
    except OSError as e:
        print(f"LOCAL-LLM: n/a - {HOST} unreachable ({e}); write it yourself")
        return 3
    issues = []
    for _ in range(2):  # reject and retry once, never patch a bad draft
        try:
            r = call("/api/chat", {
                "model": MODEL, "stream": False, "think": False, "format": SCHEMA,
                "options": {"num_ctx": ctx, "num_predict": MAX_OUT},
                "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
            })
        except OSError as e:  # 404 = model not pulled
            print(f"LOCAL-LLM: n/a - {MODEL} call failed ({e}); write it yourself")
            return 3
        used = r.get("model", MODEL)
        if r.get("prompt_eval_count", 0) >= ctx - 64:
            issues = [f"prompt filled num_ctx {ctx}, input likely cut; raise LOCAL_DRAFT_CTX or send less"]
            break
        try:
            reply = json.loads(r["message"]["content"])
        except (KeyError, ValueError):
            issues = ["reply was not JSON"]
            continue
        issues = problems(reply, sources)
        if not issues:
            print(reply["draft"].strip())
            src = ", ".join(sources) or "none (no sources given, check every claim by hand)"
            print(f"\nLOCAL-LLM: used - {used}, num_ctx {ctx}; VERIFIED-AGAINST: {src}; DISCREPANCIES: 0")
            return 0
    print("\n".join(issues), file=sys.stderr)
    print(f"LOCAL-LLM: n/a - {MODEL} failed checks ({len(issues)}); write it yourself")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
