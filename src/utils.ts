export function bucket(capacity: number, interval: number) {
  let tokens = capacity;
  const queue: (() => void)[] = [];

  const drain = () => {
    while (tokens > 0 && queue.length) {
      tokens--;
      queue.shift()!();
    }
  };

  setInterval(() => {
    tokens = capacity;
    drain();
  }, interval);

  return function schedule<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => job().then(resolve).catch(reject));
      drain();
    });
  };
}

