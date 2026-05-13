import { useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Library, Headphones, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import MobileMiniPlayer from './MobileMiniPlayer';
import MobilePlayer from './MobilePlayer';

const MobilePrivateShell = () => {
  const { user, loading } = useAuth();
  const { currentBook } = usePlayer();
  const location = useLocation();
  const navigate = useNavigate();
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  const tabs = [
    { path: '/', icon: Library, label: 'Library', exact: true },
    { path: '__player__', icon: Headphones, label: 'Player', exact: false },
    { path: '/menu', icon: User, label: 'Menu', exact: false },
  ];

  const isTabActive = (path: string, exact: boolean) => {
    if (path === '__player__') return isPlayerOpen;
    if (exact) return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleTabPress = (path: string) => {
    if (path === '__player__') {
      setIsPlayerOpen(true);
    } else {
      setIsPlayerOpen(false);
      navigate(path);
    }
  };

  return (
    <div className="mobile-layout">
      {isPlayerOpen && <MobilePlayer onClose={() => setIsPlayerOpen(false)} />}

      <main className="mobile-main">
        <Outlet />
      </main>

      {currentBook && !isPlayerOpen && (
        <MobileMiniPlayer onExpand={() => setIsPlayerOpen(true)} />
      )}

      <nav className="mobile-bottom-nav">
        {tabs.map(tab => (
          <button
            key={tab.path}
            className={`mobile-nav-tab${isTabActive(tab.path, tab.exact) ? ' active' : ''}`}
            onClick={() => handleTabPress(tab.path)}
          >
            <tab.icon size={22} />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default MobilePrivateShell;
