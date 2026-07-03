import type { SavedAccount } from "@/types/account";

interface RawAccountViewProps {
  account: SavedAccount;
  onBack: () => void;
}

export function RawAccountView({
  account,
  onBack,
}: RawAccountViewProps): JSX.Element {
  return (
    <div className="raw-view">
      <div className="raw-view__header">
        <span className="raw-view__title">{account.name}</span>
        <button className="btn btn--ghost btn--sm" onClick={onBack}>
          ← Back
        </button>
      </div>
      <pre className="raw-view__pre">{JSON.stringify(account, null, 2)}</pre>
    </div>
  );
}
