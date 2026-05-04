import type { Root } from 'mdast';
import { findAndReplace } from 'mdast-util-find-and-replace';

export const CITE_URL_SCHEME = 'cite:';

export function remarkCitations() {
    return (tree: Root): void => {
        findAndReplace(
            tree,
            [
                [
                    /\[(\d+)\]/g,
                    (_match: string, idStr: string) => {
                        const id = Number(idStr);
                        if (!Number.isInteger(id) || id <= 0) return false;
                        return {
                            type: 'link',
                            url: `${CITE_URL_SCHEME}${id}`,
                            title: null,
                            children: [{ type: 'text', value: `[${id}]` }],
                        };
                    },
                ],
            ],
            { ignore: ['code', 'inlineCode'] },
        );
    };
}

export function parseCiteUrl(url: string | null | undefined): number | null {
    if (typeof url !== 'string') return null;
    if (!url.startsWith(CITE_URL_SCHEME)) return null;
    const rest = url.slice(CITE_URL_SCHEME.length);
    const id = Number(rest);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
}
