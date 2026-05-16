import { Router } from "express";
import {
  applyBookMatch,
  browseLibraryFolders,
  checkLibraryStructure,
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
  cleanupMergedBackupsHandler,
  findBookDuplicatesHandler,
  listAllDuplicatesHandler,
  resolveDuplicatesHandler,
  mergeBooksHandler,
  rescanSingleBookHandler,
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
  purgeLibrary,
  quickMatchBooks,
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
import { updateAppearanceSettingsHandler } from "../controllers/settingsController";
import { listAdminScriptsHandler, runAdminScriptHandler } from "../controllers/scriptController";
import {
  browseFilesystemTree,
  createFilesystemFolder,
  deleteFilesystemItems,
  listFilesystemRoots,
  listFilesystemTrash,
  moveFilesystemItems,
  permanentlyDeleteFilesystemTrash,
  previewFilesystemOperation,
  renameFilesystemItem,
  rescanFilesystemRoot,
  restoreFilesystemTrash,
} from "../controllers/filesystemController";
import { authenticate, authorizeAdmin } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticate, authorizeAdmin);

router.get("/dashboard", getAdminDashboard);
router.get("/tasks", listAdminTasks);
router.patch("/settings/appearance", updateAppearanceSettingsHandler);
router.get("/scripts", listAdminScriptsHandler);
router.post("/scripts/run", runAdminScriptHandler);
router.get("/filesystem", browseLibraryFolders);
router.get("/filesystem/roots", listFilesystemRoots);
router.get("/filesystem/tree", browseFilesystemTree);
router.post("/filesystem/preview", previewFilesystemOperation);
router.post("/filesystem/folder", createFilesystemFolder);
router.post("/filesystem/rename", renameFilesystemItem);
router.post("/filesystem/move", moveFilesystemItems);
router.post("/filesystem/delete", deleteFilesystemItems);
router.get("/filesystem/trash", listFilesystemTrash);
router.post("/filesystem/restore", restoreFilesystemTrash);
router.post("/filesystem/delete-permanently", permanentlyDeleteFilesystemTrash);
router.post("/filesystem/rescan", rescanFilesystemRoot);
router.get("/users", listUsers);
router.post("/users", createUser);
router.patch("/users/:userId", updateUser);
router.delete("/users/:userId", deleteUser);

router.get("/libraries", listLibraries);
router.post("/libraries", createLibrary);
router.patch("/libraries/:libraryId", updateLibrary);
router.delete("/libraries/:libraryId", deleteLibrary);
router.delete("/libraries/:libraryId/purge", purgeLibrary);
router.post("/libraries/:libraryId/sources", createLibrarySource);
router.get("/libraries/:libraryId/structure-check", checkLibraryStructure);
router.patch("/sources/:sourceId", updateLibrarySource);
router.delete("/sources/:sourceId", deleteLibrarySource);

router.get("/books", listAdminBooks);
router.post("/books/quick-match", quickMatchBooks);
router.post("/books/:bookId/match/search", searchBookMatches);
router.post("/books/:bookId/match/apply", applyBookMatch);
router.patch("/books/:bookId/metadata", updateBookMetadata);
router.post("/books/:bookId/write-tags", writeBookMetadataToFile);
router.post("/books/:bookId/merge-m4b", mergeBookFiles);
router.post("/books/:bookId/undo-merge", undoMergeBookFiles);
router.post("/books/:bookId/cleanup-backup", cleanupMergedBackupsHandler);
router.get("/books/:bookId/duplicates", findBookDuplicatesHandler);
router.get("/duplicates", listAllDuplicatesHandler);
router.post("/duplicates/resolve", resolveDuplicatesHandler);
router.post("/books/:bookId/merge-with", mergeBooksHandler);
router.post("/books/:bookId/rescan", rescanSingleBookHandler);
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
