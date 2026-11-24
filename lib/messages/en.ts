/**
 * Texts the application shows, in English, in one place. Pure.
 *
 * New code takes its texts from here instead of writing them inside a page
 * or a server function, so that a second language (Lithuanian, module F3)
 * is a second file with the same keys and not a search through the code.
 * Older modules are moved here step by step.
 *
 * A text may contain placeholders in braces, for example {max}.
 */
export const en = {
  "error.notSignedIn": "You are not signed in.",
  "error.noPermission": "You do not have permission to do this.",
  "error.otherSite": "Request blocked: it did not come from this site.",
  "error.unexpected": "Something went wrong. Please try again.",
  "error.invalidRequest": "Invalid request.",
  "error.notFound": "{what} not found.",
  "error.noRoom": "You have no room in a dormitory at the moment, so {what}. Contact an administrator.",
  "limit.reached": "You can {what} at most {max} times in one {period}. Please try again later.",
  "events.title": "Security events",
  "events.subtitle": "What happened in the system that matters for security. Entries cannot be changed or removed.",
  "events.empty": "No events match this filter.",
  "events.more": "Show older events",
  "events.own.title": "Access to your data",
  "events.own.empty": "Nobody has used special access to look at your data.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

/** The text for a key, with its placeholders filled in. A placeholder without a value is left as it is. */
export function message(key: MessageKey, values: Record<string, string | number> = {}, messages: Messages = en): string {
  return messages[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
