export function playSound(src: string) {
  try {
    const audio = new Audio(src);
    audio.volume = 1.0;
    audio.play();
  } catch (err) {
    // ignore autoplay errors
  }
}