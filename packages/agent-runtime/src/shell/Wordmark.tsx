import type { ManifestTheme } from '../manifest/schema.js';

interface Props { title: string; theme: ManifestTheme }

export function Wordmark({ title, theme }: Props) {
  const style = theme.tokens?.wordmarkStyle ?? 'single';
  const upper = title.toUpperCase();
  // .ts-text-fancy renders the wordmark in the active design's brand
  // gradient (primary → accent). For designs with a real two-stop gradient
  // (TeamSuzie's violet → pink) this is the signature brand surface;
  // single-color designs land on a clean primary-on-bg block (saffron for
  // Counsel, phosphor-green for Console). Drives the visual identity
  // without per-design wordmark customization.
  const wordmarkClass = 'ts-text-fancy font-display text-[1.05rem] font-bold tracking-[-0.02em]';
  if (style !== 'two-line') {
    return <div className={wordmarkClass}>{upper}</div>;
  }
  const parts = upper.split(' ');
  const head = parts.slice(0, -1).join(' ') || parts[0];
  const tail = parts.length > 1 ? parts.at(-1) : '';
  return (
    <div className="flex flex-col leading-none">
      <span className={wordmarkClass}>{head}</span>
      {tail && (
        <>
          <span className="my-1.5 inline-block h-px w-7 bg-current opacity-60" aria-hidden />
          <span className={wordmarkClass}>{tail}</span>
        </>
      )}
    </div>
  );
}
