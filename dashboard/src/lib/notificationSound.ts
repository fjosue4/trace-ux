let audio: HTMLAudioElement | null = null;

export function playNotificationSound() {
  if (typeof Audio === 'undefined') return;

  try {
    if (!audio) {
      audio = new Audio('/notification.mp3');
      audio.preload = 'auto';
    } else {
      audio.currentTime = 0;
    }
    void audio.play().catch(() => {});
  } catch {
    // Browser audio is an enhancement; it must never interrupt the inbox.
  }
}
