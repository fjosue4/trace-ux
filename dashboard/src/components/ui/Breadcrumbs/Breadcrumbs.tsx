import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { BreadcrumbsProps } from './Breadcrumbs.types';
import './Breadcrumbs.scss';

/** The trail above a subpage's title. The last crumb is the current page;
 *  the ones before it link back up. */
export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <Fragment key={`${index}-${item.label}`}>
          {index > 0 && <span className="breadcrumbs__sep" aria-hidden="true">/</span>}
          {item.to && index < items.length - 1 ? (
            <Link to={item.to} className="breadcrumbs__link">{item.label}</Link>
          ) : (
            <span className="breadcrumbs__current" aria-current="page">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
