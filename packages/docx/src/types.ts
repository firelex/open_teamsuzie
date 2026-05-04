/**
 * XML representation produced by `fast-xml-parser` in `preserveOrder` mode.
 *
 * The parser returns each element as a single-key object whose value is an
 * ordered array of child nodes; element attributes (when `ignoreAttributes`
 * is false) are stored under the special key `:@`; text leaves use the
 * special key `#text`. Mixed content and child ordering survive, which is
 * what we need for lossless round-trip — Word doesn't care about most
 * whitespace, but it cares about element order.
 *
 * Keeping the type permissive (`unknown` for the children union) lets
 * callers walk the tree pragmatically without forcing a typed AST upstream
 * of where the actual mutations happen. R2 will layer typed accessors for
 * `<w:p>`, `<w:r>` etc. on top of this representation.
 */
export type XmlTree = XmlNode[];

export interface XmlNode {
    /**
     * Exactly one tag-name key (e.g. `'w:p'`) whose value is the child
     * array, OR a `'#text'` key whose value is the leaf string.
     */
    [tagOrText: string]: XmlNode[] | string | XmlAttributes | undefined;
    /** Element attributes when present. */
    ':@'?: XmlAttributes;
}

export interface XmlAttributes {
    [attrName: `@_${string}`]: string;
}
