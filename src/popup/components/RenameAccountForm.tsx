import { useState } from "react";
import { getErrorMessage } from "@/utils/get-error-message";

interface RenameAccountFormProps {
  currentName: string;
  existingNames: string[];
  onRename: (name: string) => Promise<void>;
  onCancel: () => void;
}

export function RenameAccountForm({
  currentName,
  existingNames,
  onRename,
  onCancel,
}: RenameAccountFormProps): JSX.Element {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const trimmed = name.trim();
  const isUnchanged = trimmed.toLowerCase() === currentName.toLowerCase();
  const isDuplicate =
    !isUnchanged &&
    existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  async function handleSubmit(): Promise<void> {
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (isDuplicate) {
      setError("An account with this name already exists.");
      return;
    }
    if (isUnchanged) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to rename account. Try again."));
      setSaving(false);
    }
  }

  return (
    <div className="form form--inline">
      <input
        className="input"
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
        disabled={saving}
      />
      {error && <p className="form__error">{error}</p>}
      <div className="form__actions">
        <button
          className="btn btn--primary btn--sm"
          onClick={() => void handleSubmit()}
          disabled={saving || !trimmed || isUnchanged}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          className="btn btn--ghost btn--sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
