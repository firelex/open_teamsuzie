# @teamsuzie/i18n

Translation setup shared by Team Suzie apps: i18next with no fallback language, a React provider
and hooks, Intl formatters, and a server-side translator.

## No fallback language

This package never falls back to another language. Every `createI18n` instance is initialised with
`fallbackLng: false`. When code asks for a key that the active locale's resources do not have, the
translator logs `missing translation: <lng>/<ns>.<key>` via `console.error` and shows the key itself
(the server translator shows the full `"<ns>.<path>"` key it was asked for). A missing translation is
a bug to fix in the resource files, not something to paper over with another language's text.

## `SUPPORTED_LOCALES`, `Locale`, `isLocale`

`SUPPORTED_LOCALES` is the fixed tuple `['en', 'de', 'fr']`. `Locale` is the union type of its
members. `isLocale(value)` is a type guard that accepts only one of those three strings.

## `detectLocale(input)`

Picks the first supported locale out of an `Accept-Language` header string or a
`navigator.languages` array, matched on the primary subtag (`de-CH` → `de`) and ranked by `q`-value
where present. Returns `null`, never a guessed default, when nothing in the input is supported — the
caller decides what to do about that (for example, render a locale picker or require a choice).

## `Resources`

`Record<Locale, Record<string, Record<string, unknown>>>`: for each supported locale, a map of
namespace name to that namespace's (possibly nested) translation keys.

## `createI18n(opts)`

Creates and synchronously initialises a dedicated i18next instance (`i18next.createInstance()`,
not the global singleton) from `{ resources, lng, defaultNS? }`. Namespaces are taken from the
`en` resources. Interpolation does not HTML-escape values, since this package is not tied to a
particular rendering target. See "No fallback language" above for what happens on a missing key.

## `formatDate`, `formatDateTime`, `formatNumber`, `formatMoney`

Thin wrappers over `Intl.DateTimeFormat` and `Intl.NumberFormat`, one BCP-47 tag per supported
locale (`en` → `en-US`, `de` → `de-DE`, `fr` → `fr-FR`). `formatDate` renders in UTC so a calendar
date stored as midnight UTC never shifts a day because of the viewer's time zone. `formatMoney`
takes an amount in integer cents (so a price can be stored without floating-point rounding) plus an
ISO 4217 currency code, and renders it with `Intl.NumberFormat`'s `currency` style.

## React: `I18nProvider`, `useT`, `useLocale`, `useSetLocale`, `Trans`, `I18nContext`

`I18nProvider({ i18n, children })` makes one `createI18n` instance available to the component tree
below it (wrapping `react-i18next`'s own `I18nextProvider`). `useT(ns)` returns `{ t, i18n }` scoped
to that instance and namespace; it throws `outside <I18nProvider>` if called without a provider
above it in the tree, rather than silently using some other i18next instance. `useLocale()` returns
the active `Locale`, throwing if the instance's current language is somehow not one of the three
supported codes. `useSetLocale()` returns an async function that changes the instance's language and
also sets `document.documentElement.lang`, so the two never drift apart. `Trans` is re-exported from
`react-i18next` unchanged, for translations that need to interpolate JSX. `I18nContext` is exported
for apps that need direct access to the underlying React context.

## Server: `createServerI18n(resources)` (import from `@teamsuzie/i18n/server`)

Builds one `createI18n` instance per supported locale (so concurrent requests for different locales
never share mutable state) and returns `{ t(locale, key, vars?) }`. `key` is always
`"<namespace>.<path>"` — for example `"errors.forbidden"` — and the function throws
(`"... has no namespace ..."`) if the key has no namespace. On a missing key it still logs
`missing translation: <lng>/<ns>.<key>` (see "No fallback language") and returns the full `key` it
was given, not i18next's own bare-key fallback.
