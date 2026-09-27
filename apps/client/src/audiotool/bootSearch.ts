export const BOOT_SEARCH = typeof window === 'undefined' ? '' : window.location.search;
export const BOOT_PARAMS = new URLSearchParams(BOOT_SEARCH);
