import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { WikilinkItem } from "./wikilink-extension";

interface WikilinkListProps {
  items: WikilinkItem[];
  command: (item: WikilinkItem) => void;
}

export interface WikilinkListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const WikilinkList = forwardRef<WikilinkListHandle, WikilinkListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown(event: KeyboardEvent) {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        if (event.key === "Escape") {
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="bg-popover border border-border rounded-md shadow-lg overflow-hidden min-w-[200px]">
          <div className="px-3 py-2 text-sm text-muted-foreground italic">No articles found</div>
        </div>
      );
    }

    return (
      <div className="bg-popover border border-border rounded-md shadow-lg overflow-hidden min-w-[200px] max-w-[320px] max-h-[240px] overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={item.slug}
            type="button"
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50"
            }`}
            onClick={() => command(item)}
          >
            {item.title}
          </button>
        ))}
      </div>
    );
  },
);
WikilinkList.displayName = "WikilinkList";
