import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Library, Headphones, Menu } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import MobileMiniPlayer from './MobileMiniPlayer';
import MobilePlayer from './MobilePlayer';

const MobilePrivateShell = () => {
  const { currentBook } = usePlayer();
  const location = useLocation();
  const navigate = useNavigate();
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);

  const tabs = [
    { path: '/',          icon: Home,       label: 'Home'    },
    { path: '/library',   icon: Library,    label: 'Library' },
    { path: '__player__', icon: Headphones, label: 'Player'  },
    { path: '/menu',      icon: Menu,       label: 'Menu'    },
  ];

  const isTabActive = (path: string) => {
    if (path === '__player__') return isPlayerOpen;
    if (path === '/') return location.pathname === '/';
    if (path === '/library') {
      return ['/library', '/series', '/authors'].includes(location.pathname) || location.pathname.startsWith('/book/');
    }
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

      <main className={`mobile-main${currentBook ? '' : ' no-player'}`}>
        <Outlet />
      </main>

      {currentBook && !isPlayerOpen && (
        <MobileMiniPlayer onExpand={() => setIsPlayerOpen(true)} />
      )}

      <nav className="mobile-bottom-nav">
        {tabs.map(tab => (
          <button
            key={tab.path}
            className={`mobile-nav-tab${isTabActive(tab.path) ? ' active' : ''}`}
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