// Helper types for D-Bus method return values
export type TwinResult = [string, number, string, string];
export type TwinUpdateResult = [boolean, number, string];

// Type guard for TwinResult
export function isTwinResult(value: unknown): value is TwinResult {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'string' &&
    typeof value[3] === 'string'
  );
}

// Type guard for TwinUpdateResult
export function isTwinUpdateResult(value: unknown): value is TwinUpdateResult {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === 'boolean' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'string'
  );
}

// Safe array access with type checking
export function getArrayValue<T>(arr: unknown, index: number, defaultValue: T): T {
  if (!Array.isArray(arr) || index >= arr.length) {
    return defaultValue;
  }
  const value = arr[index];
  return (typeof value === typeof defaultValue ? value : defaultValue) as T;
}
