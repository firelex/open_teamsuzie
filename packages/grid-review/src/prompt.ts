import {
    citationProtocolFragment,
    type PreparedDocument,
} from '@teamsuzie/citations';

import type { CellFormat } from './types.js';

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
    /** Desired answer shape. When omitted, answers stay free-form text. */
    format?: CellFormat;
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
    format = 'text',
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
        'Ground every answer in the document. Use short quoted snippets only when exact wording is important; otherwise summarize the relevant obligation or fact concisely.',
        "If the answer is not in the document, say so plainly. Do not speculate.",
        formatInstruction(format),
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

function formatInstruction(format: CellFormat): string {
    switch (format) {
        case 'text':
            return 'Answer format: concise prose, usually one to three sentences. Include citation markers for support.';
        case 'short_text':
            return 'Answer format: a single short phrase under 20 words. Include a citation marker if available.';
        case 'date':
            return 'Answer format: one date in YYYY-MM-DD form when the document provides it. If no date is found, say "None found."';
        case 'yes_no':
            return 'Answer format: start with exactly "Yes" or "No", then add a brief cited reason if needed.';
        case 'bullets':
            return [
                'Answer format: a markdown bullet list.',
                'Each bullet must begin with "- " and should be a concise analytical summary, not a pasted full clause.',
                'If the prompt asks for categories, classifications, or multiple provisions, make one bullet per distinct item.',
                'If the prompt asks for a single most significant item, return exactly one bullet.',
                'Include citation markers on bullets when support exists.',
                'If no responsive provision is found, return "- None found."',
            ].join(' ');
        case 'money':
            return 'Answer format: one currency amount, e.g. "$1,500" or "USD 1,500". If no amount is found, say "None found."';
    }
}
