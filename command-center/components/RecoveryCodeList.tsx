/** Recovery codes, shown once, with a local text download (data URI; nothing leaves the browser). */
export function RecoveryCodeList({ codes }: { codes: string[] }) {
  const text = `Command Center recovery codes\nEach code works once.\n\n${codes.join("\n")}\n`;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Save these {codes.length} recovery codes somewhere safe (a password manager or on paper). Each works once if you lose
        your phone. <strong>They will not be shown again.</strong>
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-card border border-line bg-surface p-card font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <a
        href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
        download="command-center-recovery-codes.txt"
        className="inline-block rounded-control border border-line px-4 py-2 text-sm"
      >
        Download as text
      </a>
    </div>
  );
}
