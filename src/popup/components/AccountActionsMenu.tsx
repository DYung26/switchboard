import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface AccountActionsMenuProps {
  onRename: () => void;
  onReplace: () => void;
  onDuplicate: () => void;
  onViewRaw: () => void;
  onDelete: () => void;
}

interface DropdownPosition {
  top: number;
  left: number;
}

const DROPDOWN_WIDTH_PX = 120;
const DROPDOWN_GAP_PX = 4;

function computeDropdownPosition(trigger: HTMLElement): DropdownPosition {
  const rect = trigger.getBoundingClientRect();
  return {
    top: rect.bottom + DROPDOWN_GAP_PX,
    left: rect.right - DROPDOWN_WIDTH_PX,
  };
}

export function AccountActionsMenu({
  onRename,
  onReplace,
  onDuplicate,
  onViewRaw,
  onDelete,
}: AccountActionsMenuProps): JSX.Element {
  const [position, setPosition] = useState<DropdownPosition | undefined>(
    undefined,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const open = position !== undefined;

  // The dropdown initially opens below the trigger. If it doesn't fit in
  // the popup's actual rendered height (which auto-sizes to content, so
  // there's nothing to clip into below the last account), flip it to open
  // above the trigger instead.
  useLayoutEffect(() => {
    if (!open || !dropdownRef.current || !triggerRef.current) return;

    const dropdownHeight = dropdownRef.current.getBoundingClientRect().height;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom - DROPDOWN_GAP_PX;

    if (spaceBelow < dropdownHeight) {
      setPosition({
        top: triggerRect.top - DROPDOWN_GAP_PX - dropdownHeight,
        left: triggerRect.right - DROPDOWN_WIDTH_PX,
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setPosition(undefined);
      }
    }

    function handleDismiss(): void {
      setPosition(undefined);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [open]);

  function toggleOpen(): void {
    if (open) {
      setPosition(undefined);
      return;
    }
    if (triggerRef.current) {
      setPosition(computeDropdownPosition(triggerRef.current));
    }
  }

  function runAndClose(action: () => void): void {
    setPosition(undefined);
    action();
  }

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className="btn btn--ghost btn--sm account-menu__trigger"
        onClick={toggleOpen}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
      >
        ⋯
      </button>
      {position && (
        <div
          ref={dropdownRef}
          className="account-menu__dropdown"
          role="menu"
          style={{ top: position.top, left: position.left }}
        >
          <button role="menuitem" onClick={() => runAndClose(onRename)}>
            Rename
          </button>
          <button role="menuitem" onClick={() => runAndClose(onReplace)}>
            Replace
          </button>
          <button role="menuitem" onClick={() => runAndClose(onDuplicate)}>
            Duplicate
          </button>
          <button role="menuitem" onClick={() => runAndClose(onViewRaw)}>
            View Raw
          </button>
          <button
            role="menuitem"
            className="account-menu__item--danger"
            onClick={() => runAndClose(onDelete)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
