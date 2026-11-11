# @teamsuzie/sensitive-data

Detects personal data and privilege markers in text bound for an external model, and applies a policy at the model
request.

- `detect(text)`: email addresses, phone numbers, IBANs (mod-97 checked), payment cards (Luhn checked), US Social
  Security and UK National Insurance numbers, and privilege markers ("privileged and confidential", "without
  prejudice", "legal advice privilege", ...). Pattern-based: names and postal addresses are not detected.
- `Redactor`: numbered placeholders (`[EMAIL 1]`), the same number for the same value across a request.
- `createGuardedFetch({ mode, onReport })` wraps the fetch used for an OpenAI-compatible chat API and checks every
  message (content, text parts, tool-call arguments, tool results): `allow` reports only, `redact` replaces personal
  data (privilege markers are reported, not changed), `block` throws `SensitiveDataBlockedError`.
