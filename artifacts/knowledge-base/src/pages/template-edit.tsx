import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2, ArrowLeft, Save,
  Bold, Italic, List, ListOrdered, Heading1, Heading2, Code, Quote,
  Table as TableIcon, Link as LinkIcon, PanelRight, Tag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { InfoBoxExtension } from "@/lib/infobox-extension";

interface TagOption {
  id: number;
  name: string;
  color: string;
}

interface TemplateData {
  id: number;
  name: string;
  content: string;
  tags: TagOption[];
}

export default function TemplateEdit({ params }: { params?: { id?: string } }) {
  const id = params?.id && params.id !== "new" ? parseInt(params.id, 10) : null;
  const isNew = id === null;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [selectedTags, setSelectedTags] = useState<number[]>([]);

  const { data: existing, isLoading: isLoadingExisting } = useQuery<TemplateData>({
    queryKey: ["template", id],
    queryFn: () => fetch(`/api/templates/${id}`).then((r) => r.json()),
    enabled: !isNew,
  });

  const { data: tagsData = [] } = useQuery<TagOption[]>({
    queryKey: ["tags"],
    queryFn: () => fetch("/api/tags").then((r) => r.json()),
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Image,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Write your template content here…" }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      InfoBoxExtension,
    ],
    content: "",
  });

  useEffect(() => {
    if (existing && editor && !editor.isDestroyed) {
      setName(existing.name ?? "");
      editor.commands.setContent(existing.content ?? "");
      setSelectedTags(existing.tags?.map((t) => t.id) ?? []);
    }
  }, [existing, editor]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        content: editor?.getHTML() ?? "",
        tagIds: selectedTags,
      };
      const res = await fetch(
        isNew ? "/api/templates" : `/api/templates/${id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast({ title: isNew ? "Template created" : "Template saved" });
      setLocation("/templates");
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  if (!isNew && isLoadingExisting) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/templates")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Templates
        </Button>
        <h1 className="text-xl font-bold">{isNew ? "New Template" : "Edit Template"}</h1>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* ── Main column ── */}
        <div className="flex-1 space-y-4 min-w-0">
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Template name</Label>
            <Input
              id="template-name"
              placeholder="e.g., Meeting Notes, Bug Report, Onboarding Checklist"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-base"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Content</Label>
            {editor && (
              <div className="border border-border rounded-md bg-card overflow-hidden sticky top-0 z-10 shadow-sm mb-2 flex items-center p-1 gap-0.5 flex-wrap">
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive("bold") ? "bg-muted" : ""}><Bold className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive("italic") ? "bg-muted" : ""}><Italic className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive("heading", { level: 1 }) ? "bg-muted" : ""}><Heading1 className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive("heading", { level: 2 }) ? "bg-muted" : ""}><Heading2 className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive("bulletList") ? "bg-muted" : ""}><List className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive("orderedList") ? "bg-muted" : ""}><ListOrdered className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={editor.isActive("blockquote") ? "bg-muted" : ""}><Quote className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive("codeBlock") ? "bg-muted" : ""}><Code className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button variant="ghost" size="sm" onClick={() => {
                  const url = window.prompt("URL");
                  if (url) editor.chain().focus().setLink({ href: url }).run();
                }} className={editor.isActive("link") ? "bg-muted" : ""}><LinkIcon className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button variant="ghost" size="sm" title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
                  <TableIcon className="h-4 w-4" />
                </Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button
                  variant="ghost"
                  size="sm"
                  title="Insert infobox"
                  onClick={() =>
                    editor.chain().focus().insertContent({
                      type: "infobox",
                      attrs: {
                        title: "",
                        rows: JSON.stringify([
                          { label: "", value: "" },
                          { label: "", value: "" },
                          { label: "", value: "" },
                        ]),
                      },
                    }).run()
                  }
                >
                  <PanelRight className="h-4 w-4" />
                </Button>
              </div>
            )}
            <Card>
              <CardContent className="p-0">
                <EditorContent
                  editor={editor}
                  className="prose prose-sm dark:prose-invert max-w-none min-h-[260px] px-4 py-3 focus-within:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[240px]"
                />
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setLocation("/templates")}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {isNew ? "Create template" : "Save changes"}
            </Button>
          </div>
        </div>

        {/* ── Sidebar ── */}
        {tagsData.length > 0 && (
          <div className="w-full lg:w-64 shrink-0">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" /> Default tags
                </CardTitle>
                <p className="text-xs text-muted-foreground leading-snug">
                  Articles created from this template will start with these tags applied.
                </p>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex flex-wrap gap-1.5">
                  {tagsData.map((tag) => {
                    const selected = selectedTags.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          setSelectedTags((prev) =>
                            selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                          )
                        }
                        className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                        style={
                          selected
                            ? { backgroundColor: tag.color, color: "#fff", borderColor: tag.color }
                            : { backgroundColor: "transparent", color: tag.color, borderColor: tag.color }
                        }
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
