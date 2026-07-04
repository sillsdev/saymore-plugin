/** SayMore's viewer readout: "02.6 / 16.8" (position / total, one decimal, zero-padded). */
export function formatPosTotal(positionSec: number, totalSec: number): string {
  return `${formatSeconds(positionSec)} / ${formatSeconds(totalSec)}`;
}

function formatSeconds(sec: number): string {
  return Math.max(0, sec).toFixed(1).padStart(4, "0");
}
