import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, UploadCloud, Download, FileArchive, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

type ImportResult = { imported: number; skipped: number; errors: string[] };

export default function AdminImport() {
  const { toast } = useToast();
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

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

  const handleExport = () => {
    window.open("/api/admin/export", "_blank");
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Import & Export</h1>
        <p className="text-muted-foreground mt-1">Backup your knowledge base or import articles.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Knowledge Base
            </CardTitle>
            <CardDescription>
              Download a ZIP archive containing all articles in Markdown format, along with their metadata.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleExport} className="w-full">
              <FileArchive className="mr-2 h-4 w-4" />
              Download ZIP Archive
            </Button>
          </CardContent>
        </Card>

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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Import from Folder (Multiple .md Files)
          </CardTitle>
          <CardDescription>
            Select a folder or multiple Markdown files to bulk-import articles. Each .md file becomes one article.
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
