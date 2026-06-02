import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { TaskProvider } from "./context/TaskContext";
import { ToastProvider } from "./context/ToastContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Home from "./pages/Home";
import Library from "./pages/Library";
import DuplicatesPage from "./pages/DuplicatesPage";
import BookDetailsPage from "./pages/BookDetailsPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import AdminFileManagerPage from "./pages/AdminFileManagerPage";
import AccountEmailPrompt from "./components/AccountEmailPrompt";
import UnifiedShell from "./components/UnifiedShell";
import MobileMenu from "./mobile/MobileMenu";
import AuthorsPage from "./pages/AuthorsPage";
import AccountSettingsPage from "./pages/AccountSettingsPage";
import HistoryPage from "./pages/HistoryPage";
import StatsPage from "./pages/StatsPage";
import SeriesPage from "./pages/SeriesPage";
import ProfilePage from "./pages/ProfilePage";
import "./styles/globals.css";

function PlaybackGuard() {
  const { user } = useAuth();
  const { stopPlayer, currentBook } = usePlayer();
  useEffect(() => {
    if (!user && currentBook) stopPlayer();
  }, [user]);
  return null;
}

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><div className="app-loading-spinner" /></div>;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><div className="app-loading-spinner" /></div>;
  if (!user) return <Navigate to="/login" />;
  if (user.role !== "ADMIN") return <Navigate to="/" replace />;
  return <>{children}</>;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<UnifiedShell />}>
        <Route path="/"                    element={<PrivateRoute><Home /></PrivateRoute>} />
        <Route path="/library"             element={<PrivateRoute><Library /></PrivateRoute>} />
        <Route path="/series"              element={<PrivateRoute><Library defaultViewMode="series" /></PrivateRoute>} />
        <Route path="/series/:seriesId"    element={<PrivateRoute><SeriesPage /></PrivateRoute>} />
        <Route path="/book/:bookId"        element={<PrivateRoute><BookDetailsPage /></PrivateRoute>} />
        <Route path="/authors"             element={<PrivateRoute><AuthorsPage /></PrivateRoute>} />
        <Route path="/stats"               element={<PrivateRoute><StatsPage /></PrivateRoute>} />
        <Route path="/history"             element={<PrivateRoute><HistoryPage /></PrivateRoute>} />
        <Route path="/account"             element={<PrivateRoute><AccountSettingsPage /></PrivateRoute>} />
        <Route path="/profile"             element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="/menu"                element={<PrivateRoute><MobileMenu /></PrivateRoute>} />
        <Route path="/settings"            element={<AdminRoute><AdminSettingsPage /></AdminRoute>} />
        <Route path="/files"               element={<AdminRoute><AdminFileManagerPage /></AdminRoute>} />
        <Route path="/duplicates"          element={<AdminRoute><DuplicatesPage /></AdminRoute>} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <TaskProvider>
          <PlayerProvider>
            <Router>
              <PlaybackGuard />
              <AppRoutes />
              <AccountEmailPrompt />
            </Router>
          </PlayerProvider>
        </TaskProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
