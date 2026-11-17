#!/usr/bin/env node
// Reads a repo's manifests and prints its test, lint, typecheck and build commands plus the ecc-agents reviewer and build resolver.
// Usage: node toolchain.mjs [repo] [--json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'out', 'Pods', 'venv', '__pycache__'])
const ecc = n => n && `ecc-agents:${n}`

function scan(top, rel) {
  const dir = path.join(top, rel)
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  const has = f => names.includes(f)
  const read = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8') } catch { return '' } }
  const json = f => { try { return JSON.parse(read(f)) } catch { return {} } }
  // Lockfiles usually sit at the monorepo root.
  const lock = f => has(f) || fs.existsSync(path.join(top, f))
  const out = []
  const add = e => out.push(Object.fromEntries(Object.entries({ dir: rel, ...e, reviewer: ecc(e.reviewer), resolver: ecc(e.resolver) }).filter(([, v]) => v)))

  if (has('package.json')) {
    const pkg = json('package.json'), s = pkg.scripts ?? {}, deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const pm = lock('pnpm-lock.yaml') ? 'pnpm' : lock('yarn.lock') ? 'yarn' : lock('bun.lockb') || lock('bun.lock') ? 'bun' : 'npm'
    const exec = { pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx', npm: 'npx' }[pm]
    const ts = has('tsconfig.json') || !!deps.typescript
    const tc = ['typecheck', 'type-check', 'tsc', 'check-types'].find(k => s[k])
    add({
      lang: ts ? 'TypeScript' : 'JavaScript', via: `package.json, ${pm}`,
      test: s.test && `${pm} test`, lint: s.lint && `${pm} run lint`,
      typecheck: tc ? `${pm} run ${tc}` : has('tsconfig.json') && `${exec} tsc --noEmit`,
      build: s.build && `${pm} run build`,
      reviewer: deps.react ? 'react-reviewer' : deps.vue ? 'vue-reviewer' : 'typescript-reviewer',
      resolver: deps.react ? 'react-build-resolver' : 'build-error-resolver',
    })
  }

  const pyFiles = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'setup.py', 'setup.cfg', 'Pipfile'].filter(has)
  if (pyFiles.length) {
    const text = pyFiles.map(read).join('\n').toLowerCase()
    const dep = n => new RegExp(`(^|["'\\s])${n}\\b`, 'm').test(text)
    const run = has('uv.lock') ? 'uv run ' : has('poetry.lock') ? 'poetry run ' : has('Pipfile') ? 'pipenv run ' : ''
    const django = has('manage.py') || dep('django'), pytest = dep('pytest') || text.includes('[tool.pytest') || has('pytest.ini') || has('conftest.py')
    add({
      lang: 'Python', via: [...pyFiles, run && run.split(' ')[0]].filter(Boolean).join(', '),
      test: run + (pytest ? 'pytest' : django ? 'python manage.py test' : 'python -m unittest'),
      lint: (text.includes('[tool.ruff') || has('ruff.toml') || dep('ruff')) && `${run}ruff check .`,
      typecheck: (text.includes('[tool.mypy') || has('mypy.ini') || dep('mypy')) ? `${run}mypy .`
        : (text.includes('[tool.pyright') || has('pyrightconfig.json') || dep('pyright')) && `${run}pyright`,
      build: text.includes('[build-system]') && (run.startsWith('uv') ? 'uv build' : run.startsWith('poetry') ? 'poetry build' : 'python -m build'),
      reviewer: django ? 'django-reviewer' : dep('fastapi') ? 'fastapi-reviewer' : 'python-reviewer',
      resolver: django ? 'django-build-resolver' : dep('torch') ? 'pytorch-build-resolver' : undefined,
    })
  }

  if (has('go.mod')) add({ lang: 'Go', via: 'go.mod', test: 'go test ./...', lint: names.some(n => n.startsWith('.golangci')) ? 'golangci-lint run' : 'go vet ./...', build: 'go build ./...', reviewer: 'go-reviewer', resolver: 'go-build-resolver' })
  if (has('Cargo.toml')) add({ lang: 'Rust', via: 'Cargo.toml', test: 'cargo test', lint: 'cargo clippy -- -D warnings', typecheck: 'cargo check', build: 'cargo build', reviewer: 'rust-reviewer', resolver: 'rust-build-resolver' })

  const xc = names.find(n => n.endsWith('.xcworkspace')) ?? names.find(n => n.endsWith('.xcodeproj'))
  if (has('Package.swift')) add({ lang: 'Swift', via: 'Package.swift', test: 'swift test', build: 'swift build', reviewer: 'swift-reviewer', resolver: 'swift-build-resolver' })
  else if (xc) {
    // ponytail: scheme guessed from the project name; `xcodebuild -list` when it is wrong.
    const flag = xc.endsWith('.xcworkspace') ? '-workspace' : '-project', scheme = xc.replace(/\.\w+$/, '')
    const base = `xcodebuild ${flag} ${xc} -scheme ${scheme}`
    add({ lang: 'Swift', via: xc, test: `${base} test (check schemes with xcodebuild -list)`, build: `${base} build`, reviewer: 'swift-reviewer', resolver: 'swift-build-resolver' })
  }

  const gradle = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].filter(has)
  if (gradle.length || has('gradlew') || has('pom.xml')) {
    const kt = /kotlin/i.test([...gradle, 'pom.xml'].map(read).join('\n')) || has('build.gradle.kts') && fs.existsSync(path.join(dir, 'src/main/kotlin'))
    const g = has('gradlew') ? './gradlew' : 'gradle', l = kt ? 'kotlin' : 'java'
    const cmds = gradle.length || has('gradlew') ? { via: has('gradlew') ? 'gradlew' : gradle[0], test: `${g} test`, build: `${g} build` } : { via: 'pom.xml', test: 'mvn test', build: 'mvn package' }
    add({ lang: kt ? 'Kotlin' : 'Java', ...cmds, reviewer: `${l}-reviewer`, resolver: `${l}-build-resolver` })
  }

  if (has('Gemfile')) {
    const gems = read('Gemfile')
    add({ lang: 'Ruby', via: 'Gemfile', test: /rspec/.test(gems) || has('spec') ? 'bundle exec rspec' : 'bundle exec rake test', lint: /rubocop/.test(gems) && 'bundle exec rubocop', reviewer: 'ruby-reviewer' })
  }

  if (has('composer.json')) {
    const c = json('composer.json'), dev = { ...c.require, ...c['require-dev'] }
    add({
      lang: 'PHP', via: 'composer.json',
      test: c.scripts?.test ? 'composer test' : (dev['phpunit/phpunit'] || has('phpunit.xml') || has('phpunit.xml.dist')) && 'vendor/bin/phpunit',
      typecheck: dev['phpstan/phpstan'] && 'vendor/bin/phpstan analyse', reviewer: 'php-reviewer',
    })
  }

  const net = names.find(n => /\.(sln|csproj|fsproj)$/.test(n))
  if (net) {
    const fs_ = names.some(n => n.endsWith('.fsproj'))
    add({ lang: fs_ ? 'F#' : 'C#', via: net, test: 'dotnet test', lint: 'dotnet format --verify-no-changes', build: 'dotnet build', reviewer: fs_ ? 'fsharp-reviewer' : 'csharp-reviewer' })
  }

  if (has('pubspec.yaml')) {
    const fl = /sdk:\s*flutter/.test(read('pubspec.yaml')), t = fl ? 'flutter' : 'dart'
    add({ lang: fl ? 'Flutter' : 'Dart', via: 'pubspec.yaml', test: `${t} test`, lint: `${t} analyze`, reviewer: fl && 'flutter-reviewer', resolver: 'dart-build-resolver' })
  }

  if (has('CMakeLists.txt')) add({ lang: 'C/C++', via: 'CMakeLists.txt', test: 'ctest --test-dir build', build: 'cmake -S . -B build && cmake --build build', reviewer: 'cpp-reviewer', resolver: 'cpp-build-resolver' })
  // A Makefile alone is only C/C++ when nothing else claimed the folder.
  else if (has('Makefile') && !out.length) add({ lang: 'C/C++', via: 'Makefile', test: /^test:/m.test(read('Makefile')) && 'make test', build: 'make', reviewer: 'cpp-reviewer', resolver: 'cpp-build-resolver' })
  return out
}

// Single-line `run:` steps from GitHub workflows, as hints.
function ciRuns(top) {
  const wf = path.join(top, '.github', 'workflows'), runs = []
  let files = []
  try { files = fs.readdirSync(wf).filter(f => /\.ya?ml$/.test(f)) } catch { return runs }
  for (const f of files) {
    for (const m of fs.readFileSync(path.join(wf, f), 'utf8').matchAll(/^\s*(?:-\s*)?run:\s*(.+)$/gm)) {
      const cmd = m[1].trim().replace(/^["']|["']$/g, '')
      if (!/^[|>]/.test(cmd) && !runs.includes(cmd)) runs.push(cmd)
    }
  }
  return runs.slice(0, 15)
}

export function detect(repo) {
  const top = path.resolve(repo)
  let subs = []
  try {
    subs = fs.readdirSync(top, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name)).map(d => d.name).sort()
  } catch { /* unreadable */ }
  return { repo: top, entries: ['.', ...subs].flatMap(rel => scan(top, rel)), ci: ciRuns(top) }
}

const LABELS = [['test', 'Test'], ['lint', 'Lint'], ['typecheck', 'Typecheck'], ['build', 'Build'], ['reviewer', 'Reviewer'], ['resolver', 'Build resolver']]

export function render({ repo, entries, ci }) {
  const lines = [repo]
  if (!entries.length) lines.push('No manifests found at the root or one level down. Check CLAUDE.md, CI or the README.')
  for (const e of entries) {
    lines.push('', `${e.dir === '.' ? '(root)' : `${e.dir}/`} ${e.lang} (${e.via})`)
    for (const [k, label] of LABELS) if (e[k]) lines.push(`  ${label}: ${e.dir === '.' || k === 'reviewer' || k === 'resolver' ? '' : `cd ${e.dir} && `}${e[k]}`)
  }
  if (ci.length) lines.push('', 'CI runs:', ...ci.map(c => `  ${c}`))
  return lines.join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2), r = detect(args.find(a => !a.startsWith('--')) ?? '.')
  console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : render(r))
}
