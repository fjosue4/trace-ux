import { NavLink } from 'react-router-dom';
import { CurrentUser } from '../../api';
import { useTheme } from '../../hooks/useTheme';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { Icon } from '../ui/Icon';
import './Sidebar.css';

type Props = {
  user: CurrentUser;
  onLogout: () => void;
};

const navLink = ({ isActive }: { isActive: boolean }) =>
  `sidebar__link${isActive ? ' is-active' : ''}`;

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      className="sidebar__theme"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <Icon name={dark ? 'sun' : 'moon'} size={14} />
      <span>{dark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}

export default function Sidebar({ user, onLogout }: Props) {
  return (
    <aside className="sidebar">
      <NavLink to="/" className="sidebar__brand">
        <span className="sidebar__dot" aria-hidden /> Webshots
      </NavLink>

      <nav className="sidebar__nav">
        <NavLink to="/" end className={navLink}>
          <Icon name="globe" size={15} />
          Sites
        </NavLink>
        <NavLink to="/sessions" className={navLink}>
          <Icon name="film" size={15} />
          Sessions
        </NavLink>
        <NavLink to="/feedback" className={navLink}>
          <Icon name="message" size={15} />
          Feedback
        </NavLink>
        <NavLink to="/settings" className={navLink}>
          <Icon name="settings" size={15} />
          Settings
        </NavLink>
      </nav>

      <div className="sidebar__footer">
        <ThemeToggle />
        <div className="sidebar__user">
          <span className="mono">{user.username}</span>
          <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role}</Badge>
        </div>
        <Button variant="secondary" size="sm" block onClick={onLogout}>
          Log out
        </Button>
      </div>
    </aside>
  );
}
