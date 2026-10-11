import classNames from 'classnames';
import { ButtonProps } from './Button.types';
import './Button.scss';

export default function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = classNames('btn', `btn--${variant}`, `btn--${size}`, { 'btn--block': block }, className);
  return (
    <button
      type={type}
      className={cls}
      {...rest}
    />
  );
}
