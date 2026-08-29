export class CharacterJobError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CharacterJobError";
  }
}
