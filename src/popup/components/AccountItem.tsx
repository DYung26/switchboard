import { useState } from "react";
import type { SavedAccount } from "@/types/account";
import { formatRelativeTime } from "@/utils/format-time";
import { AccountActionsMenu } from "./AccountActionsMenu";

interface AccountItemProps {
  account: SavedAccount;
  isActive: boolean;
  isDropTarget: boolean;
  dragHandleProps: DragHandleProps;
  onSwitch: () => void;
  onRename: () => void;
  onReplace: () => void;
  onDuplicate: () => void;
  onViewRaw: () => void;
  onDelete: () => void;
}

export interface DragHandleProps {
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function describeMeta(account: SavedAccount): { label: string; title: string } {
  const label = account.lastUsed
    ? `Used ${formatRelativeTime(account.lastUsed)}`
    : account.updatedAt !== account.createdAt
      ? `Updated ${formatRelativeTime(account.updatedAt)}`
      : `Saved ${formatRelativeTime(account.createdAt)}`;

  const title = [
    `Saved ${new Date(account.createdAt).toLocaleString()}`,
    `Updated ${new Date(account.updatedAt).toLocaleString()}`,
    account.lastUsed
      ? `Last used ${new Date(account.lastUsed).toLocaleString()}`
      : "Never used",
  ].join("\n");

  return { label, title };
}

export function AccountItem({
  account,
  isActive,
  isDropTarget,
  dragHandleProps,
  onSwitch,
  onRename,
  onReplace,
  onDuplicate,
  onViewRaw,
  onDelete,
}: AccountItemProps): JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (confirmingDelete) {
    return (
      <div className="account-item account-item--confirm">
        <span className="account-item__confirm-text">
          Delete &ldquo;{account.name}&rdquo;?
        </span>
        <div className="account-item__actions">
          <button className="btn btn--danger btn--sm" onClick={onDelete}>
            Delete
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const meta = describeMeta(account);

  const rootClassName = [
    "account-item",
    isActive && "account-item--active",
    isDropTarget && "account-item--drop-target",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      <span
        className="account-item__drag-handle"
        draggable={dragHandleProps.draggable}
        onDragStart={dragHandleProps.onDragStart}
        onDragEnd={dragHandleProps.onDragEnd}
        title={
          dragHandleProps.draggable
            ? "Drag to reorder"
            : "Clear search to reorder"
        }
        aria-hidden="true"
      >
        ☰
      </span>
      <div className="account-item__info">
        <span className="account-item__name">{account.name}</span>
        <span className="account-item__meta" title={meta.title}>
          {meta.label}
        </span>
      </div>
      <div className="account-item__actions">
        {isActive && <span className="account-item__badge">Active</span>}
        {!isActive && (
          <button
            className="btn btn--primary btn--sm"
            onClick={onSwitch}
            title="Switch to this account"
          >
            Switch
          </button>
        )}
        <AccountActionsMenu
          onRename={onRename}
          onReplace={onReplace}
          onDuplicate={onDuplicate}
          onViewRaw={onViewRaw}
          onDelete={() => setConfirmingDelete(true)}
        />
      </div>
    </div>
  );
}
