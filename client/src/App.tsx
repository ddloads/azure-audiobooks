import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { TaskProvider } from "./context/TaskContext";
import { ToastProvider } from "./context/ToastContext";
import AccountEmailPrompt from "./components/AccountEmailPrompt";
import UnifiedShell from "./components/UnifiedShell";
import "./styles/globals.css";

const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Home = lazy(() => import("./pages/Home"));
const Library = lazy(() => import("./pages/Library"));
const DuplicatesPage = lazy(() => import("./pages/DuplicatesPage"));
const BookDetailsPage = lazy(() => import("./pages/BookDetailsPage"));
const AdminSettingsPage = lazy(() => import("./pages/AdminSettingsPage"));
const AdminFileManagerPage = lazy(() => import("./pages/AdminFileManagerPage"));
const MobileMenu = lazy(() => import("./mobile/MobileMenu"));
const AuthorsPage = lazy(() => import("./pages/AuthorsPage"));
const AccountSettingsPage = lazy(() => import("./pages/AccountSettingsPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const StatsPage = lazy(() => import("./pages/StatsPage"));
const SeriesPage = lazy(() => import("./pages/SeriesPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));

const AppLoading = () => <div className="app-loading"><div className="app-loading-spinner" /></div>;

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
  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/login" />;
  if (user.role !== "ADMIN") return <Navigate to="/" replace />;
  return <>{children}</>;
};

function AppRoutes() {
  return (
    <Suspense fallback={<AppLoading />}>
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
    </Suspense>
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
