import { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useLocation } from "wouter";
import {
  useGetArticle,
  getGetArticleQueryKey,
  useCreateArticle,
  useUpdateArticle,
  useListGroups,
  useListArticles,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, ArrowLeft, Save, Image as ImageIcon, Link as LinkIcon,
  Bold, Italic, List, ListOrdered, Heading1, Heading2, Code, Quote,
  Table as TableIcon, LayoutTemplate, PanelRight,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";

import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { WikilinkExtension, type WikilinkItem } from "@/lib/wikilink-extension";
import { WikilinkList, type WikilinkListHandle } from "@/lib/wikilink-list";
import { ResizableImageView } from "@/lib/resizable-image";
import { InfoBoxExtension } from "@/lib/infobox-extension";

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        // Serialise as an HTML width attribute so the sanitizer preserves it.
        // (The sanitizer strips non-whitelisted CSS styles but explicitly allows
        //  width/height attributes on <img>.)
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.width) return {};
          return { width: String(attributes.width) };
        },
        parseHTML: (element: HTMLElement) => {
          const attr = element.getAttribute("width");
          if (attr) return parseInt(attr, 10) || null;
          // Fallback: legacy articles saved with inline style before this fix
          const sw = element.style.width;
          return sw ? parseInt(sw, 10) || null : null;
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

export default function ArticleEdit({ params }: { params?: { slug?: string } }) {
  const { slug } = params || {};
  const isNew = !slug || slug === "new";
  const prefillTitle = isNew
    ? new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("title") || ""
    : "";

  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(prefillTitle);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

  const { data: templates = [] } = useQuery<{ id: number; name: string; content: string }[]>({
    queryKey: ["templates"],
    queryFn: () => fetch("/api/templates").then((r) => r.json()),
  });

  const { data: groupsData } = useListGroups();
  const { data: articlesData } = useListArticles({ limit: 500 });

  const { data: article, isLoading: isLoadingArticle } = useGetArticle(slug as string, {
    query: {
      enabled: !isNew && !!slug,
      queryKey: getGetArticleQueryKey(slug as string),
      retry: false,
    },
  });

  const createMutation = useCreateArticle();
  const updateMutation = useUpdateArticle();

  // Ref for wikilink suggestion items — avoids stale closures in the extension
  const wikilinkItemsRef = useRef<WikilinkItem[]>([]);
  useEffect(() => {
    wikilinkItemsRef.current = (articlesData?.articles ?? []).map((a) => ({
      slug: a.slug,
      title: a.title,
    }));
  }, [articlesData]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Write your article content here…" }),
      ResizableImage.configure({ inline: true }),
      Link.configure({ openOnClick: false }),

      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,

      InfoBoxExtension,

      WikilinkExtension.configure({
        suggestion: {
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            return wikilinkItemsRef.current
              .filter((a) => a.title.toLowerCase().includes(q))
              .slice(0, 10);
          },
          render: () => {
            let container: HTMLElement;
            let root: ReturnType<typeof createRoot>;
            let componentRef: WikilinkListHandle | null = null;

            return {
              onStart(props: SuggestionProps<WikilinkItem>) {
                container = document.createElement("div");
                container.style.cssText =
                  "position: absolute; z-index: 9999; pointer-events: auto;";
                document.body.appendChild(container);
                const rect = props.clientRect?.();
                if (rect) {
                  container.style.top = `${rect.bottom + window.scrollY + 4}px`;
                  container.style.left = `${rect.left + window.scrollX}px`;
                }
                root = createRoot(container);
                root.render(
                  <WikilinkList
                    ref={(ref) => {
                      componentRef = ref;
                    }}
                    items={props.items}
                    command={props.command}
                  />,
                );
              },
              onUpdate(props: SuggestionProps<WikilinkItem>) {
                const rect = props.clientRect?.();
                if (rect && container) {
                  container.style.top = `${rect.bottom + window.scrollY + 4}px`;
                  container.style.left = `${rect.left + window.scrollX}px`;
                }
                root?.render(
                  <WikilinkList
                    ref={(ref) => {
                      componentRef = ref;
                    }}
                    items={props.items}
                    command={props.command}
                  />,
                );
              },
              onKeyDown({ event }: SuggestionKeyDownProps) {
                return componentRef?.onKeyDown(event) ?? false;
              },
              onExit() {
                root?.unmount();
                container?.remove();
              },
            };
          },
        },
      }),
    ],
    content: article?.content || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-stone dark:prose-invert max-w-none focus:outline-none min-h-[500px] p-4 border rounded-md bg-card",
      },
      handlePaste: (view, event) => {
        const items = Array.from(event.clipboardData?.items || []);
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const fd = new FormData();
              fd.append("file", file);
              fetch("/api/articles/images", { method: "POST", body: fd })
                .then((r) => r.json())
                .then((data: { url: string }) => {
                  const { schema } = view.state;
                  const node = schema.nodes.image.create({ src: data.url });
                  const tr = view.state.tr.replaceSelectionWith(node);
                  view.dispatch(tr);
                })
                .catch(() => {});
            }
            return true;
          }
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (article && !isNew) {
      setTitle(article.title);
      setSelectedGroups(article.groups?.map((g) => g.id) || []);
      if (editor && editor.getHTML() !== article.content) {
        editor.commands.setContent(article.content);
      }
    }
  }, [article, isNew]);

  const handleSave = () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    const content = editor?.getHTML() || "";

    if (isNew) {
      createMutation.mutate(
        { data: { title, content, groupIds: selectedGroups } },
        {
          onSuccess: (data) => {
            toast({ title: "Article created" });
            setLocation(`/wiki/${data.slug}`);
          },
          onError: (err) => {
            toast({ title: "Failed to create", description: err.message, variant: "destructive" });
          },
        },
      );
    } else if (slug) {
      updateMutation.mutate(
        { slug, data: { title, content, groupIds: selectedGroups } },
        {
          onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: getGetArticleQueryKey(slug) });
            toast({ title: "Article updated" });
            setLocation(`/wiki/${data.slug}`);
          },
          onError: (err) => {
            toast({ title: "Failed to update", description: err.message, variant: "destructive" });
          },
        },
      );
    }
  };

  const toggleGroup = (id: number) => {
    setSelectedGroups((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  if (!isNew && isLoadingArticle) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation(isNew ? "/articles" : `/wiki/${slug}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">{isNew ? "Create Article" : "Edit Article"}</h1>
        <div className="flex-1" />
        <Button onClick={handleSave} disabled={isPending} data-testid="button-save-article">
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title" className="text-base">Article Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Q3 Engineering Guidelines"
              className="text-lg font-medium py-6"
              data-testid="input-article-title"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base">Content</Label>

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
                <Button variant="ghost" size="sm" onClick={() => {
                  const url = window.prompt("Image URL");
                  if (url) editor.chain().focus().setImage({ src: url }).run();
                }}><ImageIcon className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-0.5" />
                <Button
                  variant="ghost"
                  size="sm"
                  title="Insert table"
                  onClick={() =>
                    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
                  }
                >
                  <TableIcon className="h-4 w-4" />
                </Button>
                {editor.isActive("table") && (
                  <>
                    <Button variant="ghost" size="sm" title="Add column before" onClick={() => editor.chain().focus().addColumnBefore().run()} className="text-xs px-2">+col▶</Button>
                    <Button variant="ghost" size="sm" title="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()} className="text-xs px-2">+row▼</Button>
                    <Button variant="ghost" size="sm" title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()} className="text-xs px-2 text-destructive">−col</Button>
                    <Button variant="ghost" size="sm" title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()} className="text-xs px-2 text-destructive">−row</Button>
                  </>
                )}
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
                {templates.length > 0 && (
                  <>
                    <div className="w-px h-6 bg-border mx-0.5" />
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Insert template"
                      onClick={() => setTemplateDialogOpen(true)}
                    >
                      <LayoutTemplate className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            )}

            <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <LayoutTemplate className="h-5 w-5" /> Insert Template
                  </DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground -mt-1">
                  Choose a template to insert at the current cursor position.
                </p>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      className="w-full text-left rounded-md border border-border px-4 py-3 hover:bg-muted transition-colors"
                      onClick={() => {
                        editor?.chain().focus().insertContent(t.content).run();
                        setTemplateDialogOpen(false);
                      }}
                    >
                      <p className="font-medium text-sm">{t.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {t.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
                      </p>
                    </button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>

            <EditorContent editor={editor} />
          </div>
        </div>

        <div className="w-full lg:w-72 shrink-0 space-y-6">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div>
                <Label className="mb-2 block">Access Control</Label>
                <p className="text-xs text-muted-foreground mb-3">
                  Restrict this article to specific groups. If no groups are selected, everyone can access it.
                </p>
                <div className="space-y-2">
                  {groupsData?.map((group) => (
                    <div key={group.id} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`group-${group.id}`}
                        checked={selectedGroups.includes(group.id)}
                        onChange={() => toggleGroup(group.id)}
                        className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                      />
                      <label
                        htmlFor={`group-${group.id}`}
                        className="text-sm font-medium leading-none cursor-pointer"
                      >
                        {group.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <Label className="mb-2 block">Editor Tips</Label>
              <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4">
                <li>Type <kbd className="bg-muted px-1 rounded border">[[</kbd> to link to another article with autocomplete.</li>
                <li>You can paste images directly into the editor.</li>
                <li>Drag the corner handle of any image to resize it.</li>
                <li>Use the <kbd className="bg-muted px-1 rounded border"><TableIcon className="h-3 w-3 inline" /></kbd> button to insert a table.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
