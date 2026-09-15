import { Icon } from '../../../components/ui/Icon';

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="rating-stars" title={`${rating}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= rating ? 'on' : 'off'}>
          <Icon name="star" size={13} />
        </span>
      ))}
    </span>
  );
}
