import type { ManifestTheme } from '../manifest/schema.js';

interface Props { title: string; theme: ManifestTheme }

export function Wordmark({ title, theme }: Props) {
  const style = theme.tokens?.wordmarkStyle ?? 'single';
  const upper = title.toUpperCase();
  if (style !== 'two-line') {
    return (
      <div className="font-display text-[1.05rem] font-bold tracking-[-0.02em]">
        {upper}
      </div>
    );
  }
  const parts = upper.split(' ');
  const head = parts.slice(0, -1).join(' ') || parts[0];
  const tail = parts.length > 1 ? parts.at(-1) : '';
  return (
    <div className="flex flex-col leading-none">
      <span className="font-display text-[1.05rem] font-bold tracking-[-0.02em]">{head}</span>
      {tail && (
        <>
          <span className="my-1.5 inline-block h-px w-7 bg-current opacity-60" aria-hidden />
          <span className="font-display text-[1.05rem] font-bold tracking-[-0.02em]">{tail}</span>
        </>
      )}
    </div>
  );
}
