---
name: gemini
description: Use when the user says "gemini", "nano banana", "make an image", "generate images", "make a picture or thumbnail or poster", "watch this video", "what happens in this video", "summarize this YouTube", "notebook", "notebooklm", "answer from these sources", "cite the sources", or hands over a video file, a YouTube link, or a folder of md, txt or pdf sources with a question.
---

# Gemini

One script, three jobs: images with Nano Banana, answers about a video, and notebook answers grounded in a folder of sources.

The key comes from `GEMINI_API_KEY` in the env, else the one saved in Switchboard (Settings, Accounts, API keys). `zsh -ic` also picks up an old one from `~/.zshrc`:

```bash
zsh -ic 'python3 ~/.claude/skills/gemini/gemini.py "$@"' _ image "a lighthouse at dawn, film grain"
zsh -ic 'python3 ~/.claude/skills/gemini/gemini.py "$@"' _ video ~/Movies/talk.mp4 "What are the main points?"
zsh -ic 'python3 ~/.claude/skills/gemini/gemini.py "$@"' _ ask ./sources "What changed in v2?" --report report.md
```

The `_` fills `$0`; everything after it reaches the script as-is, so quote each argument once.

## image

`image PROMPT [-n 4] [--aspect 16:9] [--ref IMAGE] [--out gemini-images]`

- Makes N images (one call each) and prints each saved path.
- `--aspect`: 1:1, 3:4, 4:3, 9:16, 16:9, 21:9 and the other ratios the model takes.
- `--ref`: a style or reference image sent with the prompt ("in the style of this", "keep this character").
- Model: `gemini-nano-banana-2.1`. Set `GEMINI_IMAGE_MODEL=gemini-3-pro-image` for Nano Banana Pro.
- After it runs, Read one or two of the files to check them before telling the user they are good.

## video

`video FILE_OR_YOUTUBE_URL QUESTION [--out FILE]`

- Local file: uploaded through the Files API, then asked. Long uploads take minutes; run it in the background for big files.
- YouTube URL (public only; watch, shorts, live, embed, music.youtube.com, youtu.be): sent as a link, no download.
- Any other URL (Instagram, TikTok, X): refused. If a local download already exists, pass that file. Do not download it.
- If the call fails (503 or 429), do not cycle models: pull frames with `ffmpeg -i FILE -vf "fps=1,scale=360:-2,tile=4x3" sheet%02d.jpg` and Read the sheets. On-screen text and captions read fine.
- The answer asks for a MM:SS timestamp per point and is saved next to the video as `<name>.gemini.md` (YouTube: `youtube-<id>.gemini.md` in the current folder).

## ask (notebook)

`ask SOURCES_DIR QUESTION [--report FILE]`

- Sources: every `.md`, `.markdown`, `.txt` and `.pdf` in the folder, plus `urls.txt` (one URL per line, `#` comments allowed, first 20 used). Other files are skipped with a note.
- PDFs go inline until the request nears 20MB, then through the Files API. Text sources over 100MB in total are refused.
- Gemini answers only from those sources and cites each claim as `[file name]` or `[url]`. If the sources do not cover it, it says so.
- `--report` writes the answer and the source list to a markdown file.
- Pass the answer on with its citations intact. Do not fill gaps from your own knowledge without saying so.

## Setup and errors

- Key: paste it in Switchboard, Settings, Accounts, API keys (from aistudio.google.com/apikey); it lives in the macOS Keychain (service `switchboard`). `GEMINI_API_KEY` in the env wins. Missing key prints one line saying so and exits 1.
- Never print, echo or log the key, and never put it in a URL. The script sends it as the `x-goog-api-key` header and masks it in errors.
- Text model: `gemini-3.8-flash`, change with `GEMINI_MODEL`.
- Exit 0 ok, 1 config or API error (one line on stderr starting `gemini:`), 2 bad arguments.
- Tests (offline, fake server): `python3 ~/.claude/skills/gemini/test_gemini.py`
