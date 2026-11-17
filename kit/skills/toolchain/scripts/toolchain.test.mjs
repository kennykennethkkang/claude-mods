import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { detect, render } from './toolchain.mjs'

const repo = files => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-'))
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.writeFileSync(path.join(dir, f), text)
  }
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
const one = (files, lang) => detect(repo(files)).entries.find(e => !lang || e.lang === lang)

test('pnpm TypeScript with scripts and tsconfig', () => {
  const e = one({ 'package.json': JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .', build: 'tsc -b' } }), 'pnpm-lock.yaml': '', 'tsconfig.json': '{}' })
  assert.equal(e.lang, 'TypeScript')
  assert.equal(e.test, 'pnpm test')
  assert.equal(e.lint, 'pnpm run lint')
  assert.equal(e.typecheck, 'pnpm exec tsc --noEmit')
  assert.equal(e.build, 'pnpm run build')
  assert.equal(e.reviewer, 'ecc-agents:typescript-reviewer')
  assert.equal(e.resolver, 'ecc-agents:build-error-resolver')
})

test('react and vue pick their own agents, typecheck script wins over tsc', () => {
  const r = one({ 'package.json': JSON.stringify({ scripts: { typecheck: 'tsc' }, dependencies: { react: '18' } }), 'yarn.lock': '', 'tsconfig.json': '{}' })
  assert.equal(r.typecheck, 'yarn run typecheck')
  assert.equal(r.reviewer, 'ecc-agents:react-reviewer')
  assert.equal(r.resolver, 'ecc-agents:react-build-resolver')
  const v = one({ 'package.json': JSON.stringify({ dependencies: { vue: '3' } }), 'bun.lockb': '' })
  assert.equal(v.lang, 'JavaScript')
  assert.equal(v.reviewer, 'ecc-agents:vue-reviewer')
  assert.equal(v.test, undefined)
})

test('python with uv, ruff, mypy, fastapi', () => {
  const e = one({ 'pyproject.toml': '[project]\ndependencies = ["fastapi", "pytest"]\n[tool.ruff]\n[tool.mypy]\n', 'uv.lock': '' })
  assert.equal(e.test, 'uv run pytest')
  assert.equal(e.lint, 'uv run ruff check .')
  assert.equal(e.typecheck, 'uv run mypy .')
  assert.equal(e.reviewer, 'ecc-agents:fastapi-reviewer')
  assert.equal(e.resolver, undefined)
})

test('django on poetry, pytorch on pip', () => {
  const d = one({ 'pyproject.toml': '[tool.poetry.dependencies]\nDjango = "5"\n', 'poetry.lock': '', 'manage.py': '' })
  assert.equal(d.test, 'poetry run python manage.py test')
  assert.equal(d.reviewer, 'ecc-agents:django-reviewer')
  assert.equal(d.resolver, 'ecc-agents:django-build-resolver')
  const t = one({ 'requirements.txt': 'torch\npytest\n' })
  assert.equal(t.test, 'pytest')
  assert.equal(t.reviewer, 'ecc-agents:python-reviewer')
  assert.equal(t.resolver, 'ecc-agents:pytorch-build-resolver')
})

test('go, rust, swift package and xcode project', () => {
  assert.equal(one({ 'go.mod': 'module x' }).test, 'go test ./...')
  assert.equal(one({ 'go.mod': 'module x' }).resolver, 'ecc-agents:go-build-resolver')
  const r = one({ 'Cargo.toml': '[package]' })
  assert.deepEqual([r.test, r.lint, r.typecheck, r.reviewer], ['cargo test', 'cargo clippy -- -D warnings', 'cargo check', 'ecc-agents:rust-reviewer'])
  assert.equal(one({ 'Package.swift': '' }).test, 'swift test')
  const x = one({ 'App.xcodeproj/project.pbxproj': '' })
  assert.equal(x.lang, 'Swift')
  assert.match(x.test, /xcodebuild -project App\.xcodeproj -scheme App test/)
})

test('gradle wrapper with kotlin, maven java', () => {
  const k = one({ 'gradlew': '', 'build.gradle.kts': 'plugins { kotlin("jvm") }' })
  assert.deepEqual([k.lang, k.test, k.build, k.reviewer], ['Kotlin', './gradlew test', './gradlew build', 'ecc-agents:kotlin-reviewer'])
  const j = one({ 'pom.xml': '<project/>' })
  assert.deepEqual([j.lang, j.test, j.resolver], ['Java', 'mvn test', 'ecc-agents:java-build-resolver'])
})

test('ruby, php, dotnet, cmake, flutter', () => {
  const rb = one({ 'Gemfile': "gem 'rspec'\ngem 'rubocop'\n" })
  assert.deepEqual([rb.test, rb.lint, rb.reviewer], ['bundle exec rspec', 'bundle exec rubocop', 'ecc-agents:ruby-reviewer'])
  assert.equal(one({ 'Gemfile': "gem 'rails'\n" }).test, 'bundle exec rake test')
  const php = one({ 'composer.json': JSON.stringify({ 'require-dev': { 'phpunit/phpunit': '10' } }) })
  assert.deepEqual([php.test, php.reviewer], ['vendor/bin/phpunit', 'ecc-agents:php-reviewer'])
  const cs = one({ 'App.csproj': '' })
  assert.deepEqual([cs.test, cs.reviewer, cs.resolver], ['dotnet test', 'ecc-agents:csharp-reviewer', undefined])
  assert.equal(one({ 'Lib.fsproj': '' }).reviewer, 'ecc-agents:fsharp-reviewer')
  const c = one({ 'CMakeLists.txt': '' })
  assert.deepEqual([c.lang, c.test, c.reviewer], ['C/C++', 'ctest --test-dir build', 'ecc-agents:cpp-reviewer'])
  const f = one({ 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n' })
  assert.deepEqual([f.lang, f.test, f.reviewer, f.resolver], ['Flutter', 'flutter test', 'ecc-agents:flutter-reviewer', 'ecc-agents:dart-build-resolver'])
  assert.equal(one({ 'pubspec.yaml': 'name: x\n' }).test, 'dart test')
})

test('monorepo: root and one level down, lockfile from root, deeper and node_modules skipped', () => {
  const dir = repo({
    'package.json': JSON.stringify({ scripts: { test: 'x' } }), 'pnpm-lock.yaml': '',
    'web/package.json': JSON.stringify({ scripts: { test: 'y' } }),
    'api/go.mod': 'module api',
    'a/b/Cargo.toml': '', 'node_modules/x/package.json': '{}',
    '.github/workflows/ci.yml': 'jobs:\n  t:\n    steps:\n      - run: pnpm test\n      - name: x\n        run: go vet ./...\n      - run: |\n          echo multi\n',
  })
  const r = detect(dir)
  assert.deepEqual(r.entries.map(e => [e.dir, e.lang]), [['.', 'JavaScript'], ['api', 'Go'], ['web', 'JavaScript']])
  assert.equal(r.entries[2].test, 'pnpm test')
  assert.deepEqual(r.ci, ['pnpm test', 'go vet ./...'])
  const text = render(r)
  assert.match(text, /Reviewer: ecc-agents:go-reviewer/)
  assert.match(text, /CI runs:/)
})

test('empty dir says so; cli prints text and --json', () => {
  const dir = repo({ 'Cargo.toml': '' })
  const cli = path.join(import.meta.dirname, 'toolchain.mjs')
  assert.match(execFileSync('node', [cli, dir], { encoding: 'utf8' }), /Test: cargo test/)
  assert.equal(JSON.parse(execFileSync('node', [cli, dir, '--json'], { encoding: 'utf8' })).entries[0].lang, 'Rust')
  assert.match(render(detect(repo({ 'README.md': '' }))), /No manifests found/)
})
