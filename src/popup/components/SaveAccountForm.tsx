import { useState } from "react";
import { getErrorMessage } from "@/utils/get-error-message";

interface SaveAccountFormProps {
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
  existingNames: string[];
}

export function SaveAccountForm({
  onSave,
  onCancel,
  existingNames,
}: SaveAccountFormProps): JSX.Element {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const trimmed = name.trim();
  const isDuplicate = existingNames.some(
    (n) => n.toLowerCase() === trimmed.toLowerCase(),
  );

  async function handleSubmit(): Promise<void> {
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (isDuplicate) {
      setError("An account with this name already exists.");
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save account. Try again."));
      setSaving(false);
    }
  }

  return (
    <div className="form">
      <input
        className="input"
        type="text"
        placeholder="Account name (e.g. Work, Personal)"
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
          disabled={saving || !trimmed}
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
