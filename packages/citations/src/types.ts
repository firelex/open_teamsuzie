export type DocHandle = string;

export type Citation = {
    id: number;
    doc: DocHandle;
    quote: string;
    /**
     * Optional human-readable pointer to where the quote came from.
     * Free-form: "§2.1 Termination" for sectioned docs, "p.4" for
     * paginated PDFs, "Article III" for legal text, etc. Used in the
     * citation chip's tooltip; never load-bearing.
     */
    locator?: string;
    /**
     * Set by `verifyCitations` after the response is complete:
     * `verified` when the quote was found in the cited document's text,
     * `not_found` when it was not, `unchecked` when the document's text
     * was not available to check against.
     */
    verification?: CitationVerification;
};

export type CitationVerification = 'verified' | 'not_found' | 'unchecked';

export type CitationWarningKind =
    | 'duplicate_block'
    | 'malformed_block_json'
    | 'malformed_block_shape'
    | 'malformed_entry'
    | 'duplicate_id'
    | 'orphan_marker'
    | 'unreferenced_entry'
    | 'unknown_doc_handle';

export type CitationWarning = {
    kind: CitationWarningKind;
    detail: string;
    entryIndex?: number;
    id?: number;
    doc?: DocHandle;
};

export type ParseResult = {
    text: string;
    citations: Citation[];
    warnings: CitationWarning[];
};

export type ParseOptions = {
    knownDocs?: Iterable<DocHandle>;
};
