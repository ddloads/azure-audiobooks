import { Navigate } from "react-router-dom";
import { lazy, Suspense, useState } from "react";
import { useAuth } from "../context/AuthContext";

const AdminSettingsModal = lazy(() => import("../components/AdminSettingsModal"));
const UploadModal = lazy(() => import("../components/UploadModal"));

const AdminSettingsPage = () => {
  const { user } = useAuth();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  if (user?.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={<div className="app-loading"><div className="app-loading-spinner" /></div>}>
      <AdminSettingsModal
        onLibraryChanged={() => undefined}
        onRequestUpload={() => setIsUploadModalOpen(true)}
      />

      {isUploadModalOpen && (
        <UploadModal
          onClose={() => setIsUploadModalOpen(false)}
          onUploadComplete={() => undefined}
        />
      )}
    </Suspense>
  );
};

export default AdminSettingsPage;
