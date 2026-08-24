import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, UploadCloud, Download, FileArchive, FolderOpen, BookOpen, ListTodo, FolderKanban, RotateCcw, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { previewAdminRestore, restoreAdminBackup } from "@workspace/api-client-react";

type ImportResult = { imported: number; skipped: number; errors: string[] };
type RestoreOwner = { key: string; label: string; suggestedUserId: number | null };
type RestoreUser = { id: number; name: string; email: string };
type RestorePreview = {
  kind: "logs" | "tasks" | "projects";
  total: number;
  owners: RestoreOwner[];
  users: RestoreUser[];
  warnings: string[];
};
type RestoreResult = {
  kind: string;
  imported: { logs: number; taskLists: number; tasks: number; projects: number; boards: number; columns: number; cards: number };
  skipped: number;
  warnings: string[];
};

function useExportDownload(endpoint: string, filename: string) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    setIsExporting(true);
    try {
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) {
        let msg = "Export failed";
        try { const err = await response.json(); msg = err.error || msg; } catch { /* non-JSON */ }
        throw new Error(msg);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Export Error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return { run, isExporting };
}

export default function AdminImport() {
  const { toast } = useToast();
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [ownerMappings, setOwnerMappings] = useState<Record<string, string>>({});
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [isPreviewingRestore, setIsPreviewingRestore] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const kbExport = useExportDownload("/api/admin/export", "knowledge-base-export.zip");
  const logsExport = useExportDownload("/api/admin/export/logs", "logs-export.json");
  const tasksExport = useExportDownload("/api/admin/export/tasks", "tasks-export.json");
  const projectsExport = useExportDownload("/api/admin/export/projects", "projects-export.json");

  const handleZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setZipFile(e.target.files[0]);
      setFolderFiles([]);
      setImportResult(null);
    }
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const mdFiles = Array.from(e.target.files).filter((f) =>
        f.name.toLowerCase().endsWith(".md")
      );
      setFolderFiles(mdFiles);
      setZipFile(null);
      setImportResult(null);
    }
  };

  const doImport = async (formData: FormData) => {
    setIsUploading(true);
    setImportResult(null);
    try {
      const response = await fetch("/api/admin/import", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed");
      setImportResult(result);
      toast({
        title: "Import complete",
        description: `Imported ${result.imported} articles. Skipped ${result.skipped}.`,
      });
      setZipFile(null);
      setFolderFiles([]);
      if (zipInputRef.current) zipInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    } catch (err) {
      toast({
        title: "Import Error",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleZipImport = async () => {
    if (!zipFile) return;
    const formData = new FormData();
    formData.append("file", zipFile);
    if (overwrite) formData.append("overwrite", "true");
    await doImport(formData);
  };

  const handleFolderImport = async () => {
    if (folderFiles.length === 0) return;
    const formData = new FormData();
    for (const f of folderFiles) formData.append("files", f);
    if (overwrite) formData.append("overwrite", "true");
    await doImport(formData);
  };

  const handleRestoreFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setRestoreFile(file);
    setRestorePreview(null);
    setOwnerMappings({});
    setRestoreConfirmed(false);
    setRestoreResult(null);
  };

  const previewRestore = async () => {
    if (!restoreFile) return;
    setIsPreviewingRestore(true);
    setRestorePreview(null);
    setRestoreResult(null);
    try {
      const preview = await previewAdminRestore({ file: restoreFile }) as RestorePreview;
      setRestorePreview(preview);
      setOwnerMappings(Object.fromEntries(
        preview.owners
          .filter((owner) => owner.suggestedUserId !== null)
          .map((owner) => [owner.key, String(owner.suggestedUserId)]),
      ));
    } catch (error) {
      toast({
        title: "Backup could not be previewed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsPreviewingRestore(false);
    }
  };

  const restoreBackup = async () => {
    if (!restoreFile || !restorePreview) return;
    setIsRestoring(true);
    setRestoreResult(null);
    try {
      const result = await restoreAdminBackup({
        file: restoreFile,
        ownerMappings: JSON.stringify(
        Object.fromEntries(Object.entries(ownerMappings).map(([key, value]) => [key, Number(value)])),
        ),
      }) as RestoreResult;
      setRestoreResult(result);
      toast({
        title: "Backup restored",
        description: `${restorePreview.kind[0].toUpperCase()}${restorePreview.kind.slice(1)} were restored safely.`,
      });
      setRestoreConfirmed(false);
    } catch (error) {
      toast({
        title: "Restore failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const hasAllOwnerMappings = restorePreview?.owners.every((owner) => Boolean(ownerMappings[owner.key])) ?? false;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Import &amp; Export</h1>
        <p className="text-muted-foreground mt-1">Backup your knowledge base or import articles.</p>
      </div>

      {/* ── Exports ── */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Exports</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Knowledge Base */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileArchive className="h-4 w-4" />
                Knowledge Base
              </CardTitle>
              <CardDescription className="text-xs">
                All articles and images as a ZIP archive (Markdown + HTML + metadata).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={kbExport.run}
                disabled={kbExport.isExporting}
              >
                {kbExport.isExporting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Download className="mr-2 h-4 w-4" />}
                {kbExport.isExporting ? "Preparing…" : "Download ZIP"}
              </Button>
            </CardContent>
          </Card>

          {/* Log Entries */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4" />
                Log Entries
              </CardTitle>
              <CardDescription className="text-xs">
                All log entries with content and metadata as JSON.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={logsExport.run}
                disabled={logsExport.isExporting}
              >
                {logsExport.isExporting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Download className="mr-2 h-4 w-4" />}
                {logsExport.isExporting ? "Preparing…" : "Download JSON"}
              </Button>
            </CardContent>
          </Card>

          {/* Task Lists */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListTodo className="h-4 w-4" />
                Task Lists
              </CardTitle>
              <CardDescription className="text-xs">
                All task lists and their tasks (all users) with completion status as JSON.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={tasksExport.run}
                disabled={tasksExport.isExporting}
              >
                {tasksExport.isExporting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Download className="mr-2 h-4 w-4" />}
                {tasksExport.isExporting ? "Preparing…" : "Download JSON"}
              </Button>
            </CardContent>
          </Card>

          {/* Projects */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderKanban className="h-4 w-4" />
                Projects &amp; Boards
              </CardTitle>
              <CardDescription className="text-xs">
                All projects, boards, columns, and cards with assignments as JSON.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={projectsExport.run}
                disabled={projectsExport.isExporting}
              >
                {projectsExport.isExporting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Download className="mr-2 h-4 w-4" />}
                {projectsExport.isExporting ? "Preparing…" : "Download JSON"}
              </Button>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* ── Restore data backups ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Restore Logs, Tasks, or Projects
          </CardTitle>
          <CardDescription>
            Select a JSON backup created by this app. You will review it and map each exported owner to a local account before anything is restored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <input
            id="restore-backup-file"
            type="file"
            ref={restoreInputRef}
            className="sr-only"
            accept=".json,application/json"
            onChange={handleRestoreFileChange}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button variant="outline" type="button" onClick={() => restoreInputRef.current?.click()}>
              <UploadCloud className="mr-2 h-4 w-4" />
              Choose JSON backup
            </Button>
            <div className="text-sm text-muted-foreground" aria-live="polite">
              {restoreFile ? `${restoreFile.name} (${Math.ceil(restoreFile.size / 1024)} KB)` : "No file selected"}
            </div>
            <Button type="button" onClick={previewRestore} disabled={!restoreFile || isPreviewingRestore} className="sm:ml-auto">
              {isPreviewingRestore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {isPreviewingRestore ? "Checking…" : "Preview restore"}
            </Button>
          </div>

          {restorePreview && (
            <div className="space-y-5 rounded-lg border bg-muted/30 p-4" aria-live="polite">
              <div>
                <h3 className="font-semibold">Restore preview</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  This backup contains {restorePreview.total} {restorePreview.kind === "tasks" ? "task list or task record" : restorePreview.kind} record{restorePreview.total === 1 ? "" : "s"}.
                  Existing matching records will be skipped; nothing is overwritten.
                </p>
              </div>

              {restorePreview.owners.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-medium">Map exported owners</h4>
                    <p className="text-xs text-muted-foreground">Private logs and task lists cannot be restored until every owner is matched to a local account.</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {restorePreview.owners.map((owner) => (
                      <div key={owner.key} className="space-y-1.5">
                        <Label htmlFor={`owner-${owner.key}`} className="text-xs">Exported owner: {owner.label}</Label>
                        <Select
                          value={ownerMappings[owner.key] ?? ""}
                          onValueChange={(value) => setOwnerMappings((current) => ({ ...current, [owner.key]: value }))}
                        >
                          <SelectTrigger id={`owner-${owner.key}`}>
                            <SelectValue placeholder="Choose local account" />
                          </SelectTrigger>
                          <SelectContent>
                            {restorePreview.users.map((user) => (
                              <SelectItem key={user.id} value={String(user.id)}>
                                {user.name} · {user.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {restorePreview.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                  <div className="font-medium">This backup needs attention</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {restorePreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex items-start gap-2">
                <Checkbox
                  id="confirm-restore"
                  checked={restoreConfirmed}
                  onCheckedChange={(checked) => setRestoreConfirmed(checked === true)}
                />
                <Label htmlFor="confirm-restore" className="text-sm font-normal leading-5">
                  I reviewed the owner mappings. Restore this backup as new data and skip any matching local records.
                </Label>
              </div>
              <Button
                type="button"
                onClick={restoreBackup}
                disabled={!restoreConfirmed || !hasAllOwnerMappings || restorePreview.warnings.length > 0 || isRestoring}
              >
                {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                {isRestoring ? "Restoring…" : "Restore backup"}
              </Button>
              {!hasAllOwnerMappings && restorePreview.owners.length > 0 && (
                <p className="text-xs text-muted-foreground">Choose a local account for each exported owner to continue.</p>
              )}
            </div>
          )}

          {restoreResult && (
            <div className="rounded-md border bg-muted/40 p-4 text-sm" role="status">
              <div className="font-semibold">Restore results</div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-4">
                {restoreResult.imported.logs > 0 && <span>{restoreResult.imported.logs} logs created</span>}
                {restoreResult.imported.taskLists > 0 && <span>{restoreResult.imported.taskLists} lists created</span>}
                {restoreResult.imported.tasks > 0 && <span>{restoreResult.imported.tasks} tasks created</span>}
                {restoreResult.imported.projects > 0 && <span>{restoreResult.imported.projects} projects created</span>}
                {restoreResult.imported.boards > 0 && <span>{restoreResult.imported.boards} boards created</span>}
                {restoreResult.imported.columns > 0 && <span>{restoreResult.imported.columns} columns created</span>}
                {restoreResult.imported.cards > 0 && <span>{restoreResult.imported.cards} cards created</span>}
                {restoreResult.skipped > 0 && <span>{restoreResult.skipped} records skipped</span>}
              </div>
              {restoreResult.warnings.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-700 dark:text-amber-300">
                  {restoreResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Import ── */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Import Articles</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UploadCloud className="h-5 w-5" />
                Import from ZIP or .md File
              </CardTitle>
              <CardDescription>
                Upload a ZIP archive (with metadata) or a single .md file to import articles.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${zipFile ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                onClick={() => zipInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={zipInputRef}
                  className="hidden"
                  accept=".zip,application/zip,.md,text/markdown,text/plain"
                  onChange={handleZipChange}
                />
                <UploadCloud className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                {zipFile ? (
                  <div className="font-medium text-primary">{zipFile.name}</div>
                ) : (
                  <div className="text-muted-foreground">Click to select a ZIP archive or a single .md file</div>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="overwrite-zip"
                  checked={overwrite}
                  onCheckedChange={(c) => setOverwrite(c as boolean)}
                />
                <Label htmlFor="overwrite-zip" className="text-sm font-normal">
                  Overwrite existing articles with the same slug
                </Label>
              </div>

              <Button onClick={handleZipImport} disabled={!zipFile || isUploading} className="w-full">
                {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isUploading ? "Importing..." : "Start Import"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                Import from Folder
              </CardTitle>
              <CardDescription>
                Select a folder or multiple Markdown files to bulk-import articles.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${folderFiles.length > 0 ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                onClick={() => folderInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={folderInputRef}
                  className="hidden"
                  accept=".md,text/markdown"
                  multiple
                  onChange={handleFolderChange}
                />
                <FolderOpen className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                {folderFiles.length > 0 ? (
                  <div className="font-medium text-primary">{folderFiles.length} .md file{folderFiles.length !== 1 ? "s" : ""} selected</div>
                ) : (
                  <div className="text-muted-foreground">Click to select multiple .md files</div>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="overwrite-folder"
                  checked={overwrite}
                  onCheckedChange={(c) => setOverwrite(c as boolean)}
                />
                <Label htmlFor="overwrite-folder" className="text-sm font-normal">
                  Overwrite existing articles with the same slug
                </Label>
              </div>

              <Button onClick={handleFolderImport} disabled={folderFiles.length === 0 || isUploading} className="w-full">
                {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isUploading ? "Importing..." : `Import ${folderFiles.length > 0 ? folderFiles.length : ""} Files`}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {importResult && (
        <div className="p-4 bg-muted rounded-md text-sm space-y-2">
          <div className="font-semibold">Import Results:</div>
          <div className="text-green-600 dark:text-green-400">✅ {importResult.imported} imported successfully</div>
          {importResult.skipped > 0 && (
            <div className="text-amber-600 dark:text-amber-400">⚠️ {importResult.skipped} skipped</div>
          )}
          {importResult.errors && importResult.errors.length > 0 && (
            <div className="mt-2 text-destructive">
              <div className="font-medium">Errors:</div>
              <ul className="list-disc pl-4 mt-1 space-y-1">
                {importResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
