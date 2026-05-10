import { Router } from "express";
import {
  applyBookMatch,
  browseLibraryFolders,
  completeAudibleCliAuth,
  createBackup,
  createLibrary,
  createLibrarySource,
  createUser,
  deleteBook,
  deleteAudibleCliProfileHandler,
  deleteLibrary,
  deleteLibrarySource,
  deleteUser,
  getAdminDashboard,
  getBookHasBackup,
  listAdminTasks,
  getAudibleCliStatusHandler,
  listWriteTagsJobs,
  listLibraries,
  listAdminBooks,
  listBackups,
  listUsers,
  mergeBookFiles,
  undoMergeBookFiles,
  renameAudibleCliProfileHandler,
  rescanLibrary,
  rescanSingleLibrary,
  searchBookMatches,
  setActiveAudibleCliProfileHandler,
  startAudibleCliAuth,
  updateBookMetadata,
  updateLibrary,
  updateLibrarySource,
  updateUser,
  getWriteTagsJobStatus,
  writeBookMetadataToFile,
} from "../controllers/adminController";
import { clearSystemLogs, listSystemLogs } from "../controllers/logController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticate, authorizeAdmin);

router.get("/dashboard", getAdminDashboard);
router.get("/tasks", listAdminTasks);
router.get("/filesystem", browseLibraryFolders);
router.get("/users", listUsers);
router.post("/users", createUser);
router.patch("/users/:userId", updateUser);
router.delete("/users/:userId", deleteUser);

router.get("/libraries", listLibraries);
router.post("/libraries", createLibrary);
router.patch("/libraries/:libraryId", updateLibrary);
router.delete("/libraries/:libraryId", deleteLibrary);
router.post("/libraries/:libraryId/sources", createLibrarySource);
router.patch("/sources/:sourceId", updateLibrarySource);
router.delete("/sources/:sourceId", deleteLibrarySource);

router.get("/books", listAdminBooks);
router.post("/books/:bookId/match/search", searchBookMatches);
router.post("/books/:bookId/match/apply", applyBookMatch);
router.patch("/books/:bookId/metadata", updateBookMetadata);
router.post("/books/:bookId/write-tags", writeBookMetadataToFile);
router.post("/books/:bookId/merge-m4b", mergeBookFiles);
router.post("/books/:bookId/undo-merge", undoMergeBookFiles);
router.get("/books/:bookId/has-backup", getBookHasBackup);
router.get("/books/:bookId/write-tags/:jobId", getWriteTagsJobStatus);
router.get("/write-tags/jobs", listWriteTagsJobs);
router.delete("/books/:bookId", deleteBook);
router.post("/library/scan", rescanLibrary);
router.post("/libraries/:libraryId/scan", rescanSingleLibrary);

router.get("/audible-cli/status", getAudibleCliStatusHandler);
router.post("/audible-cli/auth/start", startAudibleCliAuth);
router.post("/audible-cli/auth/complete", completeAudibleCliAuth);
router.post("/audible-cli/active-profile", setActiveAudibleCliProfileHandler);
router.patch("/audible-cli/profiles/:profileName", renameAudibleCliProfileHandler);
router.delete("/audible-cli/profiles/:profileName", deleteAudibleCliProfileHandler);

router.get("/backups", listBackups);
router.post("/backups", createBackup);
router.get("/logs", listSystemLogs);
router.delete("/logs", clearSystemLogs);

export default router;
