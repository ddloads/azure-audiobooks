import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PlayerProvider } from "./context/PlayerContext";
import { TaskProvider } from "./context/TaskContext";
import { ToastProvider } from "./context/ToastContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Library from "./pages/Library";
import DuplicatesPage from "./pages/DuplicatesPage";
import BookDetailsPage from "./pages/BookDetailsPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import AdminFileManagerPage from "./pages/AdminFileManagerPage";
import AccountEmailPrompt from "./components/AccountEmailPrompt";
import AppShell from "./components/AppShell";
import MobileLibrary from "./mobile/MobileLibrary";
import MobileBookDetails from "./mobile/MobileBookDetails";
import MobileMenu from "./mobile/MobileMenu";
import { useIsMobile } from "./hooks/useIsMobile";
import "./styles/globals.css";

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
  const isMobile = useIsMobile();

  return (
    <Routes>
      {/* Public — no shell */}
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* All authenticated routes share the unified AppShell */}
      <Route element={<AppShell />}>
        <Route
          path="/"
          element={
            <PrivateRoute>
              {isMobile ? <MobileLibrary /> : <Library />}
            </PrivateRoute>
          }
        />
        <Route
          path="/book/:bookId"
          element={
            <PrivateRoute>
              {isMobile ? <MobileBookDetails /> : <BookDetailsPage />}
            </PrivateRoute>
          }
        />
        <Route
          path="/menu"
          element={<PrivateRoute><MobileMenu /></PrivateRoute>}
        />
        <Route
          path="/settings"
          element={<AdminRoute><AdminSettingsPage /></AdminRoute>}
        />
        <Route
          path="/files"
          element={<AdminRoute><AdminFileManagerPage /></AdminRoute>}
        />
        <Route
          path="/duplicates"
          element={<AdminRoute><DuplicatesPage /></AdminRoute>}
        />
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
