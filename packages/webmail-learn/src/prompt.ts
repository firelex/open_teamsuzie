import type { PageCapture } from '@teamsuzie/webmail-browser';
import { PLACEHOLDERS, type OperationName, type Route } from '@teamsuzie/webmail-routes';

export interface RepairRequest {
    route: Route;
    operation: OperationName;
    /** What the operation is for, in plain English. */
    goal: string;
    /** What the operation must return, in plain English. */
    outputs: string;
    failure: { code: string; phase: string; stepIndex: number; message: string };
    capture: PageCapture;
    /** Problems with earlier replies in this attempt, oldest first. */
    previousProblems: string[];
}

const MAX_ARIA_CHARS = 60_000;
const MAX_UNNAMED_CHARS = 15_000;

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
};

/** A self-contained, plain-English request to repair one operation of a webmail route. */
export function buildRepairPrompt(req: RepairRequest): string {
    const { route, operation, failure, capture } = req;
    const where = failure.stepIndex >= 0 ? `step ${failure.stepIndex} of its "${failure.phase}" list` : 'its result';
    const sections = [
        `You are helping a program use the ${route.provider === 'gmail' ? 'Gmail' : 'Outlook'} web page on behalf of its owner. The program never runs code from you. It follows a "route": a JSON list of simple steps (go to a page, click an element, type text, read values) for each task. The web page has changed, and one task no longer works. Your job is to write new steps for that task so they work on the page as it is now.`,

        `THE TASK: "${operation}"\n${req.goal}\n${req.outputs}`,

        `WHAT WENT WRONG\nWhen the program ran this task, ${where} failed: ${FAILURE_MEANINGS[failure.code] ?? failure.code}.\nThe exact error was: ${failure.message}`,

        `HOW STEPS ARE WRITTEN\nEach step is a JSON object with exactly one of these actions:\n`
        + `- {"goto": "home"} or {"goto": "<https URL>"} — load a page. "home" is ${route.home_url}. A URL must be on one of these hosts: ${route.domains.join(', ')}.\n`
        + `- {"click": <target>} — click one element.\n`
        + `- {"fill": <target>, "value": "<text>"} — clear a field and type the text into it.\n`
        + `- {"type": <target>, "value": "<text>", "each_address": true, "then_press": "Tab"} — type into a field without clearing it. With "each_address": true, a comma-separated list of addresses is typed one at a time, pressing the "then_press" key after each (this is how recipient fields turn addresses into recipient chips).\n`
        + `- {"press": "Enter"} — press one key.\n`
        + `- {"scroll": "page"} or {"scroll": <target>}.\n`
        + `- {"wait_for": "<state name>"} — wait until a named page state holds.\n`
        + `- {"extract": {"items": <target with "each": true>, "fields": {...}}, "as": "<name>"} — read values. With "items", one record is read from each matching element; without it, one record is read from the page. Each field is {"target": <target>, "from": "text" | "name" | "attr:<attribute>", "pattern": "<regular expression with exactly one capture group>", "format": "email" | "emails" | "date" | "nonempty" | "id" | "text" | "flag", "required": true | false}. Inside "items", a field's target is searched inside the item, and a field with no target reads the item itself. "pattern" is optional.\n`
        + `- {"verify_recipients": {"to": <target with "each": true>, "cc": <target>, "bcc": <target>, "from": "text" | "name" | "attr:<attribute>"}} — read the recipient chips the page shows (one element per address) and stop unless they are exactly the requested recipients. "cc" and "bcc" are optional.\n`
        + `Most steps may also have "expect": "<state name>": after the step, that page state must hold. A click on the button that actually sends must have "commits": true. A task with a commit step must have a "test_end" list that undoes the task instead (for example, discards the draft); in test runs the program stops before the commit step and runs "test_end".`,

        `HOW TARGETS ARE WRITTEN\nA target picks one element: {"role": "button", "name": "Send"} matches by accessibility role and exact accessible name; use "name_pattern": "<case-insensitive regular expression>" instead of "name" for names that vary. Use {"css": "<selector>"} only for elements that have no accessible name; "role" and "css" together must both match. {"within": "<state name>"} searches only inside that state's "container" element. {"has": <target>} keeps only elements that contain a match for the inner target (an inner target may not use "within"). A target must match exactly one visible element, unless it has "each": true (used for lists). Never use ids or labels the page generates per visit, such as #116-group, #588 or [aria-labelledby="116-label"]; prefer roles, accessible names, aria-label, title, name and data-* attributes that describe the element.`,

        `VALUES\nText values and names may use only these placeholders, which the program fills in: ${PLACEHOLDERS.join(', ')}.`,

        `PAGE STATES\nA state is {"url_matches": "<regular expression on the full URL>", "visible": [<targets that must each match exactly one visible element>], "container": <target>}. "container" is needed only when a target uses "within" that state. These are the states the task uses now:\n${JSON.stringify(referencedStates(route, operation), null, 1)}\nAll state names in the route: ${Object.keys(route.states).join(', ')}.`,

        `THE TASK'S CURRENT STEPS\n${JSON.stringify(route.operations[operation], null, 1)}`,

        `THE PAGE NOW\nURL: ${capture.url}\nAccessibility tree (role "name", nested by indentation):\n${truncate(capture.aria, MAX_ARIA_CHARS)}\n\nInteractive elements with no accessible name (opening tags only):\n${truncate(capture.unnamed.join('\n'), MAX_UNNAMED_CHARS)}`,
    ];
    if (req.previousProblems.length > 0) {
        sections.push(`YOUR EARLIER REPLIES DID NOT WORK\n${req.previousProblems.map((p, i) => `${i + 1}. ${p}`).join('\n')}\nDo not repeat these mistakes.`);
    }
    sections.push(
        `YOUR REPLY\nReply with one JSON object and nothing else:\n`
        + `{"steps": [ ...every step of the task, from the start... ], "test_end": [ ...only if the task has a commit step... ], "states": { "<state name>": <state>, ... only states you add or change ... }, "notes": "<one or two sentences: what changed on the page and what you changed>"}\n`
        + `Keep the steps that still work. Change only what is needed. Do not include anything that is not in the formats above.`,
    );
    return sections.join('\n\n');
}
