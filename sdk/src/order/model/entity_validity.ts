export function isValidEntity(entity: { validate: () => void }): boolean {
  try {
    entity.validate();
    return true;
  } catch {
    return false;
  }
}
