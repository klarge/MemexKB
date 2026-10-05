import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { validCitation } from "@/lib/citation-extension";

type Target = { id: string } | { from: number; to: number };

export function CitationTools({ editor }: { editor: Editor }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [canCite, setCanCite] = useState(false);

  const find = (id: string) => {
    let found: { pos: number; description: string; url: string } | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "citation" && node.attrs.id === id) {
        found = { pos, description: node.attrs.description, url: node.attrs.url };
      }
    });
    return found;
  };
  useEffect(() => {
    const selectionChanged = () => {
      const { from, to } = editor.state.selection;
      setCanCite(from !== to && Boolean(editor.state.doc.textBetween(from, to).trim()));
    };
    const edit = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const reference = find(id);
      if (!reference) return;
      setDescription(reference.description); setUrl(reference.url);
      setError(""); setTarget({ id });
    };
    selectionChanged();
    editor.on("selectionUpdate", selectionChanged);
    editor.on("update", selectionChanged);
    editor.view.dom.addEventListener("citation-edit", edit);
    return () => {
      editor.off("selectionUpdate", selectionChanged);
      editor.off("update", selectionChanged);
      editor.view.dom.removeEventListener("citation-edit", edit);
    };
  }, [editor]);

  const close = () => { setTarget(null); setError(""); };
  const save = () => {
    if (!target) return;
    const cleanDescription = description.trim(), cleanUrl = url.trim();
    if (!validCitation(cleanDescription, cleanUrl)) {
      setError("Enter a description and a valid http:// or https:// source URL."); return;
    }
    if ("id" in target) {
      const reference = find(target.id);
      if (!reference) { setError("This reference no longer exists. Close this dialog and try again."); return; }
      editor.view.dispatch(editor.state.tr.setNodeMarkup(reference.pos, undefined, {
        ...editor.state.doc.nodeAt(reference.pos)!.attrs, description: cleanDescription, url: cleanUrl,
      }));
    } else {
      editor.chain().focus().insertContentAt(target.to, {
        type: "citation", attrs: {
          id: `c-${crypto.randomUUID()}`, description: cleanDescription, url: cleanUrl, number: 1,
        },
      }).run();
    }
    close();
    requestAnimationFrame(() => editor.commands.focus());
  };
  const remove = () => {
    if (!target || !("id" in target)) return;
    const reference = find(target.id);
    if (reference) editor.view.dispatch(editor.state.tr.delete(reference.pos, reference.pos + 1));
    close();
    requestAnimationFrame(() => editor.commands.focus());
  };
  return <>
    <Button type="button" variant="ghost" size="sm" disabled={!canCite}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const { from, to } = editor.state.selection;
        setDescription(""); setUrl(""); setError(""); setTarget({ from, to });
      }}>
      <BookOpen className="mr-1.5 h-4 w-4" />Cite Source
    </Button>
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent onCloseAutoFocus={(event) => {
        event.preventDefault(); requestAnimationFrame(() => editor.commands.focus());
      }}>
        <DialogHeader>
          <DialogTitle>{target && "id" in target ? "Edit citation" : "Cite Source"}</DialogTitle>
          <DialogDescription>Add a description and URL. References and the Sources list are numbered automatically.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
          <div className="space-y-2">
            <Label htmlFor="citation-description">Description</Label>
            <Input id="citation-description" value={description} maxLength={1000} required
              onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="citation-url">Source URL</Label>
            <Input id="citation-url" type="url" placeholder="https://example.com/source"
              value={url} maxLength={2048} required onChange={(event) => setUrl(event.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {target && "id" in target && <Button type="button" variant="destructive" onClick={remove}>Remove reference</Button>}
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit">{target && "id" in target ? "Save citation" : "Add citation"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}