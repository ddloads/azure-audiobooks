import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PlayerProvider } from "./context/PlayerContext";
import { TaskProvider } from "./context/TaskContext";
import { ToastProvider } from "./context/ToastContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Library from "./pages/Library";
import BookDetailsPage from "./pages/BookDetailsPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import Player from "./components/Player";
import "./styles/globals.css";

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="app-loading">
      <div className="app-loading-spinner" />
    </div>
  );
  if (!user) return <Navigate to="/login" />;

  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="app-loading">
      <div className="app-loading-spinner" />
    </div>
  );
  if (!user) return <Navigate to="/login" />;
  if (user.role !== "ADMIN") return <Navigate to="/" replace />;

  return <>{children}</>;
};

function AppRoutes() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Library />
            </PrivateRoute>
          }
        />
        <Route
          path="/book/:bookId"
          element={
            <PrivateRoute>
              <BookDetailsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <AdminRoute>
              <AdminSettingsPage />
            </AdminRoute>
          }
        />
      </Routes>
      <Player />
    </>
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
            </Router>
          </PlayerProvider>
        </TaskProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
