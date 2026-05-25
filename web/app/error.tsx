"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main>
      <div className="not-found">
        <div className="not-found-code" style={{ fontSize: 48 }}>出错了</div>
        <p style={{ fontSize: 14, marginTop: 8, color: "var(--text-muted)" }}>
          {error.message}
        </p>
        <button onClick={reset} style={{ marginTop: 20 }}>
          重试
        </button>
      </div>
    </main>
  );
}
