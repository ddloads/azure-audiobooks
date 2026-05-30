import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PlayerProvider } from "./context/PlayerContext";
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
import AppShell from "./components/AppShell";
import MobilePrivateShell from "./mobile/MobileLayout";
import MobileHome from "./mobile/MobileHome";
import MobileLibrary from "./mobile/MobileLibrary";
import MobileBookDetails from "./mobile/MobileBookDetails";
import MobileMenu from "./mobile/MobileMenu";
import MobileAccountSettings from "./mobile/MobileAccountSettings";
import MobileAuthors from "./mobile/MobileAuthors";
import AuthorsPage from "./pages/AuthorsPage";
import AccountSettingsPage from "./pages/AccountSettingsPage";
import HistoryPage from "./pages/HistoryPage";
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
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />

      {isMobile ? (
        <Route element={<MobilePrivateShell />}>
          <Route path="/"          element={<PrivateRoute><MobileHome /></PrivateRoute>} />
          <Route path="/library"   element={<PrivateRoute><MobileLibrary /></PrivateRoute>} />
          <Route path="/series"    element={<PrivateRoute><MobileLibrary /></PrivateRoute>} />
          <Route path="/book/:bookId" element={<PrivateRoute><MobileBookDetails /></PrivateRoute>} />
          <Route path="/authors"   element={<PrivateRoute><MobileAuthors /></PrivateRoute>} />
          <Route path="/history"   element={<PrivateRoute><HistoryPage /></PrivateRoute>} />
          <Route path="/menu"      element={<PrivateRoute><MobileMenu /></PrivateRoute>} />
          <Route path="/account"   element={<PrivateRoute><MobileAccountSettings /></PrivateRoute>} />
          <Route path="/settings"  element={<AdminRoute><AdminSettingsPage /></AdminRoute>} />
          <Route path="/files"     element={<AdminRoute><AdminFileManagerPage /></AdminRoute>} />
          <Route path="/duplicates" element={<AdminRoute><DuplicatesPage /></AdminRoute>} />
        </Route>
      ) : (
        <Route element={<AppShell />}>
          <Route path="/"          element={<PrivateRoute><Home /></PrivateRoute>} />
          <Route path="/library"   element={<PrivateRoute><Library /></PrivateRoute>} />
          <Route path="/series"    element={<PrivateRoute><Library defaultViewMode="series" /></PrivateRoute>} />
          <Route path="/book/:bookId" element={<PrivateRoute><BookDetailsPage /></PrivateRoute>} />
          <Route path="/authors"   element={<PrivateRoute><AuthorsPage /></PrivateRoute>} />
          <Route path="/history"   element={<PrivateRoute><HistoryPage /></PrivateRoute>} />
          <Route path="/account"   element={<PrivateRoute><AccountSettingsPage /></PrivateRoute>} />
          <Route path="/menu"      element={<PrivateRoute><MobileMenu /></PrivateRoute>} />
          <Route path="/settings"  element={<AdminRoute><AdminSettingsPage /></AdminRoute>} />
          <Route path="/files"     element={<AdminRoute><AdminFileManagerPage /></AdminRoute>} />
          <Route path="/duplicates" element={<AdminRoute><DuplicatesPage /></AdminRoute>} />
        </Route>
      )}
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
