import type { Locator, Page } from 'playwright-core';

/**
 * How input reaches the page. Every click and keystroke goes through real (trusted) mouse and keyboard events,
 * paced like a person; nothing sets values or calls `.click()` from page JavaScript.
 */
export interface Behaviour {
    click(page: Page, el: Locator): Promise<void>;
    typeText(page: Page, el: Locator, text: string): Promise<void>;
    clearAndType(page: Page, el: Locator, text: string): Promise<void>;
    press(page: Page, key: string): Promise<void>;
    /** Focus a text field and put the caret at its very start. */
    caretToStart(page: Page, el: Locator): Promise<void>;
    scroll(page: Page, el: Locator | null): Promise<void>;
    betweenSteps(): Promise<void>;
    /** A pause for reading a message of `chars` characters. */
    reading(chars: number): Promise<void>;
}

export interface HumanBehaviourOptions {
    /** Uniform random numbers in [0, 1). */
    rng: () => number;
    /** Multiplies every delay. 1 for real use, 0 in tests. */
    timeScale: number;
    /** `Meta` on macOS, `Control` elsewhere: the modifier for select-all. */
    selectAllModifier: 'Meta' | 'Control';
}

interface Point { x: number; y: number }

/** About one letter in fifty starts with a slip onto a neighbouring key, corrected straight away. */
const TYPO_RATE = 0.02;
/** Letters next to each letter on a QWERTY keyboard. */
const NEIGHBOURS: Record<string, string> = {
    q: 'wa', w: 'qes', e: 'wrd', r: 'etf', t: 'ryg', y: 'tuh', u: 'yij', i: 'uok', o: 'ipl', p: 'ol',
    a: 'qsz', s: 'adw', d: 'sfe', f: 'dgr', g: 'fht', h: 'gjy', j: 'hku', k: 'jli', l: 'ko',
    z: 'asx', x: 'zcs', c: 'xvd', v: 'cbf', b: 'vng', n: 'bmh', m: 'nj',
};

export class HumanBehaviour implements Behaviour {
    private readonly lastMouse = new WeakMap<Page, Point>();

    constructor(private readonly opts: HumanBehaviourOptions) {}

    async click(page: Page, el: Locator): Promise<void> {
        await el.scrollIntoViewIfNeeded();
        const box = await el.boundingBox();
        if (!box) throw new Error('Cannot click an element with no position on the page');
        const target = {
            x: box.x + box.width * (0.2 + 0.6 * this.opts.rng()),
            y: box.y + box.height * (0.2 + 0.6 * this.opts.rng()),
        };
        await this.moveMouse(page, target);
        await this.sleep(this.between(60, 180));
        await page.mouse.down();
        await this.sleep(this.between(40, 120));
        await page.mouse.up();
    }

    async typeText(page: Page, el: Locator, text: string): Promise<void> {
        if (!(await isFocused(el))) await this.click(page, el);
        // A fast typist: irregular gaps between keys, the odd pause, and now and then a wrong neighbouring letter
        // that is corrected at once. The text that ends up in the field is always exactly `text`.
        for (const ch of text) {
            const neighbour = NEIGHBOURS[ch.toLowerCase()];
            if (neighbour && this.opts.rng() < TYPO_RATE) {
                await page.keyboard.type(neighbour[Math.floor(this.opts.rng() * neighbour.length)]!);
                await this.sleep(this.between(120, 320));
                await page.keyboard.press('Backspace');
                await this.sleep(this.between(60, 160));
            }
            if (ch === '\n') await page.keyboard.press('Enter');
            else await page.keyboard.type(ch);
            await this.sleep(this.between(30, 110));
            if (this.opts.rng() < 0.03) await this.sleep(this.between(200, 600));
        }
    }

    async clearAndType(page: Page, el: Locator, text: string): Promise<void> {
        await this.click(page, el);
        await page.keyboard.press(`${this.opts.selectAllModifier}+A`);
        await this.sleep(this.between(50, 150));
        await page.keyboard.press('Backspace');
        await this.sleep(this.between(80, 200));
        await this.typeText(page, el, text);
    }

    async caretToStart(page: Page, el: Locator): Promise<void> {
        if (!(await isFocused(el))) await this.click(page, el);
        // Cmd+Up on macOS, Ctrl+Home elsewhere: the start of the whole field, not just the current line.
        await this.press(page, this.opts.selectAllModifier === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
    }

    async press(page: Page, key: string): Promise<void> {
        await this.sleep(this.between(80, 250));
        await page.keyboard.press(key);
    }

    async scroll(page: Page, el: Locator | null): Promise<void> {
        if (el) {
            await el.scrollIntoViewIfNeeded();
            return;
        }
        const steps = 2 + Math.floor(this.opts.rng() * 4);
        for (let i = 0; i < steps; i++) {
            await page.mouse.wheel(0, this.between(120, 420));
            await this.sleep(this.between(150, 450));
        }
    }

    betweenSteps(): Promise<void> {
        return this.sleep(this.between(400, 1400));
    }

    reading(chars: number): Promise<void> {
        return this.sleep(Math.min(8000, 800 + chars * 8) * (0.8 + 0.4 * this.opts.rng()));
    }

    private async moveMouse(page: Page, to: Point): Promise<void> {
        const viewport = page.viewportSize();
        const from = this.lastMouse.get(page)
            ?? { x: (viewport?.width ?? 1440) * this.opts.rng(), y: (viewport?.height ?? 900) * this.opts.rng() };
        // A quadratic Bézier curve through a control point to one side of the straight line.
        const control = {
            x: (from.x + to.x) / 2 + (this.opts.rng() - 0.5) * Math.abs(to.y - from.y),
            y: (from.y + to.y) / 2 + (this.opts.rng() - 0.5) * Math.abs(to.x - from.x),
        };
        const points = 12 + Math.floor(this.opts.rng() * 14);
        for (let i = 1; i <= points; i++) {
            const t = i / points;
            const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x;
            const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y;
            await page.mouse.move(x, y);
            await this.sleep(this.between(4, 16));
        }
        this.lastMouse.set(page, to);
    }

    private between(min: number, max: number): number {
        return min + (max - min) * this.opts.rng();
    }

    private sleep(ms: number): Promise<void> {
        const scaled = ms * this.opts.timeScale;
        if (scaled <= 0) return Promise.resolve();
        return new Promise((resolve) => setTimeout(resolve, scaled));
    }
}

async function isFocused(el: Locator): Promise<boolean> {
    return el.evaluate((node) => node === document.activeElement || node.contains(document.activeElement));
}
