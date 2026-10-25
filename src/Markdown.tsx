import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AnswerDTO } from '../shared/types';

function citationMarkdown(answer: AnswerDTO): string {
  const byId = new Map(answer.citations.map(citation => [citation.sourceId, citation]));
  return answer.markdown.replace(/\[(S\d+)\]/g, (_match, id: string) => {
    const citation = byId.get(id);
    return citation ? `[${citation.index}](cite:${citation.sourceId})` : '';
  });
}

export function AnswerMarkdown({ answer, onCite }: { answer: AnswerDTO; onCite: (sourceId: string) => void }) {
  return (
    <div className="answer-content markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            if (href?.startsWith('cite:')) {
              const sourceId = href.slice('cite:'.length);
              return (
                <button className="citation" onClick={() => onCite(sourceId)} title={`Open source ${sourceId}`}>
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {citationMarkdown(answer)}
      </ReactMarkdown>
    </div>
  );
}

export function PlainMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="answer-content markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
