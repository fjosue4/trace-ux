import { ReactNode } from 'react';
import './Table.css';

type Props = {
  headers: ReactNode[];
  /** Optional per-column widths (any CSS width); pairs with fixed layout. */
  widths?: string[];
  /** Fixed layout: columns obey widths and cells ellipsize instead of stretching the table. */
  fixed?: boolean;
  children: ReactNode;
  className?: string;
};

export default function Table({ headers, widths, fixed, children, className = '' }: Props) {
  return (
    <div className={`table-wrap ${className}`.trim()}>
      <table className={`table${fixed ? ' table--fixed' : ''}`}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={widths?.[i] ? { width: widths[i] } : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
