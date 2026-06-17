import { formatSpeed } from '../utils';

export function updateTopbar(activeCount: number, totalSpeed: number): void {
  const activeCountEl = document.getElementById('active-count');
  const totalSpeedEl = document.getElementById('total-speed');

  if (activeCountEl) {
    activeCountEl.textContent = activeCount.toString();
  }

  if (totalSpeedEl) {
    totalSpeedEl.textContent = formatSpeed(totalSpeed);
  }
}
