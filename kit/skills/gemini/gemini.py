#!/usr/bin/env python3
"""Gemini from the command line: images, video answers, source-grounded notebooks.

usage:
  gemini.py image PROMPT [-n 4] [--aspect 16:9] [--ref IMAGE] [--out DIR]
  gemini.py video FILE_OR_YOUTUBE_URL QUESTION [--out FILE]
  gemini.py ask SOURCES_DIR QUESTION [--report FILE]

key: GEMINI_API_KEY from the environment, else the one Switchboard saved; sent as the x-goog-api-key header
models: GEMINI_IMAGE_MODEL (gemini-nano-banana-2.1), GEMINI_MODEL (gemini-3.8-flash)
exit 0 ok, 1 config or API error, 2 bad arguments
"""
import argparse, base64, functools, json, mimetypes, os, re, subprocess, sys, time, urllib.error, urllib.request

BASE = os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com").rstrip("/")
IMAGE_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-nano-banana-2.1")
TEXT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
POLL = float(os.environ.get("GEMINI_POLL_SECONDS", "5"))
MB = 1024 * 1024
INLINE_BUDGET = 20 * MB  # past this, PDFs go through the Files API
REQUEST_MAX = 100 * MB  # Gemini's request size limit
MAX_URLS = 20  # url_context limit per request
TEXT_EXT = {".md", ".markdown", ".txt"}
YOUTUBE = re.compile(r"^https?://(?:(?:www|m|music)\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)(?P<id>[\w-]{6,})")


class Fail(Exception):
    pass


@functools.lru_cache(maxsize=None)
def saved_key(name):
    """The key Switchboard's Sign-ins saved: the macOS Keychain, else ~/.claude/switchboard/keys/NAME."""
    try:
        r = subprocess.run(["security", "find-generic-password", "-s", "switchboard", "-a", name, "-w"], capture_output=True, text=True, timeout=10)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        with open(os.path.join(os.path.expanduser("~"), ".claude", "switchboard", "keys", name)) as f:
            return f.read().strip()
    except OSError:
        return ""


def for_gemini(url):
    return url == BASE or url.startswith(BASE + "/")


def key():
    # the key only ever goes to BASE, so BASE has to be Google over https or a local test server
    if not re.match(r"^(https://|http://(127\.0\.0\.1|localhost)(:\d+)?$)", BASE):
        raise Fail("GEMINI_BASE_URL must be https or a loopback http URL")
    k =os.environ.get("GEMINI_API_KEY", "").strip() or saved_key("GEMINI_API_KEY")
    if not k:
        raise Fail("GEMINI_API_KEY is not set: paste it in Switchboard (Settings, Accounts, API keys) or export it")
    return k


def call(url, body=None, headers=None, data=None, method="POST"):
    """JSON request. Returns (parsed body, response headers)."""
    h = dict(headers or {})
    if for_gemini(url):
        h["x-goog-api-key"] = key()
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            raw = r.read()
            try:
                return (json.loads(raw) if raw.strip() else {}), r.headers
            except ValueError:
                raise Fail(f"reply from {url.split('?')[0]} was not JSON")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", {}).get("message", "")
        except ValueError:
            msg = ""
        raise Fail(f"HTTP {e.code} from Gemini: {msg or e.reason}")
    except urllib.error.URLError as e:
        raise Fail(f"could not reach Gemini: {e.reason}")


def generate(model, parts, **extra):
    body, _ = call(f"{BASE}/v1beta/models/{model}:generateContent", {"contents": [{"role": "user", "parts": parts}], **extra})
    cands = body.get("candidates") or []
    if not cands:
        why = (body.get("promptFeedback") or {}).get("blockReason", "no candidates")
        raise Fail(f"Gemini returned nothing ({why})")
    return cands[0].get("content", {}).get("parts", [])


def text_of(parts):
    return "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()


def mime(path, fallback="application/octet-stream"):
    return mimetypes.guess_type(path)[0] or fallback


def upload(path):
    """Files API resumable upload; waits until the file is ACTIVE. Returns (uri, mime)."""
    size, mt = os.path.getsize(path), mime(path)
    _, h = call(f"{BASE}/upload/v1beta/files", {"file": {"display_name": os.path.basename(path)}}, {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": str(size),
        "X-Goog-Upload-Header-Content-Type": mt,
    })
    url = h.get("X-Goog-Upload-URL")
    if not url:
        raise Fail("upload start gave no upload URL")
    with open(path, "rb") as f:
        info, _ = call(url, data=f, headers={
            "Content-Length": str(size), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize"})
    f = info.get("file", {})
    # 240 polls at 5s, about 20 min; raise it if long videos time out
    for _ in range(240):
        if f.get("state") == "ACTIVE":
            return f["uri"], f.get("mimeType") or mt
        if f.get("state") == "FAILED":
            raise Fail(f"Gemini could not process {os.path.basename(path)}")
        if not f.get("name"):
            raise Fail("upload reply had no file name")
        time.sleep(POLL)
        f, _ = call(f"{BASE}/v1beta/{f['name']}", method="GET")
    raise Fail("file still processing after 20 minutes")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "image"


def cmd_image(a):
    key()
    parts = [{"text": a.prompt}]
    if a.ref:
        with open(a.ref, "rb") as f:
            parts.append({"inline_data": {"mime_type": mime(a.ref, "image/png"), "data": base64.b64encode(f.read()).decode()}})
    cfg = {"responseModalities": ["TEXT", "IMAGE"], "imageConfig": {"aspectRatio": a.aspect}}
    os.makedirs(a.out, exist_ok=True)
    stem, saved = f"{slug(a.prompt)}-{time.strftime('%Y%m%d-%H%M%S')}", []
    # one image per call, so N calls
    for i in range(1, a.n + 1):
        out = generate(IMAGE_MODEL, parts, generationConfig=cfg)
        img = next((p.get("inlineData") or p.get("inline_data") for p in out if p.get("inlineData") or p.get("inline_data")), None)
        if not img:
            print(f"image {i}: no image back. {text_of(out)[:200]}", file=sys.stderr)
            continue
        ext = mimetypes.guess_extension(img.get("mimeType") or img.get("mime_type") or "image/png") or ".png"
        path = os.path.join(a.out, f"{stem}-{i}{ext}")
        with open(path, "wb") as f:
            f.write(base64.b64decode(img["data"]))
        saved.append(path)
        print(path)
    if not saved:
        raise Fail("no images were generated")


def cmd_video(a):
    key()
    yt = YOUTUBE.match(a.source)
    if yt:
        part, out = {"file_data": {"file_uri": a.source}}, f"youtube-{yt.group("id")}.gemini.md"
    elif re.match(r"^https?://", a.source):
        raise Fail("only YouTube URLs go straight to Gemini; download the video first and pass the local file")
    elif os.path.isfile(a.source):
        uri, mt = upload(a.source)
        part, out = {"file_data": {"file_uri": uri, "mime_type": mt}}, os.path.splitext(a.source)[0] + ".gemini.md"
    else:
        raise Fail(f"no such file: {a.source}")
    q = f"{a.question}\n\nGive a timestamp (MM:SS) for each point you make."
    answer = text_of(generate(TEXT_MODEL, [part, {"text": q}]))
    out = os.path.abspath(a.out or out)
    with open(out, "w") as f:
        f.write(f"# {a.question}\n\nSource: {a.source}\n\n{answer}\n")
    print(answer)
    print(f"\nsaved: {out}")


NOTEBOOK_RULES = (
    "Answer only from the sources provided. Do not use outside knowledge. "
    "After every claim, cite the source it came from in square brackets, like [notes.md] or [https://example.com/page]. "
    "If the sources do not answer the question, say so plainly instead of guessing."
)


def cmd_ask(a):
    key()
    if not os.path.isdir(a.sources):
        raise Fail(f"no such folder: {a.sources}")
    parts, urls, names, size = [], [], [], 0
    for name in sorted(os.listdir(a.sources)):
        path, ext = os.path.join(a.sources, name), os.path.splitext(name)[1].lower()
        if not os.path.isfile(path) or name.startswith("."):
            continue
        if name == "urls.txt":
            with open(path) as f:
                urls += [l.strip() for l in f if l.strip() and not l.lstrip().startswith("#")]
        elif ext in TEXT_EXT:
            with open(path, errors="replace") as f:
                text = f'<source name="{name}">\n{f.read()}\n</source>'
            size += len(text.encode())
            if size > REQUEST_MAX:
                raise Fail(f"sources are over Gemini's 100MB request limit at {name}")
            parts.append({"text": text})
            names.append(name)
        elif ext == ".pdf":
            parts.append({"text": f'<source name="{name}">'})
            b64 = (os.path.getsize(path) + 2) // 3 * 4
            if size + b64 > INLINE_BUDGET:
                uri, mt = upload(path)
                parts.append({"file_data": {"file_uri": uri, "mime_type": mt}})
            else:
                with open(path, "rb") as f:
                    parts.append({"inline_data": {"mime_type": "application/pdf", "data": base64.b64encode(f.read()).decode()}})
                size += b64
            parts.append({"text": "</source>"})
            names.append(name)
        else:
            print(f"skipped {name}: only md, txt, pdf and urls.txt", file=sys.stderr)
    if len(urls) > MAX_URLS:
        print(f"urls.txt has {len(urls)} URLs; Gemini reads at most {MAX_URLS} per request, using the first {MAX_URLS}", file=sys.stderr)
        urls = urls[:MAX_URLS]
    if urls:
        parts.append({"text": "<source name=\"urls\">Read these pages as sources:\n" + "\n".join(urls) + "\n</source>"})
    if not parts:
        raise Fail(f"no sources in {a.sources}")
    parts.append({"text": f"Question: {a.question}"})
    extra = {"systemInstruction": {"parts": [{"text": NOTEBOOK_RULES}]}}
    if urls:
        extra["tools"] = [{"url_context": {}}]
    answer = text_of(generate(TEXT_MODEL, parts, **extra))
    print(answer)
    if a.report:
        listed = "\n".join(f"- {s}" for s in names + urls)
        with open(a.report, "w") as f:
            f.write(f"# {a.question}\n\n{answer}\n\n## Sources\n\n{listed}\n")
        print(f"\nsaved: {os.path.abspath(a.report)}")


def main():
    p = argparse.ArgumentParser(prog="gemini.py", description="Gemini images, video answers and notebooks")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("image")
    s.add_argument("prompt")
    s.add_argument("-n", type=int, default=4)
    s.add_argument("--aspect", default="16:9")
    s.add_argument("--ref", help="style or reference image")
    s.add_argument("--out", default="gemini-images")
    s.set_defaults(fn=cmd_image)
    s = sub.add_parser("video")
    s.add_argument("source")
    s.add_argument("question")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_video)
    s = sub.add_parser("ask")
    s.add_argument("sources")
    s.add_argument("question")
    s.add_argument("--report")
    s.set_defaults(fn=cmd_ask)
    a = p.parse_args()
    try:
        a.fn(a)
    except (Fail, OSError) as e:
        msg = str(e)
        try:
            k = key()
        except Fail:
            k = ""
        for secret in {k, os.environ.get("GEMINI_API_KEY", "").strip()} - {""}:
            msg = msg.replace(secret, "***")
        print(f"gemini: {msg}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
