import classNames from 'classnames';
import { motion } from 'motion/react';
import { fadeUp } from '../../../lib/motion';
import { TableProps } from './Table.types';
import './Table.scss';

export default function Table({ headers, widths, fixed, children, className = '' }: TableProps) {
  return (
    <motion.div className={classNames('table-wrap', className)} variants={fadeUp} initial="hidden" animate="visible">
      <table className={classNames('table', { 'table--fixed': fixed })}>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index} style={widths?.[index] ? { width: widths[index] } : undefined}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </motion.div>
  );
}
