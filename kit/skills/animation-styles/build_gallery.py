#!/usr/bin/env python3
"""Rebuild the gallery from references/styles.md.

gallery.html: live demos only, never requests reference media.
reference/gallery.html: same page with the reel clips beside each demo, only written when reference/ exists.
--check exits 1 if either page is stale.
"""
import html, pathlib, re, sys

HERE = pathlib.Path(__file__).parent
REF = HERE / 'reference'
SECTION = re.compile(r'^## (\d\d) (.+)$', re.M)
LEDE = {
    False: "Twenty looks from one reel, each rebuilt as a small vanilla snippet and running live. Copy a prompt and paste it into any chat.",
    True: "Twenty looks from one reel, each rebuilt as a small vanilla snippet. Left is the reel's clip, right is the recipe running live. Copy a prompt and paste it into any chat.",
}


def cards(refs):
    md = (HERE / 'references/styles.md').read_text()
    parts = SECTION.split(md)[1:]
    out = []
    e = html.escape
    for num, name, body in zip(parts[0::3], parts[1::3], parts[2::3]):
        tech = re.search(r'^\*\*Technique:\*\* (.+)$', body, re.M).group(1).replace('`', '')
        prompt = re.search(r'^> (.+)$', body, re.M).group(1)
        snippet = re.search(r'^```html\n(.*?)\n```', body, re.M | re.S).group(1)
        slug = f"{num}-{name.lower().replace(' ', '-')}"
        ref = ''
        if refs:
            assert (REF / f'clips/{slug}.mp4').exists() and (REF / f'frames/{slug}.jpg').exists(), f'missing media for {slug}'
            ref = f'\n    <figure><video src="clips/{slug}.mp4" poster="frames/{slug}.jpg" muted loop playsinline preload="none" aria-label="{e(name)} reference clip"></video><figcaption>Reference</figcaption></figure>'
        out.append(f'''<article class="card" id="s{num}">
  <div class="pair{'' if refs else ' one'}">{ref}
    <figure><iframe sandbox="allow-scripts" title="{e(name)} live demo" tabindex="-1"></iframe><figcaption>Live</figcaption></figure>
  </div>
  <div class="head"><span class="num">{num}</span><h2>{e(name)}</h2><span class="tag">{e(tech)}</span></div>
  <p class="prompt">{e(prompt)}</p>
  <div class="actions"><button class="copy" type="button">Copy prompt</button>
    <details><summary>Show snippet</summary><pre><code>{e(snippet)}</code></pre></details></div>
  <template>{snippet}</template>
</article>''')
    assert len(out) == 20, f'expected 20 styles, got {len(out)}'
    return '\n'.join(out)


def render(shell, refs):
    page = re.sub(r'(<!-- cards -->\n).*?(<!-- /cards -->)', lambda m: m[1] + cards(refs) + '\n' + m[2], shell, flags=re.S)
    return re.sub(r'(<p class="lede">).*?(</p>)', lambda m: m[1] + LEDE[refs] + m[2], page, flags=re.S)


shell = (HERE / 'gallery.html').read_text()
targets = {HERE / 'gallery.html': render(shell, False)}
if REF.is_dir():
    targets[REF / 'gallery.html'] = render(shell, True)

if '--check' in sys.argv:
    stale = [p.name if p.parent == HERE else 'reference/' + p.name for p, new in targets.items() if not p.exists() or p.read_text() != new]
    sys.exit(f'stale: {", ".join(stale)}, run build_gallery.py' if stale else 0)
for p, new in targets.items():
    p.write_text(new)
    print('wrote', p.relative_to(HERE))
