// patterns:begin (kept identical in usage-meter/hooks/redact.ts and improve-system/scripts/scan.mjs; a usage-meter test fails on drift)
// Env style names (OPENAI_API_KEY) and the snake names that hold keys (api_key); sort_key or next_token hold none.
const NAMED = String.raw`\b(?:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|(?:api|access|secret|private|auth|client|refresh|session)_(?:key|token|secret))\b`
// A SECRET or PASSWORD name holds a secret whatever its value looks like.
const NAMED_ANY = String.raw`\b[A-Z0-9_]*(?:PASSWORD|SECRET)\b`
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  // Authorization header value, after an optional scheme word.
  /(?<=\bAuthorization["']?\s*[:=]\s*["']?(?:(?:Basic|Bearer|Token|Digest)\s+)?)(?!(?:Basic|Bearer|Token|Digest)\s)[^\s"',;}]+/gi,
  // Basic auth needs a digit or symbol; 'Basic authentication' is prose.
  /(?<=\bBasic\s+)(?=[A-Za-z]*[0-9+/=])[A-Za-z0-9+/]{8,}={0,2}/g,
  // AWS secret keys: after their name, or next to an access key id (so before the AKIA rule).
  /(?<=aws_secret_access_key\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi,
  /(?<=AKIA[0-9A-Z]{16}[\s,:;="'|]+)[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{6,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // Passwords (DB_PASSWORD, PGPASSWORD, passwd, pwd): a quoted value whole, any bare value right after '=',
  // and after ':' or a spaced '=' only a token with a digit or symbol, so 'password: done' stays prose.
  /(?<=(?:password|passwd|pwd)["']?\s*[:=]\s*")[^"\n]+(?=")/gi,
  /(?<=(?:password|passwd|pwd)["']?\s*[:=]\s*')[^'\n]+(?=')/gi,
  /(?<=(?:password|passwd|pwd)=)[^\s"']+/gi,
  /(?<=(?:password|passwd|pwd)["']?\s*[:=]\s*)(?=[^\s"',]*[0-9!@#$%^&*_.+\/~-])[^\s"',]+/gi,
  // A bearer token has a digit or symbol; 'Bearer authentication' is prose.
  /(?<=\bBearer\s+)(?=[A-Za-z]*[0-9_.~+/=-])[A-Za-z0-9_.~+/=-]{16,}(?![A-Za-z0-9_.~+/=-])/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  // --password x, --pass=x.
  /(?<=--pass(?:word)?[= ]["']?)[^\s"']+/gi,
  // A named value after = or :, quoted always, bare when it looks like a secret (a digit or symbol, or 12+ characters).
  new RegExp(`(?<=${NAMED}["']?\\s*[:=]\\s*")[^"\\n]+(?=")`, 'g'),
  new RegExp(`(?<=${NAMED}["']?\\s*[:=]\\s*')[^'\\n]+(?=')`, 'g'),
  new RegExp(`(?<=${NAMED_ANY}["']?\\s*[:=]\\s*)[^\\s"',;]+`, 'g'),
  new RegExp(`(?<=${NAMED}["']?\\s*[:=]\\s*)(?=[^\\s"',;}]*[0-9!@#$%^&*_.+/~-]|[^\\s"',;}]{12})[^\\s"',;}]+`, 'g'),
  // mysql -pSECRET.
  /(?<=\bmysql(?:dump)?\b[^\n]*\s-p)[^\s"']+/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  // The password in scheme://user:password@host, greedy to the last @ so a password holding @ goes too.
  /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s/]+(?=@)/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]+/g,
]
// patterns:end
// Catch-all for hashes and long hex ids, after the shaped rules.
const HEX = /\b[0-9a-fA-F]{32,}\b/g
export const redact = (text: string) => [...PATTERNS, HEX].reduce((s, re) => s.replace(re, '[removed]'), text)
