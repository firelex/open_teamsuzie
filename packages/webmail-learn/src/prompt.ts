import type { PageCapture } from '@teamsuzie/webmail-browser';
import { ALLOWED_KEYS_DESCRIPTION, PLACEHOLDERS, type OperationName, type Route } from '@teamsuzie/webmail-routes';

export interface RepairRequest {
    route: Route;
    operation: OperationName;
    /** What the operation is for, in plain English. */
    goal: string;
    /** What the operation must return, in plain English. */
    outputs: string;
    failure: { code: string; phase: string; stepIndex: number; message: string; evidence: string[] };
    capture: PageCapture;
    /** The webmail's own list of keyboard shortcuts for this account, or why it could not be read. */
    shortcuts: { text: string } | { unavailable: string };
}

const MAX_ARIA_CHARS = 60_000;
const MAX_UNNAMED_CHARS = 15_000;
const MAX_OUTLINE_CHARS = 40_000;
const MAX_SHORTCUT_CHARS = 6000;

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max)}\n… (cut at ${max} characters)`;
}

function referencedStates(route: Route, operation: OperationName): Record<string, unknown> {
    const text = JSON.stringify(route.operations[operation]);
    return Object.fromEntries(Object.entries(route.states).filter(([name]) => text.includes(`"${name}"`)));
}

const FAILURE_MEANINGS: Record<string, string> = {
    target_not_found: 'no visible element on the page matched the step\'s target',
    target_ambiguous: 'more than one visible element matched the step\'s target, so it was not clear which one to use',
    state_not_reached: 'after the step, the page did not reach the state the step expected',
    extract_invalid: 'a value the step had to read was missing or not in the expected form',
    recipients_mismatch: 'the recipients the page showed were not the ones requested (or could not be read)',
    verification_failed: 'a verify_text step found that the element did not contain the required text (for discard_draft: the opened draft is not one of the service\'s test drafts, or the step reads the wrong element)',
    cleanup_failed: 'the test_end steps ran but the draft or reply was still open afterwards, so they do not really discard it (check that the discard button is right, and whether the page asks to confirm the discard)',
};

/** A self-contained, plain-English request to repair one operation of a webmail route. */
export function buildRepairPrompt(req: RepairRequest): string {
    const { route, operation, failure, capture } = req;
    const where = failure.phase === 'start'
        ? 'the start of the task (before its first step the program discards any open draft, loads the inbox and waits for the "inbox_list" state)'
        : failure.stepIndex >= 0 ? `step ${failure.stepIndex} of its "${failure.phase}" list` : 'its result';
    const sections = [
        `You are helping a program use the ${route.provider === 'gmail' ? 'Gmail' : 'Outlook'} web page on behalf of its owner. The program never runs code from you. It follows a "route": a JSON list of simple steps (go to a page, click an element, type text, read values) for each task. The web page has changed, and one task no longer works. Your job is to write new steps for that task so they work on the page as it is now.`,

        `THE TASK: "${operation}"\n${req.goal}\n${req.outputs}`,

        'text' in req.shortcuts
            ? `THIS ACCOUNT'S KEYBOARD SHORTCUTS\nThe program pressed "?" on the inbox, and the webmail listed these shortcuts for this account:\n${truncate(req.shortcuts.text, MAX_SHORTCUT_CHARS)}`
            : `THIS ACCOUNT'S KEYBOARD SHORTCUTS\nThe list could not be read (${req.shortcuts.unavailable}), so use clicks unless a shortcut is proven with run_operation.`,

        `WHAT WENT WRONG\nWhen the program ran this task, ${where} failed: ${FAILURE_MEANINGS[failure.code] ?? failure.code}.\nThe exact error was: ${failure.message}`
        + (failure.evidence.length > 0 ? `\nWhat the program found on the page for this (tag, attributes, text, and the labelled regions each element sits in):\n${failure.evidence.map((e) => `- ${e}`).join('\n')}` : ''),

        `HOW STEPS ARE WRITTEN\nEach step is one JSON object with exactly one action key. Each action allows only the keys listed for it; any other key makes the whole reply unusable.\n`
        + `- goto: keys "goto", "expect". {"goto": "home"} or {"goto": "<https URL>"} loads a page. "home" is ${route.home_url}. A URL must be on one of these hosts: ${route.domains.join(', ')}.\n`
        + `- click: keys "click", "commits", "expect". {"click": <target>} clicks one element. "commits": true marks the click that actually sends.\n`
        + `- fill: keys "fill", "value", "expect". {"fill": <target>, "value": "<text>"} clears a field and types the text.\n`
        + `- type: keys "type", "value", "each_address", "then_press", "expect". Types into a field without clearing it. With "each_address": true, a comma-separated list of addresses is typed one at a time, pressing the "then_press" key after each (this is how recipient fields turn addresses into recipient chips).\n`
        + `- press: keys "press", "commits", "expect". {"press": "ControlOrMeta+N"} presses one key or shortcut. Allowed keys: ${ALLOWED_KEYS_DESCRIPTION}. A key that sends must be its own press step with "commits": true.\n`
        + `- scroll: key "scroll" only. {"scroll": "page"} or {"scroll": <target>}.\n`
        + `- wait_for: key "wait_for" only. {"wait_for": "<state name>"} waits until a named page state holds.\n`
        + `- extract: keys "extract", "as". {"extract": {"items": <target with "each": true>, "fields": {<field name>: <field>, ...}}, "as": "<name>"} reads values. With "items", one record is read from each matching element; without "items", one record is read from the page. The "extract" object allows only the keys "items" and "fields".\n`
        + `- verify_recipients: key "verify_recipients" only. {"verify_recipients": {"to": <target with "each": true>, "cc": <target with "each": true>, "bcc": <target with "each": true>, "from": "text" | "name" | "attr:<attribute>"}} reads the recipient chips the page shows (one element per address) and stops unless they are exactly the requested recipients. "cc" and "bcc" are optional.\n`
        + `Prefer the webmail's own keyboard shortcuts over clicking through menus and toolbars wherever one exists (for example a shortcut that opens a new message or a reply): shortcuts do not depend on the window size, on overflow menus or on which ribbon tab is showing. This is the web version of the webmail, whose shortcuts can differ from the desktop app's and depend on the account's settings: call read_shortcut_help to see this account's list, then test a shortcut with run_operation and always give its step an "expect" state that proves it worked; if it does not work, click instead.\n`
        + `- verify_text: key "verify_text" only. {"verify_text": {"target": <target>, "from": "text" | "name" | "attr:<attribute>", "contains": "<text>"}} stops the task unless that element's text contains the given text. discard_draft must check, right before its commit step, that the draft contains "$marker".\n`
        + `A task with a commit step must have a "test_end" list that undoes the task instead (for example, discards the draft); in test runs the program stops before the commit step and runs "test_end". "test_end" must not contain a commit step.`,

        `HOW FIELDS ARE WRITTEN (inside "extract")\nA field allows only these keys: "target", "from", "pattern", "format", "required".\n`
        + `- "from" (required): "text" (the element's visible text), "name" (its accessible name) or "attr:<attribute name>", for example "attr:title".\n`
        + `- "format" (required): one of "email" (exactly one address), "emails" (one or more addresses), "date", "nonempty", "id" (letters, digits and : . # + = / - _ only, no spaces), "text" (anything), "flag" (true when a value is found).\n`
        + `- "required" (required): true or false.\n`
        + `- "target" (optional): the element to read. Inside "items" it is searched inside the item; leave it out to read the item itself.\n`
        + `- "pattern" (optional): a regular expression with EXACTLY ONE capturing group in round brackets; the value is what that group captures. Every other bracket must be non-capturing, written (?: ... ). Correct: "^(Unread)\\\\b", "\\\\(([^)]+@[^)]+)\\\\)", "^(?:Re: )?(.+)$". Wrong: "Unread" (no group), "(a)(b)" (two groups), "(Mon|Tue) (\\\\d+)" (two groups; write "(?:Mon|Tue) (\\\\d+)"). Leave "pattern" out when the whole value is wanted.\n`
        + `Dates may be in any format the page shows (for example "Sun 25/10/2026 09:22", "09:22" or "Yesterday 18:30"); the program reads them. Do not use a pattern to reformat a date.\n`
        + `A complete, valid example of reading a list:\n`
        + `{"extract": {"items": {"role": "option", "each": true}, "fields": {"id": {"from": "attr:data-convid", "format": "id", "required": true}, "subject": {"target": {"css": "span[title]"}, "from": "attr:title", "format": "nonempty", "required": true}, "unread": {"from": "attr:aria-label", "pattern": "^(Unread)\\\\b", "format": "flag", "required": false}}}, "as": "messages"}`,

        `HOW TARGETS ARE WRITTEN\nA target allows only the keys "role", "name", "name_pattern", "css", "within", "has", "each", and needs "role" or "css".\n`
        + `- {"role": "button", "name": "Send"} matches by accessibility role and exact accessible name. Use "name_pattern": "<case-insensitive regular expression>" instead of "name" when the name varies; never give both. Anchor patterns with ^ and $ when a longer name could also match, for example "^New mail$" so that a "New mail options" button does not match too.\n`
        + `- {"css": "<selector>"} only for elements with no accessible name. "role" and "css" together must both match.\n`
        + `- "within": "<state name>" searches only inside that state's "container" element. "has": <target> keeps only elements that contain a match for the inner target; an inner target may not use "within".\n`
        + `- A target must match exactly one visible element, unless it has "each": true (used for lists). Never use ids or labels the page generates per visit, such as #116-group, #588 or [aria-labelledby="116-label"], and never use class names that look generated (random letters and digits such as .QdrUx, .r1f29ykk or .___1n1jw41): they change whenever the webmail is updated. Prefer, in this order: role and accessible name; aria-label, title, name and placeholder; data-* attributes whose names describe the element (such as data-convid). Choose what a person would recognise on screen, because that changes least.\n`
        + `- The task must work for any message, not only the one on screen now. Never put text that belongs to a particular message (its subject, sender, date or body) into a target, name, pattern or state; target the element by its role and position in the page instead (for example the heading inside the reading pane).`,

        `VALUES\nText values and names may use only these placeholders, which the program fills in: ${PLACEHOLDERS.join(', ')}.`,

        `PAGE STATES\nEvery task starts from the inbox: before its first step, the program discards any open draft, loads ${route.home_url} and waits for the "inbox_list" state, so the steps do not need to do that themselves. A state is {"url_matches": "<regular expression on the full URL>", "visible": [<targets that must each match exactly one visible element>], "container": <target>}. "container" is needed only when a target uses "within" that state. These are the states the task uses now:\n${JSON.stringify(referencedStates(route, operation), null, 1)}\nAll state names in the route: ${Object.keys(route.states).join(', ')}.`,

        `THE TASK'S CURRENT STEPS\n${JSON.stringify(route.operations[operation], null, 1)}`,

        `THE PAGE NOW\nURL: ${capture.url}\nAccessibility tree (role "name", nested by indentation):\n${truncate(capture.aria, MAX_ARIA_CHARS)}\n\nInteractive elements with no accessible name (opening tags only):\n${truncate(capture.unnamed.join('\n'), MAX_UNNAMED_CHARS)}${capture.layers.length > 0 ? `\n\nDialogs, modal layers and parts of the page marked hidden from assistive technology:\n${capture.layers.join('\n')}` : ''}\n\nPage outline (elements with their attributes and own text; ids, addresses and dates are often in attributes such as data-*, title or datetime, so look here when the accessibility tree does not show them):\n${truncate(capture.outline, MAX_OUTLINE_CHARS)}`,
    ];
    sections.push(
        `HOW TO WORK\nYou have tools that work on the live page. Nothing you do with them sends anything.\n`
        + `1. First use this account's keyboard shortcuts above: work out which allowed key opens a new message, which starts a reply, which sends and which goes to search, and use them for those steps (sending only as the step marked "commits"). Fill in everything else (fields, recipients, reading values) with targets.\n`
        + `2. Look at the page above and the failure, and form an idea of what changed.\n`
        + `3. Test before you write: use try_target to see exactly what a target matches (it lists the elements, or the nearest ones when nothing matches), check_state to test a state, and try_extract to see what fields read.\n`
        + `4. Run your complete version of the task with run_operation. If it fails, read the error and what was found on the page, fix that part, and run it again.\n`
        + `5. When run_operation succeeds, call submit_repair with exactly the same steps, test_end and states, and short notes.\n`
        + `Keep the steps that still work and change only what is needed. Each tool call costs time, so test what you are unsure about rather than everything. Always answer by calling a tool.`,
    );
    return sections.join('\n\n');
}
