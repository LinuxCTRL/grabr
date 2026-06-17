export function getProgressRingHtml(percent: number, status: string): string {
  const radius = 22;
  const circumference = 2 * Math.PI * radius; // 138.23
  const offset = circumference - (Math.max(0, Math.min(100, percent)) / 100) * circumference;

  let color = 'var(--accent)';
  if (status === 'completed') color = 'var(--success)';
  if (status === 'failed') color = 'var(--error)';
  if (status === 'paused') color = '#3b82f6';
  if (status === 'queued') color = 'var(--muted)';

  return `
    <svg class="progress-ring" width="50" height="50">
      <circle
        stroke="var(--border)"
        stroke-width="3.5"
        fill="transparent"
        r="${radius}"
        cx="25"
        cy="25"
      />
      <circle
        class="progress-ring__circle"
        stroke="${color}"
        stroke-width="3.5"
        fill="transparent"
        r="${radius}"
        cx="25"
        cy="25"
        style="
          stroke-dasharray: ${circumference};
          stroke-dashoffset: ${offset};
          transition: stroke-dashoffset 0.2s ease;
        "
      />
    </svg>
  `;
}
