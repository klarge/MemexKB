import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { 
  useGetArticle, 
  getGetArticleQueryKey, 
  useCreateArticle, 
  useUpdateArticle, 
  useListGroups,
  useSetArticleGroups
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, Save, Image as ImageIcon, Link as LinkIcon, Bold, Italic, List, ListOrdered, Heading1, Heading2, Code, Quote, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";

export default function ArticleEdit({ params }: { params?: { slug?: string } }) {
  const { slug } = params || {};
  const isNew = !slug || slug === "new";
  
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [title, setTitle] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  
  const { data: groupsData } = useListGroups();
  
  const { data: article, isLoading: isLoadingArticle } = useGetArticle(slug as string, {
    query: {
      enabled: !isNew && !!slug,
      queryKey: getGetArticleQueryKey(slug as string),
      retry: false,
    }
  });

  const createMutation = useCreateArticle();
  const updateMutation = useUpdateArticle();

  useEffect(() => {
    if (article && !isNew) {
      setTitle(article.title);
      setSelectedGroups(article.groups?.map(g => g.id) || []);
      if (editor && editor.getHTML() !== article.content) {
        editor.commands.setContent(article.content);
      }
    }
  }, [article, isNew]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Write your article content here..." }),
      Image.configure({ inline: true }),
      Link.configure({ openOnClick: false }),
    ],
    content: article?.content || "",
    editorProps: {
      attributes: {
        class: 'prose prose-stone dark:prose-invert max-w-none focus:outline-none min-h-[500px] p-4 border rounded-md bg-card',
      },
      handlePaste: (view, event, slice) => {
        const items = Array.from(event.clipboardData?.items || []);
        for (const item of items) {
          if (item.type.indexOf('image') === 0) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const formData = new FormData();
              formData.append('file', file);
              fetch('/api/articles/images', {
                method: 'POST',
                body: formData
              }).then(res => res.json()).then(data => {
                const { schema } = view.state;
                const node = schema.nodes.image.create({ src: data.url });
                const transaction = view.state.tr.replaceSelectionWith(node);
                view.dispatch(transaction);
              });
            }
            return true;
          }
        }
        return false;
      }
    }
  });

  const handleSave = () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }

    const content = editor?.getHTML() || "";

    if (isNew) {
      createMutation.mutate({ 
        data: { title, content, groupIds: selectedGroups } 
      }, {
        onSuccess: (data) => {
          toast({ title: "Article created" });
          setLocation(`/wiki/${data.slug}`);
        },
        onError: (err) => {
          toast({ title: "Failed to create", description: err.error, variant: "destructive" });
        }
      });
    } else if (slug) {
      updateMutation.mutate({ 
        slug, 
        data: { title, content, groupIds: selectedGroups } 
      }, {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: getGetArticleQueryKey(slug) });
          toast({ title: "Article updated" });
          setLocation(`/wiki/${data.slug}`);
        },
        onError: (err) => {
          toast({ title: "Failed to update", description: err.error, variant: "destructive" });
        }
      });
    }
  };

  const toggleGroup = (id: number) => {
    setSelectedGroups(prev => 
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  if (!isNew && isLoadingArticle) {
    return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div>;
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation(isNew ? '/articles' : `/wiki/${slug}`)}>
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
            <div className="flex items-center justify-between">
              <Label className="text-base">Content</Label>
            </div>
            
            {editor && (
              <div className="border border-border rounded-md bg-card overflow-hidden sticky top-0 z-10 shadow-sm mb-2 flex items-center p-1 gap-1 flex-wrap">
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'bg-muted' : ''}><Bold className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'bg-muted' : ''}><Italic className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-1" />
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive('heading', { level: 1 }) ? 'bg-muted' : ''}><Heading1 className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? 'bg-muted' : ''}><Heading2 className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-1" />
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? 'bg-muted' : ''}><List className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? 'bg-muted' : ''}><ListOrdered className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-1" />
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={editor.isActive('blockquote') ? 'bg-muted' : ''}><Quote className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive('codeBlock') ? 'bg-muted' : ''}><Code className="h-4 w-4" /></Button>
                <div className="w-px h-6 bg-border mx-1" />
                <Button variant="ghost" size="sm" onClick={() => {
                  const url = window.prompt('URL');
                  if (url) editor.chain().focus().setLink({ href: url }).run();
                }} className={editor.isActive('link') ? 'bg-muted' : ''}><LinkIcon className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  const url = window.prompt('Image URL');
                  if (url) editor.chain().focus().setImage({ src: url }).run();
                }}><ImageIcon className="h-4 w-4" /></Button>
              </div>
            )}
            
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
                  {groupsData?.map(group => (
                    <div key={group.id} className="flex items-center space-x-2">
                      <input 
                        type="checkbox" 
                        id={`group-${group.id}`} 
                        checked={selectedGroups.includes(group.id)}
                        onChange={() => toggleGroup(group.id)}
                        className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                      />
                      <label htmlFor={`group-${group.id}`} className="text-sm font-medium leading-none cursor-pointer">
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
                <li>Use <kbd className="bg-muted px-1 rounded border">[[</kbd> to link to other articles.</li>
                <li>You can paste images directly into the editor.</li>
                <li>Use markdown shortcuts like <kbd className="bg-muted px-1 rounded border">#</kbd> for headings.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
