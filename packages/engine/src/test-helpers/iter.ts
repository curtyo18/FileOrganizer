export async function drain<T>(it: AsyncIterable<T>): Promise<void> {
  for await (const _ of it) {
    void _;
  }
}
