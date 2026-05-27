import type { ManifestTheme } from '../manifest/schema.js';
import type { BrandLogo } from '../manifest/v2/schema.js';

interface Props {
  title: string;
  theme?: ManifestTheme;
  logo?: BrandLogo;
}

export function Wordmark({ title, theme, logo }: Props) {
  // Asset logo — render the uploaded image, served at /assets/<assetId>.
  if (logo?.type === 'asset') {
    return (
      <img
        src={`/assets/${logo.assetId}`}
        alt={title}
        className="h-7 max-w-[160px] object-contain"
      />
    );
  }
  // Text logo with explicit wordmark — overrides the title prop.
  const displayText = logo?.type === 'text' ? logo.wordmark : title;
  const style = theme?.tokens?.wordmarkStyle ?? 'single';
  const upper = displayText.toUpperCase();
  // .ts-text-fancy renders the wordmark in the active design's brand gradient.
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
