#!/usr/bin/env python3
"""Offline tests for gemini.py against a fake Gemini server. run: python3 test_gemini.py"""
import base64, json, os, subprocess, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "gemini.py")
KEY = "test-key-DO-NOT-PRINT-123"
PNG = b"\x89PNG\r\n\x1a\nfake"
SEEN = []
OVERRIDE = {}  # per-test canned replies: gen=(status, bytes), file=upload reply, parts=answer parts
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import gemini  # noqa: E402


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, body, headers=None):
        data = json.dumps(body).encode()
        self.send_response(200)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        SEEN.append({"method": "GET", "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": None})
        self.reply({"name": "files/abc", "uri": "https://fake/files/abc", "state": "ACTIVE"})

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            body = json.loads(raw)
        except ValueError:
            body = raw
        SEEN.append({"method": "POST", "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
        if self.path.startswith("/upload/v1beta/files"):
            port = self.server.server_address[1]
            return self.reply({}, {"X-Goog-Upload-URL": f"http://127.0.0.1:{port}/resumable/abc"})
        if self.path.startswith("/resumable/"):
            return self.reply(OVERRIDE.get("file") or {"file": {"name": "files/abc", "uri": "https://fake/files/abc", "state": "PROCESSING", "mimeType": "video/mp4"}})
        if "gen" in OVERRIDE:
            code, data = OVERRIDE["gen"]
            self.send_response(code)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if isinstance(body, dict) and "IMAGE" in body.get("generationConfig", {}).get("responseModalities", []):
            return self.reply({"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": base64.b64encode(PNG).decode()}}]}}]})
        return self.reply({"candidates": [{"content": {"parts": OVERRIDE.get("parts") or [{"text": "Answer [notes.md] at 00:05"}]}}]})


class GeminiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        SEEN.clear()
        OVERRIDE.clear()
        self.tmp = tempfile.mkdtemp()

    def run_cli(self, *args, key=KEY, keychain=None, base=None):
        env = {k: v for k, v in os.environ.items() if k != "GEMINI_API_KEY"}
        # A fake `security` first on PATH and an empty HOME, so a real Keychain entry or key file never leaks in.
        bin_dir = os.path.join(self.tmp, "bin")
        os.makedirs(bin_dir, exist_ok=True)
        with open(os.path.join(bin_dir, "security"), "w") as f:
            f.write("#!/bin/sh\n" + (f'[ "$*" = "find-generic-password -s switchboard -a GEMINI_API_KEY -w" ] && echo "{keychain}" && exit 0\n' if keychain else "") + "exit 44\n")
        os.chmod(os.path.join(bin_dir, "security"), 0o755)
        env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
        env["HOME"] = os.path.join(self.tmp, "home")
        env["GEMINI_BASE_URL"] = base or self.base
        env["GEMINI_POLL_SECONDS"] = "0"
        if key:
            env["GEMINI_API_KEY"] = key
        p = subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, env=env, cwd=self.tmp)
        self.assertNotIn(KEY, p.stdout + p.stderr)
        return p

    def assert_key_in_header_only(self):
        self.assertTrue(SEEN)
        for r in SEEN:
            if r["path"].startswith("/resumable/"):
                continue
            self.assertEqual(r["headers"].get("x-goog-api-key"), KEY)
            self.assertNotIn(KEY, r["path"])

    def test_missing_key(self):
        p = self.run_cli("image", "a cat", key=None)
        self.assertEqual(p.returncode, 1)
        self.assertIn("GEMINI_API_KEY", p.stderr)
        self.assertIn("Switchboard", p.stderr)
        self.assertEqual(len(p.stderr.strip().splitlines()), 1)
        self.assertFalse(SEEN)

    def test_keychain_fallback(self):
        p = self.run_cli("image", "a cat", "--out", os.path.join(self.tmp, "imgs"), key=None, keychain=KEY)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assert_key_in_header_only()

    def test_key_file_fallback(self):
        d = os.path.join(self.tmp, "home", ".claude", "switchboard", "keys")
        os.makedirs(d)
        with open(os.path.join(d, "GEMINI_API_KEY"), "w") as f:
            f.write(KEY + "\n")
        p = self.run_cli("image", "a cat", "--out", os.path.join(self.tmp, "imgs"), key=None)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assert_key_in_header_only()

    def test_env_wins_over_keychain(self):
        p = self.run_cli("image", "a cat", "--out", os.path.join(self.tmp, "imgs"), keychain="other-key-from-keychain-999")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assert_key_in_header_only()

    def test_keychain_key_masked_in_errors(self):
        OVERRIDE["gen"] = (400, json.dumps({"error": {"message": f"API key {KEY} not valid"}}).encode())
        p = self.run_cli("image", "a cat", "--out", self.tmp, key=None, keychain=KEY)
        self.assertEqual(p.returncode, 1)
        self.assertIn("***", p.stderr)

    def test_image_defaults(self):
        out = os.path.join(self.tmp, "imgs")
        p = self.run_cli("image", "a red fox", "--out", out)
        self.assertEqual(p.returncode, 0, p.stderr)
        files = sorted(os.listdir(out))
        self.assertEqual(len(files), 4)
        self.assertTrue(all(f.endswith(".png") for f in files))
        with open(os.path.join(out, files[0]), "rb") as f:
            self.assertEqual(f.read(), PNG)
        r = SEEN[0]
        self.assertIn("gemini-nano-banana-2.1:generateContent", r["path"])
        self.assertEqual(r["body"]["generationConfig"]["imageConfig"]["aspectRatio"], "16:9")
        self.assertIn("IMAGE", r["body"]["generationConfig"]["responseModalities"])
        self.assertIn("a red fox", r["body"]["contents"][0]["parts"][0]["text"])
        self.assert_key_in_header_only()

    def test_image_count_aspect_ref(self):
        ref = os.path.join(self.tmp, "style.png")
        with open(ref, "wb") as f:
            f.write(PNG)
        p = self.run_cli("image", "poster", "-n", "2", "--aspect", "1:1", "--ref", ref, "--out", "o")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(os.listdir(os.path.join(self.tmp, "o"))), 2)
        self.assertEqual(len(SEEN), 2)
        parts = SEEN[0]["body"]["contents"][0]["parts"]
        self.assertEqual(parts[1]["inline_data"]["mime_type"], "image/png")
        self.assertEqual(base64.b64decode(parts[1]["inline_data"]["data"]), PNG)
        self.assertEqual(SEEN[0]["body"]["generationConfig"]["imageConfig"]["aspectRatio"], "1:1")

    def test_video_local_upload(self):
        vid = os.path.join(self.tmp, "clip.mp4")
        with open(vid, "wb") as f:
            f.write(b"\x00" * 1000)
        p = self.run_cli("video", vid, "what happens?")
        self.assertEqual(p.returncode, 0, p.stderr)
        start = SEEN[0]
        self.assertTrue(start["path"].startswith("/upload/v1beta/files"))
        self.assertEqual(start["headers"]["x-goog-upload-protocol"], "resumable")
        self.assertEqual(start["headers"]["x-goog-upload-header-content-length"], "1000")
        self.assertEqual(start["headers"]["x-goog-upload-header-content-type"], "video/mp4")
        up = SEEN[1]
        self.assertEqual(up["headers"]["x-goog-upload-command"], "upload, finalize")
        self.assertEqual(len(up["body"]), 1000)
        self.assertEqual(SEEN[2]["method"], "GET")
        gen = SEEN[-1]["body"]["contents"][0]["parts"]
        self.assertEqual(gen[0]["file_data"]["file_uri"], "https://fake/files/abc")
        self.assertIn("what happens?", gen[1]["text"])
        self.assertIn("MM:SS", gen[1]["text"])
        out = os.path.join(self.tmp, "clip.gemini.md")
        with open(out) as f:
            text = f.read()
        self.assertIn("Answer", text)
        self.assertIn("what happens?", text)
        self.assertIn(out, p.stdout)
        self.assert_key_in_header_only()

    def test_video_youtube(self):
        p = self.run_cli("video", "https://www.youtube.com/watch?v=abc123", "summary")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(SEEN), 1)
        parts = SEEN[0]["body"]["contents"][0]["parts"]
        self.assertEqual(parts[0]["file_data"]["file_uri"], "https://www.youtube.com/watch?v=abc123")
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "youtube-abc123.gemini.md")))

    def test_video_other_url_refused(self):
        p = self.run_cli("video", "https://www.instagram.com/reel/xyz/", "summary")
        self.assertEqual(p.returncode, 1)
        self.assertIn("download", p.stderr)
        self.assertFalse(SEEN)

    def test_ask_sources(self):
        src = os.path.join(self.tmp, "nb")
        os.mkdir(src)
        with open(os.path.join(src, "notes.md"), "w") as f:
            f.write("The launch is in May.")
        with open(os.path.join(src, "paper.pdf"), "wb") as f:
            f.write(b"%PDF-1.4 fake")
        with open(os.path.join(src, "urls.txt"), "w") as f:
            f.write("https://example.com/a\n# skip\n\n")
        report = os.path.join(self.tmp, "report.md")
        p = self.run_cli("ask", src, "when is launch?", "--report", report)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Answer [notes.md]", p.stdout)
        body = SEEN[0]["body"]
        sysi = body["systemInstruction"]["parts"][0]["text"]
        self.assertIn("only", sysi.lower())
        flat = json.dumps(body["contents"])
        self.assertIn("The launch is in May.", flat)
        self.assertIn("notes.md", flat)
        self.assertIn("paper.pdf", flat)
        self.assertIn("application/pdf", flat)
        self.assertIn("https://example.com/a", flat)
        self.assertNotIn("# skip", flat)
        self.assertEqual(body["tools"], [{"url_context": {}}])
        with open(report) as f:
            self.assertIn("Answer [notes.md]", f.read())
        self.assert_key_in_header_only()

    def notebook(self, files):
        src = os.path.join(self.tmp, "nb")
        os.makedirs(src, exist_ok=True)
        for name, data in files.items():
            with open(os.path.join(src, name), "wb") as f:
                f.write(data)
        return src

    def assert_one_line_error(self, p, *needles):
        self.assertEqual(p.returncode, 1)
        lines = p.stderr.strip().splitlines()
        self.assertEqual(len(lines), 1, p.stderr)
        self.assertTrue(lines[0].startswith("gemini: "), p.stderr)
        for n in needles:
            self.assertIn(n, lines[0])

    def test_missing_folder(self):
        p = self.run_cli("ask", os.path.join(self.tmp, "missing"), "q")
        self.assert_one_line_error(p, "no such folder")
        self.assertFalse(SEEN)

    def test_api_error_masks_key(self):
        OVERRIDE["gen"] = (400, json.dumps({"error": {"message": f"API key {KEY} not valid"}}).encode())
        p = self.run_cli("ask", self.notebook({"a.md": b"x"}), "q")
        self.assert_one_line_error(p, "HTTP 400", "***")

    def test_non_json_reply(self):
        OVERRIDE["gen"] = (200, b"<html>proxy page</html>")
        p = self.run_cli("ask", self.notebook({"a.md": b"x"}), "q")
        self.assert_one_line_error(p, "not JSON")

    def test_thought_parts_dropped(self):
        OVERRIDE["parts"] = [{"text": "private reasoning", "thought": True}, {"text": "Final answer"}]
        p = self.run_cli("ask", self.notebook({"a.md": b"x"}), "q")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Final answer", p.stdout)
        self.assertNotIn("private reasoning", p.stdout)

    def video_file(self):
        vid = os.path.join(self.tmp, "clip.mp4")
        with open(vid, "wb") as f:
            f.write(b"\x00" * 10)
        return vid

    def test_upload_failed_state(self):
        OVERRIDE["file"] = {"file": {"name": "files/abc", "state": "FAILED"}}
        p = self.run_cli("video", self.video_file(), "q")
        self.assert_one_line_error(p, "could not process")
        self.assertFalse(any("generateContent" in r["path"] for r in SEEN))

    def test_upload_reply_without_name(self):
        OVERRIDE["file"] = {"file": {"state": "PROCESSING"}}
        p = self.run_cli("video", self.video_file(), "q")
        self.assert_one_line_error(p, "upload")

    def test_youtube_forms(self):
        for url, vid in [
            ("https://www.youtube.com/watch?v=abc123", "abc123"),
            ("https://youtube.com/watch?feature=x&v=abc123", "abc123"),
            ("https://m.youtube.com/shorts/abc123", "abc123"),
            ("https://www.youtube.com/live/abc123?si=z", "abc123"),
            ("https://www.youtube.com/embed/abc123", "abc123"),
            ("https://music.youtube.com/watch?v=abc123", "abc123"),
            ("https://youtu.be/abc123?t=10", "abc123"),
        ]:
            m = gemini.YOUTUBE.match(url)
            self.assertIsNotNone(m, url)
            self.assertEqual(m.group("id"), vid, url)
        self.assertIsNone(gemini.YOUTUBE.match("https://www.instagram.com/reel/abc123/"))

    def test_pdfs_switch_to_upload_past_budget(self):
        mb = 1024 * 1024
        src = self.notebook({"a.pdf": b"%PDF" + b"a" * (9 * mb), "b.pdf": b"%PDF" + b"b" * (9 * mb)})
        p = self.run_cli("ask", src, "q")
        self.assertEqual(p.returncode, 0, p.stderr)
        parts = SEEN[-1]["body"]["contents"][0]["parts"]
        self.assertEqual(sum("inline_data" in x for x in parts), 1)
        self.assertEqual(sum("file_data" in x for x in parts), 1)
        self.assertTrue(any(r["path"].startswith("/upload/v1beta/files") for r in SEEN))

    def test_request_hard_cap(self):
        src = self.notebook({"big.txt": b"x" * (101 * 1024 * 1024)})
        p = self.run_cli("ask", src, "q")
        self.assert_one_line_error(p, "100MB")
        self.assertFalse(SEEN)

    def test_pdf_source_tag_closed(self):
        self.run_cli("ask", self.notebook({"p.pdf": b"%PDF"}), "q")
        parts = SEEN[0]["body"]["contents"][0]["parts"]
        i = next(n for n, x in enumerate(parts) if "inline_data" in x)
        self.assertIn('<source name="p.pdf">', parts[i - 1]["text"])
        self.assertEqual(parts[i + 1]["text"], "</source>")

    def test_urls_capped(self):
        urls = "".join(f"https://example.com/{i}\n" for i in range(25)).encode()
        p = self.run_cli("ask", self.notebook({"urls.txt": urls}), "q")
        self.assertEqual(p.returncode, 0, p.stderr)
        flat = json.dumps(SEEN[0]["body"]["contents"])
        self.assertIn("https://example.com/19\\n", flat)
        self.assertNotIn("https://example.com/20", flat)
        self.assertEqual(len([l for l in p.stderr.splitlines() if "20" in l]), 1)

    def test_key_only_goes_to_base_host(self):
        self.assertTrue(gemini.for_gemini(gemini.BASE + "/v1beta/models"))
        self.assertTrue(gemini.for_gemini(gemini.BASE))
        self.assertFalse(gemini.for_gemini(gemini.BASE + ".evil.example/v1beta"))
        self.assertFalse(gemini.for_gemini("https://storage.example.com/upload"))

    def test_base_url_must_be_https_or_loopback(self):
        p = self.run_cli("image", "a cat", base="http://example.com")
        self.assert_one_line_error(p, "GEMINI_BASE_URL")
        self.assertFalse(SEEN)

    def test_bad_args_exit_2(self):
        self.assertEqual(self.run_cli("image").returncode, 2)


if __name__ == "__main__":
    unittest.main()
