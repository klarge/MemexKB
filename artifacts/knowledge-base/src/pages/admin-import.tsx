import { useState, useRef } from "react";
import { useAdminImportAll } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, UploadCloud, Download, FileArchive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export default function AdminImport() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    
    setIsUploading(true);
    setImportResult(null);
    
    const formData = new FormData();
    formData.append("file", file);
    if (overwrite) {
      formData.append("overwrite", "true");
    }

    try {
      const response = await fetch("/api/admin/import", {
        method: "POST",
        body: formData,
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Import failed");
      }
      
      setImportResult(result);
      toast({
        title: "Import complete",
        description: `Imported ${result.imported} articles. Skipped ${result.skipped}.`,
      });
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err: any) {
      toast({
        title: "Import Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleExport = () => {
    window.open("/api/admin/export", "_blank");
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Import & Export</h1>
        <p className="text-muted-foreground mt-1">Backup your knowledge base or import articles from a ZIP file.</p>
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
              Import Articles
            </CardTitle>
            <CardDescription>
              Upload a ZIP archive containing Markdown files to import them into the knowledge base.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div 
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${file ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept=".zip,application/zip" 
                onChange={handleFileChange}
              />
              <UploadCloud className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
              {file ? (
                <div className="font-medium text-primary">{file.name}</div>
              ) : (
                <div className="text-muted-foreground">Click to select a ZIP file or drag and drop</div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox 
                id="overwrite" 
                checked={overwrite} 
                onCheckedChange={(c) => setOverwrite(c as boolean)} 
              />
              <Label htmlFor="overwrite" className="text-sm font-normal">
                Overwrite existing articles with the same slug
              </Label>
            </div>

            <Button 
              onClick={handleImport} 
              disabled={!file || isUploading} 
              className="w-full"
            >
              {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isUploading ? "Importing..." : "Start Import"}
            </Button>

            {importResult && (
              <div className="mt-4 p-4 bg-muted rounded-md text-sm space-y-2">
                <div className="font-semibold">Import Results:</div>
                <div className="text-green-600 dark:text-green-400">✅ {importResult.imported} imported successfully</div>
                {importResult.skipped > 0 && <div className="text-amber-600 dark:text-amber-400">⚠️ {importResult.skipped} skipped</div>}
                
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
