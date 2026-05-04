import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { XmlTree } from './types.js';

/**
 * Parse an OOXML part (UTF-8 string) into a preserveOrder tree. Attributes
 * are kept under `:@`, text leaves under `#text`, child order is preserved,
 * and the XML declaration round-trips via `?xml`. We intentionally don't
 * resolve namespace prefixes — Word's prefix conventions (`w:`, `r:`, etc.)
 * are part of the on-disk format.
 */
export function parseXml(xml: string): XmlTree {
    const parser = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        // Don't trim text nodes — Word preserves trailing/leading whitespace
        // inside `<w:t>` runs and stripping it changes how the doc renders.
        trimValues: false,
        // Keep the `<?xml ... ?>` declaration as a node so the round-trip
        // serializer can re-emit it.
        processEntities: true,
        parseAttributeValue: false,
        parseTagValue: false,
        // `xml:space="preserve"` is implicit in OOXML for many run children;
        // even without the attribute, treat all text as significant.
    });
    return parser.parse(xml) as XmlTree;
}

/**
 * Serialize a preserveOrder tree back to an OOXML string. The output is
 * not guaranteed to be byte-identical to the input — fast-xml-parser
 * normalizes some whitespace and attribute formatting — but it's
 * structurally equivalent: re-parsing it yields the same tree, and Word
 * renders the document identically.
 */
export function serializeXml(tree: XmlTree): string {
    const builder = new XMLBuilder({
        preserveOrder: true,
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        // Quote attribute values; suppress empty-element shorthand only when
        // the element semantically needs an open+close pair (most OOXML
        // elements are fine either way).
        suppressEmptyNode: false,
        suppressBooleanAttributes: false,
        format: false,
    });
    return builder.build(tree);
}
