import { ReactNode } from 'react';
import './Table.css';

type Props = {
  headers: ReactNode[];
  children: ReactNode;
  className?: string;
};

export default function Table({ headers, children, className = '' }: Props) {
  return (
    <div className={`table-wrap ${className}`.trim()}>
      <table className="table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
