import { HTMLAttributes } from 'react';
import './Card.css';

type Props = HTMLAttributes<HTMLDivElement>;

export default function Card({ className = '', ...rest }: Props) {
  return <div className={`card ${className}`} {...rest} />;
}
