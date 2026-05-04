import {
    citationProtocolFragment,
    type PreparedDocument,
} from '@teamsuzie/citations';

export interface CellChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface BuildCellMessagesInput {
    document: PreparedDocument;
    /** Optional human-readable label (filename) shown next to the doc handle in the protocol fragment. */
    documentLabel?: string;
    /** The column's prompt — the question the model is being asked. */
    prompt: string;
}

/**
 * Assemble the chat messages for a single cell run. System message teaches
 * the citation protocol and the verbatim-quoting rule; user message hands
 * the marked document text and the column's prompt.
 */
export function buildCellMessages({
    document,
    documentLabel,
    prompt,
}: BuildCellMessagesInput): CellChatMessage[] {
    const protocol = citationProtocolFragment({
        docs: [
            {
                handle: document.handle,
                label: documentLabel ?? document.handle,
            },
        ],
    });
    const system = [
        'You answer concise questions using only the supplied document.',
        'Quote verbatim from the document — never paraphrase the source text.',
        "If the answer is not in the document, say so plainly. Do not speculate.",
        '',
        protocol,
    ].join('\n');
    const user = [
        '[Document]',
        document.marked,
        '',
        '[Question]',
        prompt,
    ].join('\n');
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}
