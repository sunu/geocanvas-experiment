/**
 * The history entry a widget open full screen adds (MobileApp.tsx), so the browser's back (a swipe on iOS, the back
 * button on Android) closes it. Only the state changes: changing the hash reloads the board (main.tsx).
 */
export const SHEET_ENTRY = { ttxSheet: true }

export const isSheetEntry = () => !!(history.state as { ttxSheet?: boolean } | null)?.ttxSheet
