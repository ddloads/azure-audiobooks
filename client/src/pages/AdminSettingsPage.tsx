import { Navigate } from "react-router-dom";
import { useState } from "react";
import AdminSettingsModal from "../components/AdminSettingsModal";
import UploadModal from "../components/UploadModal";
import { useAuth } from "../context/AuthContext";

const AdminSettingsPage = () => {
  const { user } = useAuth();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  if (user?.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return (
    <>
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
    </>
  );
};

export default AdminSettingsPage;
