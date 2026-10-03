import type { SourceLink as SourceLinkData } from '../../shared/domain.ts';

/** Link to the original document in the Drive, with its availability spelled out. */
export function SourceLink({ source, label }: { source: SourceLinkData; label?: string }) {
  const text = label ?? source.name;
  if (!source.webUrl || source.syncStatus === 'unavailable') {
    return (
      <span>
        {text} <span className="badge badge-blocked">✕ fonte indisponível</span>
      </span>
    );
  }
  return (
    <span>
      <a href={source.webUrl} target="_blank" rel="noreferrer noopener">
        {text}
        <span className="visually-hidden"> (abre o original em nova aba)</span>
      </a>
      {source.syncStatus === 'failed' && <span className="badge badge-warn"> ⚠ leitura falhou, pode estar desatualizada</span>}
    </span>
  );
}
