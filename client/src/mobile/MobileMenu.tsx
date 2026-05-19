import { useNavigate } from 'react-router-dom';
import { FolderOpen, LogOut, RefreshCw, Settings, Smartphone, Upload } from 'lucide-react';
import { useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import AppLogo from '../components/AppLogo';
import UploadModal from '../components/UploadModal';
import ConnectMobileModal from '../components/ConnectMobileModal';

const MobileMenu = () => {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [isScanning, setIsScanning] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isConnectMobileOpen, setIsConnectMobileOpen] = useState(false);
  const isAdmin = user?.role === 'ADMIN';

  const handleScan = async () => {
    setIsScanning(true);
    try {
      await api.post('/library/scan');
      showToast({ title: 'Scan started', description: 'Checking libraries for new content.', tone: 'info' });
    } catch {
      showToast({ title: 'Scan failed', description: 'Check server logs.', tone: 'error' });
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="mobile-menu-page">
      <div className="mobile-menu-logo">
        <AppLogo className="library-brand" imageClassName="library-brand-image" textClassName="library-title" />
      </div>

      <div className="mobile-menu-user">
        <div className="mobile-menu-avatar">
          {user?.username?.charAt(0).toUpperCase() ?? '?'}
        </div>
        <div>
          <div className="mobile-menu-username">{user?.username}</div>
          <div className="mobile-menu-role">{user?.role?.toLowerCase()}</div>
        </div>
      </div>

      {isAdmin && (
        <div className="mobile-menu-section">
          <span className="mobile-menu-section-label">Library</span>
          <button className="mobile-menu-item" onClick={handleScan} disabled={isScanning}>
            <RefreshCw size={18} className={`mobile-menu-item-icon${isScanning ? ' animate-spin' : ''}`} />
            {isScanning ? 'Scanning…' : 'Scan Library'}
          </button>
          <button className="mobile-menu-item" onClick={() => setIsUploadOpen(true)}>
            <Upload size={18} className="mobile-menu-item-icon" />
            Add Book
          </button>
        </div>
      )}

      <div className="mobile-menu-section">
        <span className="mobile-menu-section-label">Account</span>
        <button className="mobile-menu-item" onClick={() => setIsConnectMobileOpen(true)}>
          <Smartphone size={18} className="mobile-menu-item-icon" />
          Connect Mobile App
        </button>
      </div>

      {isAdmin && (
        <div className="mobile-menu-section">
          <span className="mobile-menu-section-label">Admin</span>
          <button className="mobile-menu-item" onClick={() => navigate('/files', { state: { from: '/' } })}>
            <FolderOpen size={18} className="mobile-menu-item-icon" />
            File Manager
          </button>
          <button className="mobile-menu-item" onClick={() => navigate('/settings', { state: { from: '/' } })}>
            <Settings size={18} className="mobile-menu-item-icon" />
            Admin Settings
          </button>
        </div>
      )}

      <div className="mobile-menu-section">
        <button className="mobile-menu-item danger" onClick={logout}>
          <LogOut size={18} className="mobile-menu-item-icon" />
          Sign Out
        </button>
      </div>

      {isUploadOpen && (
        <UploadModal
          onClose={() => setIsUploadOpen(false)}
          onUploadComplete={() => { setIsUploadOpen(false); navigate('/'); }}
        />
      )}

      {isConnectMobileOpen && (
        <ConnectMobileModal onClose={() => setIsConnectMobileOpen(false)} />
      )}
    </div>
  );
};

export default MobileMenu;
