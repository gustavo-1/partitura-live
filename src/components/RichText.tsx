import { Fragment } from 'react';

/** Texto com **negrito** e quebras de parágrafo (\n\n) / linha (\n). */
export function RichText({ text }: { text: string }) {
  return (
    <div className="prose">
      {text.split(/\n\n/).map((para, i) => (
        <p key={i}>
          {para.split('\n').map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {line.split(/(\*\*[^*]+\*\*)/).map((chunk, k) =>
                chunk.startsWith('**') ? <strong key={k}>{chunk.slice(2, -2)}</strong> : <Fragment key={k}>{chunk}</Fragment>,
              )}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
